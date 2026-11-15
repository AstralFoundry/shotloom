//! Provider packages are local, versioned artifacts. Inspection never executes code.
use super::common::user_file;
use crate::services::storage_service::{self, APP_DATABASE};
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256, Sha512};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::oneshot,
};

const MAX_PACKAGE: usize = 20 * 1024 * 1024;
const MAX_EXPANDED: u64 = 40 * 1024 * 1024;
static MUTATIONS: Mutex<()> = Mutex::new(());
static CALLS: OnceLock<Mutex<HashMap<String, oneshot::Sender<()>>>> = OnceLock::new();
fn calls() -> &'static Mutex<HashMap<String, oneshot::Sender<()>>> {
    CALLS.get_or_init(Default::default)
}
fn empty() -> Value {
    json!({"plugins":[],"disabledBuiltins":[],"connections":[],"registryUrl":""})
}
fn read_state(app: &AppHandle) -> Result<Value, String> {
    storage_service::catalog(&user_file(app, APP_DATABASE)?, "provider-plugins", empty())
}
fn write_state(app: &AppHandle, state: &Value) -> Result<Value, String> {
    storage_service::save_catalog(&user_file(app, APP_DATABASE)?, "provider-plugins", state)?;
    let _ = app.emit("provider-plugins-changed", ());
    Ok(state.clone())
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn id_valid(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(&c))
        && id.as_bytes()[0].is_ascii_alphanumeric()
}
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        && !path.contains('\\')
        && !path.contains(':')
        && Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}
fn validate_manifest(manifest: &Value) -> Result<(), String> {
    for key in ["description", "author", "homepage", "license", "readme"] {
        if let Some(value) = manifest.get(key) {
            if !value.is_string() {
                return Err(format!("{key} must be a string"));
            }
        }
    }
    if text(manifest, "readme").len() > 512 * 1024 {
        return Err("Plugin README exceeds 512 KiB".into());
    }

    if manifest["apiVersion"] != 1
        || !id_valid(text(manifest, "id"))
        || text(manifest, "name").trim().is_empty()
    {
        return Err("Invalid provider plugin identity or apiVersion".into());
    }
    semver::Version::parse(text(manifest, "version")).map_err(|e| e.to_string())?;
    let range = semver::VersionReq::parse(text(manifest, "shotloom"))
        .map_err(|e| format!("Invalid Shotloom compatibility range: {e}"))?;
    if !range.matches(&semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap()) {
        return Err("Plugin is incompatible with this Shotloom version".into());
    }
    if !manifest["protocols"].is_array() {
        return Err("protocols must be an array".into());
    }
    let protocol = manifest["kind"] == "protocol";
    let providers = manifest["providers"]
        .as_array()
        .ok_or("providers must be an array")?;
    if protocol {
        if !providers.is_empty()
            || manifest["protocols"].as_array().unwrap().is_empty()
            || !matches!(
                text(manifest, "category"),
                "textGeneration" | "imageGeneration" | "videoGeneration" | "audioGeneration"
            )
        {
            return Err("Invalid protocol plugin category or operations".into());
        }
        if !matches!(text(manifest, "engine"), "" | "declarative" | "module") {
            return Err("Unsupported protocol engine".into());
        }
        if manifest["engine"] == "module" && !manifest["runtime"].is_object() {
            return Err("Module protocol requires runtime".into());
        }
        let mut operation_ids = HashSet::new();
        for operation in manifest["protocols"].as_array().unwrap() {
            if !id_valid(text(operation, "id"))
                || !operation_ids.insert(text(operation, "id"))
                || !operation["mode"].is_object()
            {
                return Err("Invalid protocol operation".into());
            }
        }
    } else if providers.is_empty() {
        return Err("providers must be a non-empty array".into());
    }
    let mut ids = HashSet::new();
    for provider in providers {
        let id = text(provider, "id");
        if !id_valid(id)
            || !ids.insert(id)
            || text(provider, "name").is_empty()
            || !provider["models"].is_array()
        {
            return Err("Invalid or duplicate provider declaration".into());
        }
        if !matches!(text(provider, "engine"), "" | "declarative" | "module") {
            return Err("Unsupported provider engine".into());
        }
        if text(provider, "engine") == "module" && !manifest["runtime"].is_object() {
            return Err("Module provider requires runtime".into());
        }
        let base = text(provider, "baseUrl");
        if !base.is_empty() {
            let url = reqwest::Url::parse(base).map_err(|e| e.to_string())?;
            if !matches!(url.scheme(), "https" | "http")
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Invalid provider URL".into());
            }
        }
    }
    if let Some(aliases) = manifest.get("legacyProviders") {
        for alias in aliases
            .as_array()
            .ok_or("legacyProviders must be an array")?
        {
            if !id_valid(text(alias, "pluginId"))
                || semver::Version::parse(text(alias, "version")).is_err()
                || !id_valid(text(&alias["provider"], "id"))
            {
                return Err("Invalid historical provider identity".into());
            }
        }
    }
    if let Some(defaults) = manifest.get("defaultConnections") {
        for connection in defaults
            .as_array()
            .ok_or("defaultConnections must be an array")?
        {
            if !id_valid(text(connection, "id")) || text(connection, "name").is_empty() {
                return Err("Invalid default connection identity".into());
            }
            for model in connection["models"]
                .as_array()
                .ok_or("Invalid default model list")?
            {
                if model["protocolPlugin"] != manifest["id"] {
                    return Err("Default models must reference their own package".into());
                }
            }
        }
    }
    if let Some(runtime) = manifest.get("runtime") {
        let entry = text(runtime, "entry");
        if !safe_path(entry) || !entry.starts_with("runtime/") || !entry.ends_with(".mjs") {
            return Err("Runtime entry must be an ES module inside runtime/".into());
        }
    }
    Ok(())
}

