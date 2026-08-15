use super::{
    agent_runtime::resolved_system_proxy_url,
    common::{file_result, read_json, user_file},
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::StreamExt;
use reqwest::{header, multipart, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path, time::Duration};
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

fn default_base_url(provider: &str) -> &'static str {
    match provider {
        "openai" => "https://api.openai.com/v1",
        "bytedance" => "https://ark.cn-beijing.volces.com/api/v3",
        "kling" => "https://api-singapore.klingai.com",
        "minimax" => "https://api.minimax.io",
        "google" => "https://generativelanguage.googleapis.com/v1beta",
        "xai" => "https://api.x.ai/v1",
        "anthropic" => "https://api.anthropic.com",
        "deepseek" => "https://api.deepseek.com/v1",
        "moonshot" => "https://api.moonshot.ai/v1",
        "zhipu" => "https://open.bigmodel.cn/api",
        _ => "",
    }
}

fn provider_credentials(app: &AppHandle, provider: &str) -> Result<(String, String), String> {
    if provider.is_empty() {
        return Ok((String::new(), String::new()));
    }
    let settings = read_json(&user_file(app, "app-settings.json")?, json!({}))?;
    let config = settings
        .get("providerConfigs")
        .and_then(|configs| configs.get(provider))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let base_url = config
        .get("baseUrl")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_base_url(provider))
        .trim_end_matches('/')
        .to_string();
    if base_url.is_empty() {
        return Err(format!("请先在设置中配置 {provider} API 地址和 Key"));
    }
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
        return Err("模型请求必须使用相对 endpoint path".into());
    }
    let suffix = if scope == "root" || base_url.to_ascii_lowercase().ends_with("/v1") {
        path.to_string()
    } else {
        format!("/v1{path}")
    };
    Url::parse(&format!("{base_url}{suffix}")).map_err(|error| error.to_string())
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
            .map_err(|_| format!("非法模型请求头：{name}"))?;
        let value = header::HeaderValue::from_str(value)
            .map_err(|_| format!("非法模型请求头内容：{name}"))?;
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
    let prefix = auth
        .and_then(|value| value.prefix.as_deref())
        .unwrap_or(if kind == "header" { "" } else { "Bearer " });
    let value = header::HeaderValue::from_str(&format!("{prefix}{api_key}"))
        .map_err(|_| "模型 API Key 无法写入请求头".to_string())?;
    if kind == "header" {
        let name = auth
            .and_then(|value| value.name.as_deref())
            .ok_or_else(|| "模型鉴权缺少 header 名称".to_string())?;
        let name = header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "模型鉴权 header 名称非法".to_string())?;
        request = request.header(name, value);
    } else {
        request = request.header(header::AUTHORIZATION, value);
    }
    Ok(request)
}

async fn resource_bytes(
    client: &reqwest::Client,
    resource: &GenerationResource,
) -> Result<Vec<u8>, String> {
    if let Some(path) = resource
        .file_path
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        return std::fs::read(path)
            .map_err(|error| format!("无法读取模型输入文件 {path}: {error}"));
    }
    let url = resource.url.as_deref().unwrap_or_default();
    if let Some((_, encoded)) = url
        .strip_prefix("data:")
        .and_then(|value| value.split_once(','))
    {
        return BASE64
            .decode(encoded)
            .map_err(|error| format!("无法解析模型输入 Data URL: {error}"));
    }
    if url.starts_with("https://") || url.starts_with("http://") {
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|error| format!("无法下载模型输入：{error}"))?;
        if !response.status().is_success() {
            return Err(format!("无法下载模型输入（HTTP {}）", response.status()));
        }
        return response
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|error| error.to_string());
    }
    Err("模型 multipart 输入缺少有效文件或 URL".into())
}

async fn build_request(
    app: &AppHandle,
    input: &GenerationRequest,
) -> Result<reqwest::RequestBuilder, String> {
    let (base_url, api_key) = provider_credentials(app, &input.provider_id)?;
    let url = request_url(&base_url, &input.path, &input.scope)?;
    let client = gateway_client(input.timeout_ms)?;
    let method = Method::from_bytes(input.method.as_bytes())
        .map_err(|_| format!("非法模型请求方法：{}", input.method))?;
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
            let bytes = resource_bytes(&client, resource).await?;
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
        request = request.json(body);
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
            _ = &mut cancel => return Err("模型请求已取消".into()),
            result = outgoing.send() => result.map_err(|error| format!("模型网络请求失败：{error}"))?,
        };
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let bytes = tokio::select! {
            _ = &mut cancel => return Err("模型请求已取消".into()),
            result = response.bytes() => result.map_err(|error| format!("模型响应读取失败：{error}"))?,
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
            _ = &mut cancel => return Err("模型请求已取消".into()),
            result = outgoing.send() => result.map_err(|error| format!("模型网络请求失败：{error}"))?,
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
                _ = &mut cancel => return Err("模型请求已取消".into()),
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
                    Some(Err(error)) => return Err(format!("模型流读取失败：{error}")),
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
            .ok_or_else(|| "生成结果下载缺少 URL 或 endpoint path".to_string())?;
        request_url(&base_url, path, request.scope.as_deref().unwrap_or("root"))?
    };
    if !matches!(url.scheme(), "http" | "https") {
        return Err("生成结果下载只允许 HTTP(S) URL".into());
    }
    let client = gateway_client(request.timeout_ms)?;
    let method = Method::from_bytes(request.method.as_deref().unwrap_or("GET").as_bytes())
        .map_err(|_| "生成结果下载 method 非法".to_string())?;
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
            _ = &mut cancel => return Err("生成结果下载已取消".into()),
            result = outgoing.send() => result.map_err(|error| format!("生成结果下载失败：{error}"))?,
        };
        if !response.status().is_success() {
            return Err(format!("生成结果下载失败（HTTP {}）", response.status()));
        }
        let bytes = tokio::select! {
            _ = &mut cancel => return Err("生成结果下载已取消".into()),
            result = response.bytes() => result.map_err(|error| format!("生成结果读取失败：{error}"))?,
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
}
