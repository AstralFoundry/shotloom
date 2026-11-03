use super::{
    common::{file_result, user_file, localized_error},
    media_paths,
    system_proxy::resolved_system_proxy_url,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::StreamExt;
use reqwest::{header, multipart, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::IpAddr,
    path::Path,
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

const BLOCKED_HEADERS: &[&str] = &[
    "authorization",
    "proxy-authorization",
    "host",
    "origin",
    "cookie",
    "content-length",
    "connection",
];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationAuth {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub name: Option<String>,
    pub prefix: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResource {
    pub field_name: String,
    pub file_path: Option<String>,
    pub url: Option<String>,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRequest {
    pub request_id: String,
    pub provider_id: String,
    pub path: String,
    pub scope: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub auth: Option<GenerationAuth>,
    pub body: Option<Value>,
    pub form_fields: Vec<(String, String)>,
    pub resources: Vec<GenerationResource>,
    pub response_encoding: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResponse {
    pub status: u16,
    pub body: String,
    pub body_base64: Option<String>,
    pub content_type: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationDownload {
    pub request_id: String,
    pub provider_id: String,
    pub url: Option<String>,
    pub path: Option<String>,
    pub scope: Option<String>,
    pub method: Option<String>,
    pub target: String,
    pub headers: Vec<(String, String)>,
    pub auth: Option<GenerationAuth>,
    pub timeout_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationStreamEvent {
    request_id: String,
    chunk_base64: Option<String>,
    error: Option<String>,
    done: bool,
}

pub struct GenerationGatewayState {
    cancellations: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl GenerationGatewayState {
    pub fn new() -> Self {
        Self {
            cancellations: Mutex::new(HashMap::new()),
        }
    }
}

fn provider_credentials(app: &AppHandle, provider: &str) -> Result<(String, String), String> {
    if provider.is_empty() {
        return Ok((String::new(), String::new()));
    }
    let settings = crate::services::storage_service::settings(&user_file(app, crate::services::storage_service::APP_DATABASE)?, &json!({}))?;
    let config = settings
        .get("providerConfigs")
        .and_then(|configs| configs.get(provider))
        .cloned()
        .unwrap_or_else(|| json!({}));
    // baseUrl 的实际生效值由渲染进程按内置厂商适配器写进设置，这里不维护任何厂商地址。
    let base_url = config
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| localized_error("native.error.b9a51012cb", json!({"provider": provider.to_string()}), format!("请先在设置中配置 {provider} API 地址和 Key")))?
        .trim_end_matches('/')
        .to_string();
    let api_key = config
        .get("apiKey")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok((base_url, api_key))
}

fn request_url(base_url: &str, path: &str, scope: &str) -> Result<Url, String> {
    if !path.starts_with('/') || path.starts_with("//") {
        return Err(localized_error("native.error.1d513b8ee5", json!({}), "模型请求必须使用相对 endpoint path".into()));
    }
    if !matches!(scope, "origin" | "root" | "v1") {
        return Err(localized_error("native.error.7e17e60b95", json!({"scope": scope.to_string()}), format!("模型请求 endpoint scope 无效：{scope}")));
    }
    if scope == "origin" {
        return Url::parse(base_url)
            .and_then(|base| base.join(path))
            .map_err(|error| error.to_string());
    }
    let suffix = if scope == "root" || base_url.to_ascii_lowercase().ends_with("/v1") {
        path.to_string()
    } else {
        format!("/v1{path}")
    };
    Url::parse(&format!("{base_url}{suffix}")).map_err(|error| error.to_string())
}

#[cfg(test)]
mod request_url_tests {
    use super::request_url;

    #[test]
    fn origin_scope_discards_the_configured_base_path() {
        let url = request_url(
            "https://starrouter.io/v1",
            "/volcengine/doubao/contents/generations/tasks",
            "origin",
        )
        .expect("origin endpoint should compile");
        assert_eq!(
            url.as_str(),
            "https://starrouter.io/volcengine/doubao/contents/generations/tasks"
        );
    }

    #[test]
    fn root_scope_keeps_the_configured_base_path() {
        let url = request_url("https://starrouter.io/v1", "/chat/completions", "root")
            .expect("root endpoint should compile");
        assert_eq!(url.as_str(), "https://starrouter.io/v1/chat/completions");
    }

    #[test]
    fn unknown_scope_is_rejected() {
        let error = request_url("https://starrouter.io/v1", "/chat/completions", "other")
            .expect_err("unknown scope must fail");
        assert!(error.contains("scope 无效"));
        let envelope: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(envelope["type"], "shotloom:localized-error");
        assert_eq!(envelope["params"]["scope"], "other");

    }
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => !(v4.is_loopback()
            || v4.is_private()
            || v4.is_link_local()
            || v4.is_unspecified()
            || v4.is_broadcast()
            || v4.is_documentation()
            || v4.is_multicast()),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(mapped));
            }
            let segments = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || segments[0] & 0xfe00 == 0xfc00
                || segments[0] == 0xfe80)
        }
    }
}

/// 只有公网可路由地址才允许在厂商配置之外被访问；回环、内网、链路本地与元数据地址
/// （169.254.169.254、metadata.google.internal 等）只能命中厂商自己的 endpoint。
fn is_public_host(host: &str) -> bool {
    if host.is_empty()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
    {
        return false;
    }
    match host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>() {
        Ok(address) => is_public_ip(address),
        Err(_) => true,
    }
}

fn host_of(url: &Url) -> String {
    url.host_str().unwrap_or_default().to_ascii_lowercase()
}

fn host_of_text(base_url: &str) -> String {
    Url::parse(base_url)
        .map(|url| host_of(&url))
        .unwrap_or_default()
}

/// 厂商的结果下载经常落在同域 CDN 上，所以按"同主机或父子域"判定，而不是逐字比较 origin。
fn host_belongs_to_base(host: &str, base_host: &str) -> bool {
    if host.is_empty() || base_host.is_empty() {
        return false;
    }
    host == base_host
        || host.ends_with(&format!(".{base_host}"))
        || base_host.ends_with(&format!(".{host}"))
}

/// 出网请求的统一边界：非厂商域名不得访问内网，凭证也只在厂商域名内注入。
fn guard_outbound_url(url: &Url, base_url: &str) -> Result<bool, String> {
    let host = host_of(url);
    let provider = host_belongs_to_base(&host, &host_of_text(base_url));
    if !provider && !is_public_host(&host) {
        return Err(localized_error("native.error.149d3b51a9", json!({"host": host.to_string()}), format!(
            "模型请求目标 {host} 不是厂商配置的公网地址，已被网关拒绝"
        )));
    }
    Ok(provider)
}

fn gateway_client(timeout_ms: u64) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_millis(timeout_ms.clamp(1_000, 1_800_000)));
    if let Some(proxy_url) = resolved_system_proxy_url() {
        let parsed = Url::parse(&proxy_url).map_err(|error| error.to_string())?;
        builder = builder.proxy(reqwest::Proxy::custom(move |url| {
            let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
            (!loopback).then(|| parsed.clone())
        }));
    }
    builder.build().map_err(|error| error.to_string())
}