struct Package {
    manifest: Value,
    digest: String,
    files: Vec<(String, Vec<u8>)>,
}
fn parse_package(bytes: &[u8]) -> Result<Package, String> {
    if bytes.len() > MAX_PACKAGE {
        return Err("Plugin package exceeds 20 MiB".into());
    }
    let digest = format!("{:x}", Sha256::digest(bytes));
    let mut files = Vec::new();
    if bytes.starts_with(&[0x1f, 0x8b]) {
        let archive = flate2::read::GzDecoder::new(Cursor::new(bytes));
        let mut archive = tar::Archive::new(archive.take(MAX_EXPANDED + 1024 * 1024));
        let mut total = 0u64;
        let mut paths = HashSet::new();
        for entry in archive.entries().map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.header().entry_type().is_dir() {
                continue;
            }
            if !entry.header().entry_type().is_file() {
                return Err("Only regular files are allowed in npm plugins".into());
            }
            let path = entry
                .path()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned();
            let name = path
                .strip_prefix("package/")
                .ok_or("npm archive must use the package/ root")?
                .to_string();
            if !safe_path(&name)
                || !paths.insert(name.clone())
                || name
                    .split('/')
                    .any(|part| part.starts_with('.') || part == "node_modules")
            {
                return Err("Unsafe or duplicate path in npm package; bundle dependencies".into());
            }
            if files.len() >= 256 || total + entry.size() > MAX_EXPANDED {
                return Err("npm plugin exceeds expanded package limits".into());
            }
            let mut data = Vec::new();
            entry
                .take(MAX_EXPANDED - total + 1)
                .read_to_end(&mut data)
                .map_err(|e| e.to_string())?;
            total += data.len() as u64;
            if total > MAX_EXPANDED {
                return Err("Expanded plugin exceeds 40 MiB".into());
            }
            files.push((name, data));
        }
        let metadata: Value = serde_json::from_slice(
            &files
                .iter()
                .find(|(name, _)| name == "package.json")
                .ok_or("npm plugin requires package.json")?
                .1,
        )
        .map_err(|e| e.to_string())?;
        if metadata["shotloomPlugin"] != "manifest.json" {
            return Err("npm package must declare shotloomPlugin: manifest.json".into());
        }
    } else if bytes.starts_with(b"PK") {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        if zip.len() > 256 {
            return Err("Too many files in plugin package".into());
        }
        let mut size = 0;
        let mut paths = HashSet::new();
        for i in 0..zip.len() {
            let file = zip.by_index(i).map_err(|e| e.to_string())?;
            if file.is_dir() {
                continue;
            }
            let name = file.name().to_owned();
            if !safe_path(&name)
                || !paths.insert(name.clone())
                || file
                    .unix_mode()
                    .map(|mode| mode & 0o170000 == 0o120000)
                    .unwrap_or(false)
            {
                return Err("Unsafe or duplicate path in plugin archive".into());
            }
            if name
                .split('/')
                .any(|part| part.starts_with('.') || part == "node_modules")
            {
                return Err(
                    "Hidden files and node_modules are not supported; bundle dependencies".into(),
                );
            }
            if size + file.size() > MAX_EXPANDED {
                return Err("Expanded plugin exceeds 40 MiB".into());
            }
            let mut data = Vec::new();
            file.take(MAX_EXPANDED - size + 1)
                .read_to_end(&mut data)
                .map_err(|e| e.to_string())?;
            size += data.len() as u64;
            if size > MAX_EXPANDED {
                return Err("Expanded plugin exceeds 40 MiB".into());
            }
            files.push((name, data));
        }
    } else {
        files.push(("manifest.json".into(), bytes.to_vec()));
    }
    let mut manifest: Value = serde_json::from_slice(
        &files
            .iter()
            .find(|(path, _)| path == "manifest.json")
            .ok_or("Missing manifest.json at archive root")?
            .1,
    )
    .map_err(|e| e.to_string())?;
    validate_manifest(&manifest)?;
    if let Some((_, data)) = files.iter().find(|(name, _)| name == "package.json") {
        let metadata: Value = serde_json::from_slice(data).map_err(|e| e.to_string())?;
        if !plugin_package_name(text(&metadata, "name")) {
            return Err("Plugin package names must start with shotloom-plugin-".into());
        }
    }
    if let Some((_, data)) = files
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("readme.md"))
    {
        if data.len() > 512 * 1024 {
            return Err("Plugin README exceeds 512 KiB".into());
        }
        manifest["readme"] =
            json!(String::from_utf8(data.clone()).map_err(|_| "README must be UTF-8")?);
    }
    if bytes.starts_with(&[0x1f, 0x8b]) {
        let metadata: Value = serde_json::from_slice(
            &files
                .iter()
                .find(|(name, _)| name == "package.json")
                .unwrap()
                .1,
        )
        .map_err(|e| e.to_string())?;
        if metadata["version"] != manifest["version"] {
            return Err("npm package and plugin versions must match".into());
        }
        for key in ["homepage", "license", "description"] {
            if manifest.get(key).is_none() && metadata[key].is_string() {
                manifest[key] = metadata[key].clone();
            }
        }
        if manifest.get("author").is_none() {
            let author = if metadata["author"].is_object() {
                &metadata["author"]["name"]
            } else {
                &metadata["author"]
            };
            if author.is_string() {
                manifest["author"] = author.clone();
            }
        }
    }
    if let Some(runtime) = manifest.get("runtime") {
        if !files.iter().any(|(path, _)| path == text(runtime, "entry")) {
            return Err("Runtime entry is missing from package".into());
        }
    } else if files.iter().any(|(path, _)| path.starts_with("runtime/")) {
        return Err("Runtime files require a declared runtime entry".into());
    }
    Ok(Package {
        manifest,
        digest,
        files,
    })
}
fn download_url_allowed(url: &reqwest::Url) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && (url.scheme() == "https"
            || (url.scheme() == "http"
                && matches!(
                    url.host_str(),
                    Some("127.0.0.1" | "localhost" | "::1" | "[::1]")
                )))
}
async fn fetch_bytes(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    if !download_url_allowed(&parsed) {
        return Err("Plugin downloads require HTTPS (or local HTTP for development)".into());
    }
    let mut response = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !download_url_allowed(attempt.url()) {
                attempt.error("Unsafe plugin download redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > limit {
            return Err("Download exceeds size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
// Resolve only package names plus exact versions or dist-tags. No shell/npm lifecycle scripts.
fn plugin_package_name(name: &str) -> bool {
    name.rsplit('/')
        .next()
        .and_then(|part| part.strip_prefix("shotloom-plugin-"))
        .map(|suffix| {
            !suffix.is_empty()
                && suffix.as_bytes()[0].is_ascii_alphanumeric()
                && suffix
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b))
        })
        .unwrap_or(false)
}
fn npm_spec(source: &str) -> Result<(&str, &str), String> {
    let spec = source
        .strip_prefix("npm:")
        .ok_or("Expected npm:package@version")?;
    let (name, version) = match spec.rfind('@') {
        Some(index) if index > 0 => (&spec[..index], &spec[index + 1..]),
        _ => (spec, "latest"),
    };
    let part_valid = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b))
            && part.as_bytes()[0].is_ascii_alphanumeric()
    };
    let name_valid = if let Some(scoped) = name.strip_prefix('@') {
        scoped
            .split_once('/')
            .map(|(scope, package)| part_valid(scope) && part_valid(package))
            .unwrap_or(false)
    } else {
        part_valid(name)
    };
    if name.len() > 214
        || !name_valid
        || version.is_empty()
        || !version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-+".contains(&b))
    {
        return Err("Use an npm package name with an exact version or dist-tag, e.g. npm:@scope/shotloom-plugin-example@1.0.0".into());
    }
    if !plugin_package_name(name) {
        return Err("Plugin package names must start with shotloom-plugin-, e.g. @scope/shotloom-plugin-example".into());
    }
    Ok((name, version))
}
fn verify_npm_integrity(bytes: &[u8], integrity: &str) -> Result<(), String> {
    for item in integrity.split_whitespace() {
        if let Some(expected) = item.strip_prefix("sha512-") {
            let actual = base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes));
            return if actual == expected {
                Ok(())
            } else {
                Err("npm package integrity mismatch".into())
            };
        }
    }
    Err("npm package requires SHA-512 integrity metadata".into())
}
async fn package_from_npm_metadata(
    metadata: &Value,
    name: &str,
) -> Result<(Package, String), String> {
    let resolved = text(metadata, "version");
    let bytes = fetch_bytes(text(&metadata["dist"], "tarball"), MAX_PACKAGE).await?;
    verify_npm_integrity(&bytes, text(&metadata["dist"], "integrity"))?;
    if !bytes.starts_with(&[0x1f, 0x8b]) {
        return Err("npm plugin must be a gzip tarball".into());
    }
    let package = parse_package(&bytes)?;
    let packaged: Value = serde_json::from_slice(
        &package
            .files
            .iter()
            .find(|(path, _)| path == "package.json")
            .ok_or("Missing package.json")?
            .1,
    )
    .map_err(|e| e.to_string())?;
    if text(&packaged, "name") != name || text(&package.manifest, "version") != resolved {
        return Err("npm registry and plugin package identities must match".into());
    }
    Ok((package, format!("npm:{name}@{resolved}")))
}
fn npm_registry(registry: &str) -> Result<&'static str, String> {
    match registry {
        "" | "npm" => Ok("https://registry.npmjs.org/"),
        "npmmirror" => Ok("https://registry.npmmirror.com/"),
        _ => Err("Unsupported npm registry".into()),
    }
}
async fn source_package(source: &str, registry: &str) -> Result<(Package, String), String> {
    if source.starts_with("npm:") {
        let (name, version) = npm_spec(source)?;
        let mut url = reqwest::Url::parse(npm_registry(registry)?).unwrap();
        url.path_segments_mut().unwrap().push(name).push(version);
        let metadata: Value =
            serde_json::from_slice(&fetch_bytes(url.as_str(), 2 * 1024 * 1024).await?)
                .map_err(|e| e.to_string())?;
        let resolved = text(&metadata, "version");
        if text(&metadata, "name") != name || semver::Version::parse(resolved).is_err() {
            return Err("npm registry returned a different package identity".into());
        }
        if semver::Version::parse(version).is_ok() && version != resolved {
            return Err("npm registry returned a different version".into());
        }
        return package_from_npm_metadata(&metadata, name).await;
    }
    Ok((
        parse_package(&source_bytes(source).await?)?,
        source.to_owned(),
    ))
}
async fn source_bytes(source: &str) -> Result<Vec<u8>, String> {
    if source.starts_with("https://") || source.starts_with("http://") {
        return fetch_bytes(source, MAX_PACKAGE).await;
    }
    let path = PathBuf::from(source);
    if path.is_dir() {
        return Err("Choose a .shotloom-plugin ZIP or manifest JSON; package local runtime files with the plugin CLI".into());
    }
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_PACKAGE as u64 {
        return Err("Plugin package exceeds 20 MiB".into());
    }
    fs::read(path).map_err(|e| e.to_string())
}
fn package_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("provider-plugins"))
}
fn artifact_dir(app: &AppHandle, manifest: &Value, digest: &str) -> Result<PathBuf, String> {
    if !id_valid(text(manifest, "id"))
        || digest.len() != 64
        || !digest.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid plugin artifact reference".into());
    }
    Ok(package_root(app)?
        .join(text(manifest, "id"))
        .join(format!("{}-{digest}", text(manifest, "version"))))
}
fn install_in_state(
    state: &mut Value,
    root: &Path,
    package: Package,
    source: &str,
    expected: &str,
    trusted: bool,
) -> Result<Value, String> {
    if package.digest != expected {
        return Err("Package changed since inspection; inspect it again".into());
    }
    if package.manifest.get("runtime").is_some() && !trusted {
        return Err("Code plugins require explicit trust confirmation".into());
    }
    let plugins = state["plugins"]
        .as_array_mut()
        .ok_or("Invalid plugin registry")?;
    // Installed identities and immutable versions are shared by release and npm packages.
    let mut identities = vec![text(&package.manifest, "id")];
    if let Some(aliases) = package.manifest["legacyProviders"].as_array() {
        identities.extend(aliases.iter().map(|alias| text(alias, "pluginId")));
    }
    for other in plugins.iter().flat_map(|plugin| {
        std::iter::once(&plugin["manifest"]).chain(
            plugin["history"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|item| &item["manifest"]),
        )
    }) {
        if other["id"] == package.manifest["id"] {
            continue;
        }
        if identities.contains(&text(other, "id"))
            || other["legacyProviders"]
                .as_array()
                .map(|aliases| {
                    aliases
                        .iter()
                        .any(|alias| identities.contains(&text(alias, "pluginId")))
                })
                .unwrap_or(false)
        {
            return Err("Plugin identity already belongs to another package".into());
        }
        for provider in package.manifest["providers"].as_array().unwrap() {
            if other["providers"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["id"] == provider["id"])
            {
                return Err(format!(
                    "Provider id already belongs to another plugin: {}",
                    provider["id"]
                ));
            }
        }
    }
    let previous = plugins
        .iter()
        .position(|p| p["manifest"]["id"] == package.manifest["id"]);
    let mut history = previous
        .map(|i| {
            plugins[i]["history"]
                .as_array()
                .cloned()
                .unwrap_or_default()
        })
        .unwrap_or_default();
    if let Some(index) = previous {
        for old in std::iter::once(&plugins[index]).chain(history.iter()) {
            if old["manifest"]["version"] == package.manifest["version"]
                && old["digest"] != package.digest
            {
                return Err(
                    "A version is immutable; increase version before changing its contents".into(),
                );
            }
        }
        history.retain(|old| old["manifest"]["version"] != package.manifest["version"]);
        if plugins[index]["digest"] != package.digest {
            history.push(json!({"manifest":plugins[index]["manifest"],"digest":plugins[index]["digest"],"trustedCode":plugins[index]["trustedCode"],"source":plugins[index]["source"]}));
        }
    }
    let target = root.join(text(&package.manifest, "id")).join(format!(
        "{}-{}",
        text(&package.manifest, "version"),
        package.digest
    ));
    if !target.exists() {
        let staging = root.join(format!(".stage-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            for (relative, bytes) in &package.files {
                let path = staging.join(relative);
                fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
                fs::write(path, bytes).map_err(|e| e.to_string())?;
            }
            fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
            fs::rename(&staging, &target).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result?;
    }
    let defaults = package.manifest["defaultConnections"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let record = json!({"manifest":package.manifest,"digest":package.digest,"source":source,"enabled":true,"trustedCode":trusted,"installedAt":super::common::chrono_stamp(),"history":history});
    if let Some(index) = previous {
        plugins[index] = record;
    } else {
        plugins.push(record);
    }
    if previous.is_none() {
        provision_connections(state, &defaults)?;
    }
    Ok(state.clone())
}

fn provision_connections(state: &mut Value, defaults: &[Value]) -> Result<(), String> {
    let connections = state["connections"]
        .as_array_mut()
        .ok_or("Invalid connection registry")?;
    for seed in defaults {
        if let Some(existing) = connections
            .iter_mut()
            .find(|connection| connection["id"] == seed["id"])
        {
            // Existing addresses and per-model capabilities belong to the user.
            if !existing["models"].is_array() {
                continue;
            }
            for model in seed["models"]
                .as_array()
                .ok_or("Invalid default model list")?
            {
                let models = existing["models"].as_array_mut().unwrap();
                if !models.iter().any(|item| item["id"] == model["id"]) {
                    models.push(model.clone());
                }
            }
        } else {
            connections.push(seed.clone());
        }
    }
    connections.sort_by_key(|connection| connection["sortOrder"].as_i64().unwrap_or(99));
    Ok(())
}
fn install(
    app: &AppHandle,
    package: Package,
    source: &str,
    expected: &str,
    trusted: bool,
) -> Result<Value, String> {
    let _guard = MUTATIONS.lock().map_err(|e| e.to_string())?;
    let mut state = read_state(app)?;
    install_in_state(
        &mut state,
        &package_root(app)?,
        package,
        source,
        expected,
        trusted,
    )?;
    write_state(app, &state)
}

fn provision_distribution(
    state: &mut Value,
    root: &Path,
    distribution: &Path,
) -> Result<bool, String> {
    let index: Value = serde_json::from_slice(
        &fs::read(distribution.join("index.json"))
            .map_err(|e| format!("Default plugin distribution is unavailable: {e}"))?,
    )
    .map_err(|e| e.to_string())?;
    if index["apiVersion"] != 1 {
        return Err("Unsupported default plugin distribution".into());
    }
    let entries = index["plugins"]
        .as_array()
        .ok_or("Invalid default plugin index")?;
    let protected_connections = state["connections"]
        .as_array()
        .cloned()
        .ok_or("Invalid connection registry")?;
    let mut changed = false;
    for entry in entries {
        let id = text(entry, "id");
        if state["plugins"]
            .as_array()
            .ok_or("Invalid plugin registry")?
            .iter()
            .any(|plugin| plugin["manifest"]["id"] == id)
        {
            continue;
        }
        let file = text(entry, "file");
        if !id_valid(id) || !safe_path(file) || file.contains('/') {
            return Err("Invalid release plugin path".into());
        }
        let package =
            parse_package(&fs::read(distribution.join(file)).map_err(|e| e.to_string())?)?;
        if text(&package.manifest, "id") != id
            || package.manifest["version"] != entry["version"]
            || package.digest != text(entry, "sha256")
        {
            return Err("Default plugin identity or digest mismatch".into());
        }
        // These files are shipped with the application, never read from a remote index.
        let disabled = state["disabledBuiltins"]
            .as_array()
            .map(|ids| ids.iter().any(|value| value == id))
            .unwrap_or(false);
        install_in_state(
            state,
            root,
            package,
            &format!("distribution:{id}@{}", text(entry, "version")),
            text(entry, "sha256"),
            true,
        )?;
        let plugin = state["plugins"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|plugin| plugin["manifest"]["id"] == id)
            .unwrap();
        plugin["enabled"] = json!(!disabled);
        changed = true;
    }
    if changed {
        for connection in protected_connections {
            if let Some(existing) = state["connections"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|item| item["id"] == connection["id"])
            {
                *existing = connection;
            }
        }
        let disabled = state["disabledBuiltins"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        for connection in state["connections"].as_array_mut().unwrap() {
            if disabled
                .iter()
                .any(|id| id == &format!("builtin.{}", text(connection, "id")))
            {
                connection["enabled"] = json!(false);
            }
        }
    }
    if changed {
        state.as_object_mut().unwrap().remove("disabledBuiltins");
    }
    Ok(changed)
}
fn release_distribution(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/provider-plugins"));
    }
    Ok(app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/provider-plugins"))
}
fn installed_state(app: &AppHandle) -> Result<Value, String> {
    let _guard = MUTATIONS.lock().map_err(|e| e.to_string())?;
    let mut state = read_state(app)?;
    if provision_distribution(&mut state, &package_root(app)?, &release_distribution(app)?)? {
        return write_state(app, &state);
    }
    Ok(state)
}

#[tauri::command]
pub async fn provider_plugins(
    app: AppHandle,
    operation: String,
    args: Value,
) -> Result<Value, String> {
    if operation == "list" {
        return installed_state(&app);
    }
    if operation == "search" {
        let mut url = reqwest::Url::parse(npm_registry(text(&args, "registry"))?).unwrap();
        url.set_path("/-/v1/search");
        let query = format!("shotloom {}", text(&args, "query"));
        let offset = args["offset"].as_u64().unwrap_or(0).min(10000).to_string();
        url.query_pairs_mut()
            .append_pair("text", &query)
            .append_pair("size", "40")
            .append_pair("from", &offset);
        return serde_json::from_slice(&fetch_bytes(url.as_str(), 4 * 1024 * 1024).await?)
            .map_err(|e| e.to_string());
    }
    if operation == "inspect" || operation == "install" {
        let source = text(&args, "source");
        let (package, resolved_source) = source_package(source, text(&args, "registry")).await?;
        if operation == "inspect" {
            return Ok(
                json!({"manifest":package.manifest,"digest":package.digest,"hasCode":package.manifest.get("runtime").is_some(),"resolvedSource":resolved_source}),
            );
        }
        return install(
            &app,
            package,
            &resolved_source,
            text(&args, "digest"),
            args["trustedCode"] == true,
        );
    }
    if operation == "documentation" {
        let state = read_state(&app)?;
        let plugin = state["plugins"]
            .as_array()
            .and_then(|plugins| plugins.iter().find(|p| p["manifest"]["id"] == args["id"]))
            .ok_or("Plugin not installed")?;
        let path = text(&args, "path");
        if !safe_path(path) || !path.ends_with(".md") {
            return Err("Documentation must be a relative Markdown path".into());
        }
        let file = artifact_dir(&app, &plugin["manifest"], text(plugin, "digest"))?.join(path);
        if fs::metadata(&file).map_err(|e| e.to_string())?.len() > 512 * 1024 {
            return Err("Documentation exceeds 512 KiB".into());
        }
        return Ok(json!({"content":fs::read_to_string(file).map_err(|e| e.to_string())?}));
    }
    if operation == "index" {
        let bytes = fetch_bytes(text(&args, "url"), 1024 * 1024).await?;
        let index: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if index["apiVersion"] != 1 || !index["plugins"].is_array() {
            return Err("Invalid plugin index".into());
        }
        return Ok(index);
    }
    let _guard = MUTATIONS.lock().map_err(|e| e.to_string())?;
    let mut state = read_state(&app)?;
    match operation.as_str() {
        "configure" => {
            for key in ["connections"] {
                if !args[key].is_array() {
                    return Err(format!("{key} must be an array"));
                }
            }
            state["connections"] = args["connections"].clone();
            state["registryUrl"] = json!(text(&args, "registryUrl"));
        }
        "enable" | "remove" | "rollback" => {
            let plugins = state["plugins"]
                .as_array_mut()
                .ok_or("Invalid plugin registry")?;
            let plugin = plugins
                .iter_mut()
                .find(|p| text(&p["manifest"], "id") == text(&args, "id"))
                .ok_or("Plugin not installed")?;
            if operation == "rollback" {
                let history = plugin["history"]
                    .as_array_mut()
                    .ok_or("No previous version")?;
                let index = history
                    .iter()
                    .position(|p| text(&p["manifest"], "version") == text(&args, "version"))
                    .ok_or("Version is not installed")?;
                let old = history.remove(index);
                let current = json!({"manifest":plugin["manifest"],"digest":plugin["digest"],"trustedCode":plugin["trustedCode"],"source":plugin["source"]});
                plugin["history"].as_array_mut().unwrap().push(current);
                for key in ["manifest", "digest", "trustedCode"] {
                    plugin[key] = old[key].clone();
                }
                if let Some(source) = old.get("source") {
                    plugin["source"] = source.clone();
                }
                plugin["enabled"] = json!(true);
            } else {
                plugin["enabled"] = json!(operation == "enable" && args["enabled"] == true);
                // Uninstall removes discovery, but retains versions/configuration for saved tasks.
                plugin["removed"] = json!(operation == "remove");
            }
        }
        _ => return Err("Unknown plugin operation".into()),
    }
    write_state(&app, &state)
}

#[tauri::command]
pub fn provider_plugin_cancel(request_id: String) {
    if let Some(sender) = calls().lock().unwrap().remove(&request_id) {
        let _ = sender.send(());
    }
}

fn record_matches_reference(record: &Value, reference: &Value) -> bool {
    let manifest = &record["manifest"];
    (manifest["id"] == reference["id"] && manifest["version"] == reference["version"])
        || manifest["legacyProviders"]
            .as_array()
            .map(|aliases| {
                aliases.iter().any(|alias| {
                    alias["pluginId"] == reference["id"]
                        && alias["version"] == reference["version"]
                        && alias["provider"]["id"] == reference["providerId"]
                })
            })
            .unwrap_or(false)
}

#[tauri::command]
pub async fn provider_plugin_call(
    app: AppHandle,
    request_id: String,
    reference: Value,
    provider_id: String,
    method: String,
    input: Value,
    timeout_ms: u64,
) -> Result<Value, String> {
    if !matches!(method.as_str(), "submit" | "poll" | "cancel" | "models") {
        return Err("Unsupported plugin method".into());
    }
    let state = read_state(&app)?;
    let plugin = state["plugins"]
        .as_array()
        .and_then(|p| {
            p.iter().find(|p| {
                record_matches_reference(p, &reference)
                    || p["history"]
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .any(|item| record_matches_reference(item, &reference))
                        })
                        .unwrap_or(false)
            })
        })
        .ok_or("Plugin is not installed")?;
    if method != "poll" && method != "cancel" && plugin["enabled"] != true {
        return Err("Plugin is disabled".into());
    }
    let record = if record_matches_reference(plugin, &reference) {
        plugin
    } else {
        plugin["history"]
            .as_array()
            .and_then(|history| {
                history
                    .iter()
                    .find(|p| record_matches_reference(p, &reference))
            })
            .ok_or("Pinned plugin version is not installed")?
    };
    if record["trustedCode"] != true {
        return Err("Code plugin is not trusted".into());
    }
    let manifest = &record["manifest"];
    let preset_id = text(&reference, "providerId");
    let protocol = manifest["kind"] == "protocol";
    let legacy_protocol = manifest["legacyProviders"]
        .as_array()
        .map(|aliases| {
            aliases.iter().any(|alias| {
                alias["pluginId"] == reference["id"]
                    && alias["provider"]["id"] == preset_id
                    && alias["version"] == reference["version"]
            })
        })
        .unwrap_or(false);
    if !(protocol && (preset_id == "protocol" || legacy_protocol) && manifest["engine"] == "module")
        && !manifest["providers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| text(p, "id") == preset_id && text(p, "engine") == "module")
    {
        return Err("Provider is not a module in this plugin".into());
    }
    if provider_id != preset_id
        && !state["connections"].as_array().unwrap().iter().any(|c| {
            text(c, "id") == provider_id
                && ((text(c, "pluginId") == text(&reference, "id")
                    && text(c, "presetId") == preset_id)
                    || (protocol
                        && c["models"]
                            .as_array()
                            .map(|models| {
                                models.iter().any(|model| {
                                    text(model, "protocolPlugin") == text(&reference, "id")
                                })
                            })
                            .unwrap_or(false)))
        })
    {
        return Err("Connection does not belong to this plugin".into());
    }
    if method == "submit"
        && provider_id != preset_id
        && state["connections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| text(c, "id") == provider_id && c["enabled"] == false)
    {
        return Err("Connection is disabled".into());
    }
    let root = artifact_dir(&app, manifest, text(record, "digest"))?;
    let entry = text(&manifest["runtime"], "entry");
    if !safe_path(entry) {
        return Err("Unsafe runtime entry".into());
    }
    let settings = storage_service::settings(&user_file(&app, APP_DATABASE)?, &json!({}))?;
    let preset = manifest["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| text(p, "id") == preset_id);
    let mut config = settings["providerConfigs"][&provider_id]
        .as_object()
        .cloned()
        .unwrap_or_default();
    if config
        .get("baseUrl")
        .and_then(Value::as_str)
        .unwrap_or("")
        .is_empty()
    {
        let connection = state["connections"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| text(c, "id") == provider_id);
        config.insert(
            "baseUrl".into(),
            connection
                .and_then(|c| c.get("baseUrl"))
                .cloned()
                .or_else(|| preset.map(|p| p["baseUrl"].clone()))
                .unwrap_or(json!("")),
        );
    }
    config.insert(
        "locale".into(),
        settings.get("locale").cloned().unwrap_or(json!("zh-CN")),
    );
    let runtime_root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/agent-host")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("resources/agent-host")
    };
    let executable = runtime_root.join(if cfg!(windows) { "node.exe" } else { "node" });
    let mut command = tokio::process::Command::new(executable);
    command
        .arg("--input-type=module")
        .arg("--eval")
        .arg(include_str!("../../../scripts/provider-plugin-host.mjs"))
        .arg(root.join(entry))
        .arg(&method)
        .current_dir(&root)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
    // Native durable receipt closes the crash window between remote submission and renderer persistence.
    let submission_key = if method == "submit" {
        let submission = text(&input, "submissionId");
        if submission.is_empty() {
            return Err("Module submit requires a stable submissionId".into());
        }
        Some(format!(
            "{:x}",
            Sha256::digest(format!("{provider_id}:{submission}").as_bytes())
        ))
    } else {
        None
    };
    if let Some(key) = &submission_key {
        let _guard = MUTATIONS.lock().map_err(|e| e.to_string())?;
        let database = user_file(&app, APP_DATABASE)?;
        let mut receipts =
            storage_service::catalog(&database, "provider-plugin-submissions", json!({}))?;
        if let Some(receipt) = receipts.get(key) {
            if receipt["reference"] != reference {
                return Err("Submission was pinned to another plugin version".into());
            }
            if let Some(result) = receipt.get("result") {
                return Ok(result.clone());
            }
            return Err("Submission outcome unknown; recover using the provider task id. This submission will not be sent again.".into());
        }
        // Validate that Node exists before committing an uncertain dispatch marker.
        if !command.as_std().get_program().is_empty()
            && !Path::new(command.as_std().get_program()).is_file()
        {
            return Err("Plugin Node runtime unavailable".into());
        }
        receipts[key] = json!({"reference":reference,"startedAt":super::common::chrono_stamp()});
        storage_service::save_catalog(&database, "provider-plugin-submissions", &receipts)?;
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Plugin Node runtime unavailable: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("Plugin stdin unavailable")?;
    let mut stdout = child.stdout.take().ok_or("Plugin stdout unavailable")?;
    let bytes =
        serde_json::to_vec(&json!({"input":input,"config":config})).map_err(|e| e.to_string())?;
    let work = async {
        stdin.write_all(&bytes).await.map_err(|e| e.to_string())?;
        drop(stdin);
        let mut output = Vec::new();
        (&mut stdout)
            .take(10 * 1024 * 1024 + 1)
            .read_to_end(&mut output)
            .await
            .map_err(|e| e.to_string())?;
        if output.len() > 10 * 1024 * 1024 {
            return Err("Plugin response exceeds 10 MiB".into());
        }
        let status = child.wait().await.map_err(|e| e.to_string())?;
        let response: Value =
            serde_json::from_slice(&output).map_err(|_| "Invalid plugin response".to_string())?;
        if !status.success() || response.get("error").is_some() {
            return Err(response["error"].as_str().unwrap_or("Plugin failed").into());
        }
        Ok(response["result"].clone())
    };
    let (sender, receiver) = oneshot::channel();
    {
        let mut pending = calls().lock().unwrap();
        if pending.contains_key(&request_id) {
            return Err("Duplicate plugin request id".into());
        }
        pending.insert(request_id.clone(), sender);
    }
    let result = tokio::select! { result=tokio::time::timeout(Duration::from_millis(timeout_ms.clamp(1000,600_000)),work) => result.map_err(|_|"Plugin call timed out".to_string()).and_then(|r|r), _=receiver => Err("Plugin call cancelled".into()) };
    calls().lock().unwrap().remove(&request_id);
    if let (Some(key), Ok(value)) = (submission_key, &result) {
        let _guard = MUTATIONS.lock().map_err(|e| e.to_string())?;
        let database = user_file(&app, APP_DATABASE)?;
        let mut receipts =
            storage_service::catalog(&database, "provider-plugin-submissions", json!({}))?;
        receipts[&key]["result"] = value.clone();
        storage_service::save_catalog(&database, "provider-plugin-submissions", &receipts)?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest() -> Value {
        json!({"apiVersion":1,"id":"test.plugin","name":"Test","version":"1.0.0","shotloom":">=0.9.1, <1.0.0","protocols":[],"providers":[{"id":"test-provider","name":"Test","baseUrl":"https://example.com","models":[]}]})
    }
    #[test]
    fn validates_version_and_identity() {
        let mut m = manifest();
        assert!(validate_manifest(&m).is_ok());
        m["id"] = json!("../escape");
        assert!(validate_manifest(&m).is_err());
        m = manifest();
        m["shotloom"] = json!(">=99.0.0");
        assert!(validate_manifest(&m).is_err());
    }
    #[test]
    fn protocol_packages_have_operations_without_provider_presets() {
        let mut m = manifest();
        m["kind"] = json!("protocol");
        m["category"] = json!("imageGeneration");
        m["providers"] = json!([]);
        m["protocols"] = json!([{"id":"generate","mode":{"id":"text-to-image"}}]);
        assert!(validate_manifest(&m).is_ok());
        m["protocols"] = json!([]);
        assert!(validate_manifest(&m).is_err());
        m["protocols"] = json!([{"id":"generate","mode":{}}]);
        m["engine"] = json!("module");
        assert!(validate_manifest(&m).is_err());
    }
    #[test]
    fn paths_cannot_escape_package() {
        for path in [
            "../x",
            "/x",
            "runtime/../x",
            "C:\\x",
            "runtime\\x",
            "runtime//../x",
            "runtime//x",
            "runtime/./x",
        ] {
            assert!(!safe_path(path), "{path}");
        }
        assert!(safe_path("runtime/index.mjs"));
    }
    #[test]
    fn json_packages_do_not_execute() {
        let bytes = serde_json::to_vec(&manifest()).unwrap();
        let p = parse_package(&bytes).unwrap();
        assert_eq!(p.digest.len(), 64);
        assert_eq!(p.files.len(), 1);
    }
    #[test]
    fn downloads_reject_remote_http_and_embedded_credentials() {
        for url in [
            "http://example.com/plugin.zip",
            "https://key@example.com/plugin.zip",
            "file:///tmp/plugin.zip",
        ] {
            assert!(!download_url_allowed(&reqwest::Url::parse(url).unwrap()));
        }
        for url in [
            "https://example.com/plugin.zip",
            "http://127.0.0.1:19391/plugin.zip",
        ] {
            assert!(download_url_allowed(&reqwest::Url::parse(url).unwrap()));
        }
    }
    #[test]
    fn runtime_requires_an_existing_entry() {
        let mut m = manifest();
        m["runtime"] = json!({"entry":"runtime/index.mjs"});
        assert!(parse_package(&serde_json::to_vec(&m).unwrap()).is_err());
    }
    fn npm_tar(files: Vec<(&str, Vec<u8>)>) -> Vec<u8> {
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        for (name, bytes) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, name, bytes.as_slice())
                .unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }
    fn npm_fixture() -> Vec<u8> {
        npm_tar(vec![
            ("package/package.json", serde_json::to_vec(&json!({"name":"@shotloom/shotloom-plugin-test","version":"1.0.0","shotloomPlugin":"manifest.json","license":"MIT","author":{"name":"Fixture author"}})).unwrap()),
            ("package/manifest.json", serde_json::to_vec(&manifest()).unwrap()),
            ("package/README.md", b"# Example\n[Fields](docs/interface.md)".to_vec()),
            ("package/docs/interface.md", b"# Fields\nAPI Key".to_vec()),
        ])
    }
    #[test]
    fn npm_registry_accepts_only_supported_sources() {
        assert_eq!(npm_registry("npm").unwrap(), "https://registry.npmjs.org/");
        assert_eq!(
            npm_registry("npmmirror").unwrap(),
            "https://registry.npmmirror.com/"
        );
        assert!(npm_registry("https://untrusted.example/").is_err());
    }
    #[test]
    fn npm_specs_allow_names_exact_versions_and_tags_only() {
        assert_eq!(
            npm_spec("npm:@scope/shotloom-plugin-example@1.2.3-beta.1").unwrap(),
            ("@scope/shotloom-plugin-example", "1.2.3-beta.1")
        );
        assert_eq!(
            npm_spec("npm:shotloom-plugin-example").unwrap(),
            ("shotloom-plugin-example", "latest")
        );
        assert_eq!(
            npm_spec("npm:@scope/shotloom-plugin-example@next").unwrap(),
            ("@scope/shotloom-plugin-example", "next")
        );
        for source in [
            "npm:ordinary-plugin",
            "npm:@scope/ordinary-plugin",
            "npm:shotloom-plugin-",
            "npm:",
            "npm:../x",
            "npm:@scope/a/b",
            "npm:a@",
            "npm:a@^1",
            "npm:https://example.com/a",
            "npm:a;touch x",
            "npm:a@npm:b",
            "npm:--foo",
        ] {
            assert!(npm_spec(source).is_err(), "{source}");
        }
    }
    #[test]
    fn npm_tarballs_load_readme_and_validate_plugin_package_contract() {
        let package = parse_package(&npm_fixture()).unwrap();
        assert_eq!(package.manifest["license"], "MIT");
        assert_eq!(package.manifest["author"], "Fixture author");
        assert!(text(&package.manifest, "readme").contains("[Fields](docs/interface.md)"));
        for metadata in [
            json!({"name":"ordinary-plugin","version":"1.0.0","shotloomPlugin":"manifest.json"}),
            json!({"version":"1.0.0"}),
            json!({"version":"2.0.0","shotloomPlugin":"manifest.json"}),
        ] {
            let bytes = npm_tar(vec![
                (
                    "package/package.json",
                    serde_json::to_vec(&metadata).unwrap(),
                ),
                (
                    "package/manifest.json",
                    serde_json::to_vec(&manifest()).unwrap(),
                ),
            ]);
            assert!(parse_package(&bytes).is_err());
        }
        let duplicates = npm_tar(vec![
            ("package/manifest.json", vec![]),
            ("package/manifest.json", vec![]),
        ]);
        assert!(parse_package(&duplicates).is_err());
        let hidden = npm_tar(vec![("package/.hidden", vec![])]);
        assert!(parse_package(&hidden).is_err());
        let dependencies = npm_tar(vec![("package/node_modules/x/index.js", vec![])]);
        assert!(parse_package(&dependencies).is_err());
    }
    #[test]
    fn npm_archives_reject_links_and_oversized_headers() {
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_mode(0o777);
        header.set_cksum();
        builder
            .append_link(&mut header, "package/docs/link.md", "../../outside")
            .unwrap();
        let bytes = builder.into_inner().unwrap().finish().unwrap();
        assert!(parse_package(&bytes)
            .err()
            .unwrap()
            .contains("regular files"));
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_path("package/huge").unwrap();
        header.set_size(MAX_EXPANDED + 1);
        header.set_mode(0o644);
        header.set_cksum();
        use std::io::Write;
        builder.get_mut().write_all(header.as_bytes()).unwrap();
        let bytes = builder.into_inner().unwrap().finish().unwrap();
        assert!(parse_package(&bytes)
            .err()
            .unwrap()
            .contains("expanded package limits"));
    }
    #[test]
    fn npm_integrity_rejects_tampering_and_missing_hash() {
        let bytes = npm_fixture();
        let integrity = format!(
            "sha512-{}",
            base64::engine::general_purpose::STANDARD.encode(Sha512::digest(&bytes))
        );
        assert!(verify_npm_integrity(&bytes, &integrity).is_ok());
        assert!(verify_npm_integrity(b"tampered", &integrity).is_err());
        assert!(verify_npm_integrity(&bytes, "").is_err());
    }
    #[tokio::test]
    async fn npm_download_checks_integrity_and_pins_registry_version() {
        let bytes = npm_fixture();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let integrity = format!(
            "sha512-{}",
            base64::engine::general_purpose::STANDARD.encode(Sha512::digest(&bytes))
        );
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 2048];
            socket.read(&mut request).await.unwrap();
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        bytes.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            socket.write_all(&bytes).await.unwrap();
        });
        let metadata = json!({"name":"@shotloom/shotloom-plugin-test","version":"1.0.0","dist":{"tarball":format!("http://{address}/plugin.tgz"),"integrity":integrity}});
        let (package, source) =
            package_from_npm_metadata(&metadata, "@shotloom/shotloom-plugin-test")
                .await
                .unwrap();
        assert_eq!(source, "npm:@shotloom/shotloom-plugin-test@1.0.0");
        assert_eq!(package.manifest["id"], "test.plugin");
        assert!(package
            .files
            .iter()
            .any(|(path, _)| path == "docs/interface.md"));
        server.await.unwrap();
    }
    fn distribution_fixture(directory: &Path, manifest: &Value) {
        fs::create_dir_all(directory).unwrap();
        let bytes = serde_json::to_vec(manifest).unwrap();
        fs::write(directory.join("fixture.shotloom-plugin"), &bytes).unwrap();
        fs::write(directory.join("index.json"), serde_json::to_vec(&json!({"apiVersion":1,"plugins":[{"id":manifest["id"],"version":manifest["version"],"file":"fixture.shotloom-plugin","sha256":format!("{:x}",Sha256::digest(&bytes))}]})).unwrap()).unwrap();
    }
    #[test]
    fn default_installation_is_persistent_and_never_resurrects_removed_plugins() {
        let temporary =
            std::env::temp_dir().join(format!("shotloom-distribution-{}", uuid::Uuid::new_v4()));
        let mut manifest = manifest();
        manifest["defaultConnections"] = json!([{"id":"test-provider","name":"Default connection","pluginId":"test.plugin","presetId":"protocol","preserveModelIds":true,"models":[{"id":"kept-model","protocolPlugin":"test.plugin"}]}]);
        distribution_fixture(&temporary.join("release"), &manifest);
        let mut state = empty();
        state["disabledBuiltins"] = json!(["test.plugin", "builtin.test-provider"]);
        assert!(provision_distribution(
            &mut state,
            &temporary.join("installed"),
            &temporary.join("release")
        )
        .unwrap());
        assert_eq!(state["plugins"][0]["enabled"], false);
        assert_eq!(state["connections"][0]["enabled"], false);
        assert!(state["plugins"][0]["source"]
            .as_str()
            .unwrap()
            .starts_with("distribution:"));
        assert_eq!(state["connections"][0]["models"][0]["id"], "kept-model");
        let artifact = temporary
            .join("installed/test.plugin")
            .join(format!("1.0.0-{}", text(&state["plugins"][0], "digest")))
            .join("manifest.json");
        assert!(artifact.is_file());
        state["plugins"][0]["removed"] = json!(true);
        state["connections"][0]["enabled"] = json!(true);
        let before = state.clone();
        assert!(!provision_distribution(
            &mut state,
            &temporary.join("installed"),
            &temporary.join("release")
        )
        .unwrap());
        assert_eq!(state, before);
        fs::remove_dir_all(temporary).unwrap();
    }
    #[test]
    fn default_installation_preserves_saved_connection_overrides_and_rejects_tampering() {
        let temporary =
            std::env::temp_dir().join(format!("shotloom-distribution-{}", uuid::Uuid::new_v4()));
        let mut manifest = manifest();
        manifest["defaultConnections"] = json!([{"id":"test-provider","name":"Default","pluginId":"test.plugin","models":[{"id":"new-model","protocolPlugin":"test.plugin"}]}]);
        distribution_fixture(&temporary.join("release"), &manifest);
        let mut state = empty();
        let saved = json!({"id":"test-provider","name":"User name","baseUrl":"https://user.example","enabled":false,"models":[{"id":"user-model","modes":[]} ]});
        state["connections"] = json!([saved]);
        provision_distribution(
            &mut state,
            &temporary.join("installed"),
            &temporary.join("release"),
        )
        .unwrap();
        assert_eq!(state["connections"][0], saved);
        fs::write(
            temporary.join("release/fixture.shotloom-plugin"),
            serde_json::to_vec(&json!({"not":"the inspected package"})).unwrap(),
        )
        .unwrap();
        assert!(provision_distribution(
            &mut empty(),
            &temporary.join("other"),
            &temporary.join("release")
        )
        .is_err());
        fs::remove_dir_all(temporary).unwrap();
    }
    #[test]
    fn historical_adapter_identities_are_explicit_package_metadata() {
        let record = json!({"manifest":{"id":"protocol.workflow","version":"2.0.0","legacyProviders":[{"pluginId":"builtin.workflow","version":"1.0.0","provider":{"id":"workflow"}}]}});
        assert!(record_matches_reference(
            &record,
            &json!({"id":"builtin.workflow","version":"1.0.0","providerId":"workflow"})
        ));
        assert!(!record_matches_reference(
            &record,
            &json!({"id":"builtin.workflow","version":"1.0.1","providerId":"workflow"})
        ));
        assert!(!record_matches_reference(
            &record,
            &json!({"id":"builtin.workflow","version":"1.0.0","providerId":"other"})
        ));
    }
}
