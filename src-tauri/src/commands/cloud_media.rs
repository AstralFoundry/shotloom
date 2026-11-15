use super::{common::{app_data, file_result}, media_paths::resolve_input_file};
use futures_util::StreamExt;
use serde_json::Value;
use std::{path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data(app)?.join("cloud-media-cache"))
}

pub(super) fn workspace(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let id = uuid::Uuid::parse_str(id).map_err(|_| "Invalid media workspace")?;
    Ok(cache_root(app)?.join(id.to_string()))
}

fn storage_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid Storage URL")?;
    if url.scheme() != "https" || url.host_str() != Some("dnxsksdoipdctstpqtsa.supabase.co")
        || url.port().is_some() || !url.username().is_empty() || url.password().is_some()
        || !url.path().starts_with("/storage/v1/object/") {
        return Err("Only the configured Supabase Storage is allowed".into());
    }
    Ok(url)
}

#[tauri::command]
pub fn cloud_media_workspace(app: AppHandle) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let path = workspace(&app, &id)?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "id": id, "path": path.to_string_lossy() }))
}

#[tauri::command]
pub async fn cloud_media_release(app: AppHandle, id: String) -> Result<(), String> {
    let path = workspace(&app, &id)?;
    match tokio::fs::remove_dir_all(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn cloud_media_download(app: AppHandle, window: tauri::WebviewWindow, id: String, url: String, extension: String) -> Result<Value, String> {
    if window.label() != "main" { return Err("Untrusted media download caller".into()); }
    let origin = window.url().map_err(|e| e.to_string())?;
    let target = origin.join(&url).map_err(|_| "Invalid media URL")?;
    let cookie = if target.scheme() == "https" && target.origin() == origin.origin()
        && target.path() == "/api/files/remote" && target.username().is_empty() && target.password().is_none() {
        let cookie = window.cookies_for_url(target.clone()).map_err(|_| "Cannot read cloud session")?
            .into_iter().find(|cookie| cookie.name() == "shotloom_session" && cookie.http_only() == Some(true))
            .ok_or("Sign in before downloading media")?;
        Some(format!("shotloom_session={}", cookie.value()))
    } else { storage_url(target.as_str())?; None };
    if extension.is_empty() || extension.len() > 10 || !extension.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Invalid media extension".into());
    }
    let path = workspace(&app, &id)?.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
    let result = async {
        let mut request = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(900))
            .build().map_err(|e| e.to_string())?.get(target);
        if let Some(cookie) = cookie { request = request.header(reqwest::header::COOKIE, cookie); }
        let response = request.send().await.map_err(|_| "Media download failed")?;
        if !response.status().is_success() { return Err(format!("Storage download HTTP {}", response.status())); }
        const MAX_BYTES: u64 = 500 * 1024 * 1024;
        if response.content_length().is_some_and(|size| size > MAX_BYTES) { return Err("Media exceeds 500 MiB".into()); }
        let mut file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(&path).await.map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        let mut size = 0_u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "Storage stream failed")?;
            size += chunk.len() as u64;
            if size > MAX_BYTES { return Err("Media exceeds 500 MiB".into()); }
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        }
        file.flush().await.map_err(|e| e.to_string())?;
        file_result(&path)
    }.await;
    if result.is_err() { let _ = tokio::fs::remove_file(&path).await; }
    result
}

#[tauri::command]
pub async fn cloud_media_upload(app: AppHandle, source: String, url: String, content_type: String) -> Result<Value, String> {
    let url = storage_url(&url)?;
    let path = resolve_input_file(&app_data(&app)?, app.path().home_dir().ok().as_deref(), &source)?;
    let file = tokio::fs::File::open(&path).await.map_err(|e| e.to_string())?;
    let size = file.metadata().await.map_err(|e| e.to_string())?.len();
    let stream = futures_util::stream::try_unfold(file, |mut file| async {
        let mut buffer = vec![0_u8; 1024 * 1024];
        let count = file.read(&mut buffer).await?;
        if count == 0 { return Ok::<_, std::io::Error>(None); }
        buffer.truncate(count);
        Ok(Some((buffer, file)))
    });
    let response = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(900))
        .build().map_err(|e| e.to_string())?.put(url).header("Content-Type", content_type).header("Content-Length", size)
        .body(reqwest::Body::wrap_stream(stream)).send().await.map_err(|_| "Storage upload failed")?;
    if !response.status().is_success() { return Err(format!("Storage upload HTTP {}", response.status())); }
    Ok(serde_json::json!({ "size": size }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transfer_urls_cannot_reach_local_services_or_other_projects() {
        assert!(storage_url("https://dnxsksdoipdctstpqtsa.supabase.co/storage/v1/object/sign/shotloom-media/x?token=t").is_ok());
        for url in ["http://127.0.0.1/storage/v1/object/x", "https://other.supabase.co/storage/v1/object/x",
            "https://dnxsksdoipdctstpqtsa.supabase.co/auth/v1/user", "https://user:pass@dnxsksdoipdctstpqtsa.supabase.co/storage/v1/object/x"] {
            assert!(storage_url(url).is_err());
        }
    }
}