fn safe_headers(values: &[(String, String)]) -> Result<header::HeaderMap, String> {
    let mut headers = header::HeaderMap::new();
    for (name, value) in values {
        if BLOCKED_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
            continue;
        }
        let name = header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| localized_error("native.error.4c67e1f713", json!({"name": name.to_string()}), format!("非法模型请求头：{name}")))?;
        let value = header::HeaderValue::from_str(value)
            .map_err(|_| localized_error("native.error.5e967cccf9", json!({"name": name.to_string()}), format!("非法模型请求头内容：{name}")))?;
        headers.insert(name, value);
    }
    Ok(headers)
}

fn apply_auth(
    mut request: reqwest::RequestBuilder,
    auth: Option<&GenerationAuth>,
    api_key: &str,
) -> Result<reqwest::RequestBuilder, String> {
    let kind = auth
        .and_then(|value| value.kind.as_deref())
        .unwrap_or("bearer");
    if api_key.is_empty() || kind == "none" {
        return Ok(request);
    }
    if kind == "body" {
        return Ok(request);
    }
    let prefix = auth
        .and_then(|value| value.prefix.as_deref())
        .unwrap_or(if kind == "header" { "" } else { "Bearer " });
    let value = header::HeaderValue::from_str(&format!("{prefix}{api_key}"))
        .map_err(|_| localized_error("native.error.3fa3180be6", json!({}), "模型 API Key 无法写入请求头".to_string()))?;
    if kind == "header" {
        let name = auth
            .and_then(|value| value.name.as_deref())
            .ok_or_else(|| localized_error("native.error.f5e4b43bf6", json!({}), "模型鉴权缺少 header 名称".to_string()))?;
        let name = header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| localized_error("native.error.ae79cced61", json!({}), "模型鉴权 header 名称非法".to_string()))?;
        request = request.header(name, value);
    } else {
        request = request.header(header::AUTHORIZATION, value);
    }
    Ok(request)
}

fn body_with_auth(
    body: &Value,
    auth: Option<&GenerationAuth>,
    api_key: &str,
) -> Result<Value, String> {
    if auth.and_then(|value| value.kind.as_deref()) != Some("body") || api_key.is_empty() {
        return Ok(body.clone());
    }
    let field = auth
        .and_then(|value| value.name.as_deref())
        .filter(|value| !value.is_empty())
        .unwrap_or("apiKey");
    let mut value = body.clone();
    let object = value
        .as_object_mut()
        .ok_or_else(|| localized_error("native.error.86ee5cfe82", json!({}), "Body 鉴权要求 JSON 对象请求体".to_string()))?;
    object.insert(field.to_string(), Value::String(api_key.to_string()));
    Ok(value)
}

async fn resource_bytes(
    app: &AppHandle,
    client: &reqwest::Client,
    base_url: &str,
    resource: &GenerationResource,
) -> Result<Vec<u8>, String> {
    if let Some(path) = resource
        .file_path
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let resolved = media_paths::resolve_input_file(
            &super::common::app_data(app)?,
            media_paths::home_root().as_deref(),
            path,
        )?;
        return tauri::async_runtime::spawn_blocking(move || std::fs::read(&resolved))
            .await
            .map_err(|error| localized_error("native.error.dca132d901", json!({"error": error.to_string()}), format!("模型输入文件读取任务失败：{error}")))?
            .map_err(|error| localized_error("native.error.6fd93f3505", json!({"path": path.to_string(), "error": error.to_string()}), format!("无法读取模型输入文件 {path}: {error}")));
    }
    let url = resource.url.as_deref().unwrap_or_default();
    if let Some((_, encoded)) = url
        .strip_prefix("data:")
        .and_then(|value| value.split_once(','))
    {
        return BASE64
            .decode(encoded)
            .map_err(|error| localized_error("native.error.67c6e0e72b", json!({"error": error.to_string()}), format!("无法解析模型输入 Data URL: {error}")));
    }
    if url.starts_with("https://") || url.starts_with("http://") {
        let parsed =
            Url::parse(url).map_err(|error| localized_error("native.error.665564b3f1", json!({"error": error.to_string()}), format!("模型输入 URL 无效：{error}")))?;
        guard_outbound_url(&parsed, base_url)?;
        let response = client
            .get(parsed)
            .send()
            .await
            .map_err(|error| localized_error("native.error.ffe3bd1546", json!({"error": error.to_string()}), format!("无法下载模型输入：{error}")))?;
        if !response.status().is_success() {
            return Err(localized_error("native.error.db3a1e507b", json!({"status": (response.status()).to_string()}), format!("无法下载模型输入（HTTP {}）", response.status())));
        }
        return response
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|error| error.to_string());
    }
    Err(localized_error("native.error.5d56c3b00a", json!({}), "模型 multipart 输入缺少有效文件或 URL".into()))
}

async fn build_request(
    app: &AppHandle,
    input: &GenerationRequest,
) -> Result<reqwest::RequestBuilder, String> {
    let (base_url, api_key) = provider_credentials(app, &input.provider_id)?;
    let url = request_url(&base_url, &input.path, &input.scope)?;
    let client = gateway_client(input.timeout_ms)?;
    let method = Method::from_bytes(input.method.as_bytes())
        .map_err(|_| localized_error("native.error.c38b49368d", json!({"method": (input.method).to_string()}), format!("非法模型请求方法：{}", input.method)))?;
    let mut request = client
        .request(method, url)
        .headers(safe_headers(&input.headers)?);
    request = apply_auth(request, input.auth.as_ref(), &api_key)?;
    if !input.form_fields.is_empty() || !input.resources.is_empty() {
        let mut form = multipart::Form::new();
        for (name, value) in &input.form_fields {
            form = form.text(name.clone(), value.clone());
        }
        for resource in &input.resources {
            let bytes = resource_bytes(app, &client, &base_url, resource).await?;
            let fallback = Path::new(resource.file_path.as_deref().unwrap_or_default())
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("input.bin");
            let mut part = multipart::Part::bytes(bytes).file_name(
                resource
                    .file_name
                    .as_deref()
                    .unwrap_or(fallback)
                    .to_string(),
            );
            if let Some(mime) = resource
                .mime_type
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                part = part.mime_str(mime).map_err(|error| error.to_string())?;
            }
            form = form.part(resource.field_name.clone(), part);
        }
        request = request.multipart(form);
    } else if let Some(body) = &input.body {
        request = request.json(&body_with_auth(body, input.auth.as_ref(), &api_key)?);
    }
    Ok(request)
}

async fn cancellation(state: &GenerationGatewayState, request_id: &str) -> oneshot::Receiver<()> {
    let (sender, receiver) = oneshot::channel();
    if let Some(previous) = state
        .cancellations
        .lock()
        .await
        .insert(request_id.into(), sender)
    {
        let _ = previous.send(());
    }
    receiver
}

#[tauri::command]
pub async fn generation_request(
    app: AppHandle,
    state: tauri::State<'_, GenerationGatewayState>,
    request: GenerationRequest,
) -> Result<GenerationResponse, String> {
    let mut cancel = cancellation(&state, &request.request_id).await;
    let result = async {
        let outgoing = build_request(&app, &request).await?;
        let response = tokio::select! {
            _ = &mut cancel => return Err(localized_error("native.error.f25ccd81d4", json!({}), "模型请求已取消".into())),
            result = outgoing.send() => result.map_err(|error| localized_error("native.error.5d1854bdb4", json!({"error": error.to_string()}), format!("模型网络请求失败：{error}")))?,
        };
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let bytes = tokio::select! {
            _ = &mut cancel => return Err(localized_error("native.error.f25ccd81d4", json!({}), "模型请求已取消".into())),
            result = response.bytes() => result.map_err(|error| localized_error("native.error.78e1f1f568", json!({"error": error.to_string()}), format!("模型响应读取失败：{error}")))?,
        };
        let binary = request.response_encoding.as_deref() == Some("binary")
            && (200..300).contains(&status);
        Ok(GenerationResponse {
            status,
            body: if binary { String::new() } else { String::from_utf8_lossy(&bytes).into_owned() },
            body_base64: binary.then(|| BASE64.encode(&bytes)),
            content_type,
        })
    }
    .await;
    state.cancellations.lock().await.remove(&request.request_id);
    result
}

#[tauri::command]
pub async fn generation_stream(
    app: AppHandle,
    state: tauri::State<'_, GenerationGatewayState>,
    request: GenerationRequest,
) -> Result<GenerationResponse, String> {
    let mut cancel = cancellation(&state, &request.request_id).await;
    let result = async {
        let outgoing = build_request(&app, &request).await?;
        let response = tokio::select! {
            _ = &mut cancel => return Err(localized_error("native.error.f25ccd81d4", json!({}), "模型请求已取消".into())),
            result = outgoing.send() => result.map_err(|error| localized_error("native.error.5d1854bdb4", json!({"error": error.to_string()}), format!("模型网络请求失败：{error}")))?,
        };
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        if !response.status().is_success() {
            let body = response.text().await.map_err(|error| error.to_string())?;
            return Ok(GenerationResponse { status, body, body_base64: None, content_type });
        }
        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        loop {
            tokio::select! {
                _ = &mut cancel => return Err(localized_error("native.error.f25ccd81d4", json!({}), "模型请求已取消".into())),
                next = stream.next() => match next {
                    Some(Ok(bytes)) => {
                        body.extend_from_slice(&bytes);
                        let _ = app.emit("generation-stream-event", GenerationStreamEvent {
                            request_id: request.request_id.clone(),
                            chunk_base64: Some(BASE64.encode(bytes)),
                            error: None,
                            done: false,
                        });
                    }
                    Some(Err(error)) => return Err(localized_error("native.error.9022ebe72c", json!({"error": error.to_string()}), format!("模型流读取失败：{error}"))),
                    None => break,
                }
            }
        }
        Ok(GenerationResponse {
            status,
            body: String::from_utf8_lossy(&body).into_owned(),
            body_base64: None,
            content_type,
        })
    }
    .await;
    let error = result.as_ref().err().cloned();
    let _ = app.emit(
        "generation-stream-event",
        GenerationStreamEvent {
            request_id: request.request_id.clone(),
            chunk_base64: None,
            error,
            done: true,
        },
    );
    state.cancellations.lock().await.remove(&request.request_id);
    result
}

#[tauri::command]
pub async fn generation_download(
    app: AppHandle,
    state: tauri::State<'_, GenerationGatewayState>,
    request: GenerationDownload,
) -> Result<Value, String> {
    let (base_url, api_key) = provider_credentials(&app, &request.provider_id)?;
    let url = if let Some(value) = request.url.as_deref().filter(|value| !value.is_empty()) {
        Url::parse(value).map_err(|error| error.to_string())?
    } else {
        let path = request
            .path
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| localized_error("native.error.715379073d", json!({}), "生成结果下载缺少 URL 或 endpoint path".to_string()))?;
        request_url(&base_url, path, request.scope.as_deref().unwrap_or("root"))?
    };
    if !matches!(url.scheme(), "http" | "https") {
        return Err(localized_error("native.error.eedb6e6f1f", json!({}), "生成结果下载只允许 HTTP(S) URL".into()));
    }
    // 结果 URL 来自厂商响应，属于外部输入：跨出厂商域名时不得访问内网，也不再携带 Key。
    // 同域之外的下载链接都是自带签名的临时地址，去掉凭证不会改变正常下载。
    let from_provider = guard_outbound_url(&url, &base_url)?;
    let api_key = from_provider.then(|| api_key.clone()).unwrap_or_default();
    let client = gateway_client(request.timeout_ms)?;
    let method = Method::from_bytes(request.method.as_deref().unwrap_or("GET").as_bytes())
        .map_err(|_| localized_error("native.error.06d9112d74", json!({}), "生成结果下载 method 非法".to_string()))?;
    let outgoing = apply_auth(
        client
            .request(method, url)
            .headers(safe_headers(&request.headers)?),
        request.auth.as_ref(),
        &api_key,
    )?;
    let mut cancel = cancellation(&state, &request.request_id).await;
    let result = async {
        let response = tokio::select! {
            _ = &mut cancel => return Err(localized_error("native.error.153550501e", json!({}), "生成结果下载已取消".into())),
            result = outgoing.send() => result.map_err(|error| localized_error("native.error.56e76e0148", json!({"error": error.to_string()}), format!("生成结果下载失败：{error}")))?,
        };
        if !response.status().is_success() {
            return Err(localized_error("native.error.09e95a731f", json!({"status": (response.status()).to_string()}), format!("生成结果下载失败（HTTP {}）", response.status())));
        }
        let bytes = tokio::select! {
            _ = &mut cancel => return Err(localized_error("native.error.153550501e", json!({}), "生成结果下载已取消".into())),
            result = response.bytes() => result.map_err(|error| localized_error("native.error.26a1a61233", json!({"error": error.to_string()}), format!("生成结果读取失败：{error}")))?,
        };
        let target = Path::new(&request.target);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::write(target, bytes).map_err(|error| error.to_string())?;
        file_result(target)
    }
    .await;
    state.cancellations.lock().await.remove(&request.request_id);
    result
}

#[tauri::command]
pub async fn generation_cancel(
    state: tauri::State<'_, GenerationGatewayState>,
    request_id: String,
) -> Result<bool, String> {
    let Some(cancel) = state.cancellations.lock().await.remove(&request_id) else {
        return Ok(false);
    };
    let _ = cancel.send(());
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gateway_builds_scoped_provider_urls() {
        assert_eq!(
            request_url("https://api.example.com", "/images/generations", "v1")
                .unwrap()
                .as_str(),
            "https://api.example.com/v1/images/generations"
        );
        assert_eq!(
            request_url("https://api.example.com/v1", "/chat/completions", "v1")
                .unwrap()
                .as_str(),
            "https://api.example.com/v1/chat/completions"
        );
        assert!(request_url("https://api.example.com", "https://evil.test", "root").is_err());
    }

    #[test]
    fn gateway_blocks_renderer_owned_credentials() {
        let headers = safe_headers(&[
            ("authorization".into(), "secret".into()),
            ("x-request-id".into(), "safe".into()),
        ])
        .unwrap();
        assert!(headers.get(header::AUTHORIZATION).is_none());
        assert_eq!(headers.get("x-request-id").unwrap(), "safe");
    }

    #[test]
    fn gateway_injects_body_credentials_without_mutating_renderer_payload() {
        let body = json!({ "workflowId": "workflow-1" });
        let auth = GenerationAuth {
            kind: Some("body".into()),
            name: Some("apiKey".into()),
            prefix: None,
        };
        assert_eq!(
            body_with_auth(&body, Some(&auth), "secret").unwrap(),
            json!({ "workflowId": "workflow-1", "apiKey": "secret" }),
        );
        assert!(body.get("apiKey").is_none());
    }

    #[test]
    fn outbound_urls_are_allowed_on_the_provider_domain_only_when_private() {
        let base = "https://starrouter.io/v1";
        assert!(guard_outbound_url(
            &Url::parse("https://cdn.starrouter.io/result/clip.mp4").unwrap(),
            base
        )
        .unwrap());
        assert!(!guard_outbound_url(
            &Url::parse("https://signed-other-cdn.test/result/clip.mp4").unwrap(),
            base
        )
        .unwrap());
        let internal = Url::parse("http://169.254.169.254/latest/meta-data/iam").unwrap();
        let error = guard_outbound_url(&internal, base).expect_err("metadata endpoint must be refused");
        assert!(error.contains("不是厂商配置的公网地址"));
        assert!(guard_outbound_url(
            &Url::parse("http://metadata.google.internal/").unwrap(),
            base
        )
        .is_err());
    }

    #[test]
    fn locally_configured_provider_endpoints_keep_working() {
        let base = "http://127.0.0.1:8188/api";
        assert!(guard_outbound_url(
            &Url::parse("http://127.0.0.1:8188/view?filename=a.png").unwrap(),
            base
        )
        .unwrap());
        assert!(guard_outbound_url(
            &Url::parse("http://localhost:3000/leak").unwrap(),
            base
        )
        .is_err());
    }
}
