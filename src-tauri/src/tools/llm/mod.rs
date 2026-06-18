use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use futures_util::future::{AbortHandle, Abortable};
use reqwest::header::{CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::tools::mediaflow_api;

const API_REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const PRE_REGISTERED_CANCEL_TTL: Duration = Duration::from_secs(30);
const USER_AGENT: &str = "MediaFlow/1.0";
const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const GOOGLE_GENERATE_CONTENT_BASE_URL: &str = "https://generativelanguage.googleapis.com";
const OPENROUTER_CHAT_COMPLETIONS_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TITLE: &str = "MediaFlow";

struct ActiveLlmRequest {
    abort_handle: AbortHandle,
    mediaflow_access_token: Option<String>,
}

#[derive(Default)]
struct LlmAbortRegistry {
    active: HashMap<String, ActiveLlmRequest>,
    pre_registered_cancels: HashMap<String, Instant>,
}

static LLM_ABORTS: LazyLock<Mutex<LlmAbortRegistry>> =
    LazyLock::new(|| Mutex::new(LlmAbortRegistry::default()));

fn prune_pre_registered_cancels(registry: &mut LlmAbortRegistry) {
    let now = Instant::now();
    registry.pre_registered_cancels.retain(|_, cancelled_at| {
        now.saturating_duration_since(*cancelled_at) <= PRE_REGISTERED_CANCEL_TTL
    });
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LlmProvider {
    Openai,
    Anthropic,
    Google,
    Openrouter,
    Mediaflow,
}

impl LlmProvider {
    fn label(self) -> &'static str {
        match self {
            Self::Openai => "OpenAI",
            Self::Anthropic => "Anthropic",
            Self::Google => "Google AI",
            Self::Openrouter => "OpenRouter",
            Self::Mediaflow => "MediaFlow",
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
            Self::Google => "google",
            Self::Openrouter => "openrouter",
            Self::Mediaflow => "mediaflow",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LlmResponseMode {
    Json,
    Text,
}

impl Default for LlmResponseMode {
    fn default() -> Self {
        Self::Json
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub(crate) enum LlmContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image {
        #[serde(rename = "mimeType")]
        mime_type: String,
        data: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LlmRequest {
    provider: LlmProvider,
    #[serde(default)]
    api_key: String,
    model: String,
    system_prompt: String,
    user_prompt: String,
    #[serde(default)]
    user_content_parts: Vec<LlmContentPart>,
    temperature: Option<f64>,
    #[serde(default)]
    response_mode: LlmResponseMode,
    #[serde(default)]
    mediaflow_access_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LlmUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LlmResponse {
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    technical_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    finish_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cancelled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<LlmUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retryable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedApiError {
    message: String,
    retryable: bool,
    retry_after: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MediaFlowApiError {
    message: String,
    code: Option<String>,
    request_id: Option<String>,
    raw_body: String,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(API_REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to create LLM HTTP client: {}", e))
}

fn empty_success(content: String) -> LlmResponse {
    LlmResponse {
        content,
        error: None,
        error_code: None,
        error_message: None,
        request_id: None,
        technical_error: None,
        truncated: None,
        finish_reason: None,
        cancelled: None,
        usage: None,
        retryable: None,
        retry_after: None,
        status: None,
    }
}

fn error_response(
    error: impl Into<String>,
    retryable: bool,
    retry_after: Option<u64>,
    status: Option<u16>,
) -> LlmResponse {
    LlmResponse {
        content: String::new(),
        error: Some(error.into()),
        error_code: None,
        error_message: None,
        request_id: None,
        technical_error: None,
        truncated: None,
        finish_reason: None,
        cancelled: None,
        usage: None,
        retryable: Some(retryable),
        retry_after,
        status,
    }
}

fn cancelled_response() -> LlmResponse {
    LlmResponse {
        content: String::new(),
        error: Some("Request cancelled".to_string()),
        error_code: None,
        error_message: None,
        request_id: None,
        technical_error: None,
        truncated: None,
        finish_reason: None,
        cancelled: Some(true),
        usage: None,
        retryable: Some(false),
        retry_after: None,
        status: None,
    }
}

fn mediaflow_error_response(
    error: impl Into<String>,
    retryable: bool,
    retry_after: Option<u64>,
    status: Option<u16>,
    error_code: Option<String>,
    error_message: Option<String>,
    request_id: Option<String>,
    technical_error: Option<String>,
) -> LlmResponse {
    let mut response = error_response(error, retryable, retry_after, status);
    response.error_code = error_code;
    response.error_message = error_message;
    response.request_id = request_id;
    response.technical_error = technical_error;
    response
}

fn timeout_response(provider_label: &str) -> LlmResponse {
    error_response(
        format!(
            "{}: Request timeout (>{}s)",
            provider_label,
            API_REQUEST_TIMEOUT.as_secs()
        ),
        true,
        Some(5000),
        None,
    )
}

fn ensure_content_parts(request: &LlmRequest) -> Vec<LlmContentPart> {
    if request.user_content_parts.is_empty() {
        vec![LlmContentPart::Text {
            text: request.user_prompt.clone(),
        }]
    } else {
        request.user_content_parts.clone()
    }
}

fn build_openai_content(parts: &[LlmContentPart]) -> Vec<Value> {
    parts
        .iter()
        .map(|part| match part {
            LlmContentPart::Text { text } => json!({
                "type": "text",
                "text": text,
            }),
            LlmContentPart::Image { mime_type, data } => json!({
                "type": "image_url",
                "image_url": {
                    "url": format!("data:{};base64,{}", mime_type, data),
                },
            }),
        })
        .collect()
}

fn build_openai_chat_body(request: &LlmRequest, include_temperature: bool) -> Value {
    let content_parts = ensure_content_parts(request);
    let mut body = json!({
        "model": &request.model,
        "messages": [
            { "role": "system", "content": &request.system_prompt },
            { "role": "user", "content": build_openai_content(&content_parts) },
        ],
    });

    if include_temperature {
        body["temperature"] = json!(request.temperature.unwrap_or(0.3));
    }

    if request.response_mode == LlmResponseMode::Json {
        body["response_format"] = json!({ "type": "json_object" });
    }

    body
}

fn openai_chat_response(response: Value) -> LlmResponse {
    let finish_reason = response
        .pointer("/choices/0/finish_reason")
        .and_then(Value::as_str)
        .map(str::to_string);
    let content = response
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut output = empty_success(content);
    output.truncated = Some(finish_reason.as_deref() == Some("length"));
    output.finish_reason = finish_reason;
    output.usage = normalize_openai_usage(response.get("usage"));
    output
}

fn build_anthropic_content(parts: &[LlmContentPart]) -> Vec<Value> {
    parts
        .iter()
        .map(|part| match part {
            LlmContentPart::Text { text } => json!({
                "type": "text",
                "text": text,
            }),
            LlmContentPart::Image { mime_type, data } => json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime_type,
                    "data": data,
                },
            }),
        })
        .collect()
}

fn build_google_parts(parts: &[LlmContentPart]) -> Vec<Value> {
    parts
        .iter()
        .map(|part| match part {
            LlmContentPart::Text { text } => json!({ "text": text }),
            LlmContentPart::Image { mime_type, data } => json!({
                "inlineData": {
                    "mimeType": mime_type,
                    "data": data,
                },
            }),
        })
        .collect()
}

fn extract_anthropic_text(content: &Value) -> String {
    content
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| {
                    (part.get("type").and_then(Value::as_str) == Some("text"))
                        .then(|| part.get("text").and_then(Value::as_str))
                        .flatten()
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn extract_google_text(parts: &Value) -> String {
    parts
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn normalize_openai_usage(usage: Option<&Value>) -> Option<LlmUsage> {
    let usage = usage?;
    Some(LlmUsage {
        prompt_tokens: usage
            .get("prompt_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        completion_tokens: usage
            .get("completion_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        total_tokens: usage
            .get("total_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    })
}

fn normalize_anthropic_usage(usage: Option<&Value>) -> Option<LlmUsage> {
    let usage = usage?;
    let prompt_tokens = usage
        .get("input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let completion_tokens = usage
        .get("output_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    Some(LlmUsage {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
    })
}

fn normalize_google_usage(usage: Option<&Value>) -> Option<LlmUsage> {
    let usage = usage?;
    Some(LlmUsage {
        prompt_tokens: usage
            .get("promptTokenCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        completion_tokens: usage
            .get("candidatesTokenCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        total_tokens: usage
            .get("totalTokenCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    })
}

fn retry_after_millis(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("Retry-After")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .map(|seconds| seconds.saturating_mul(1000))
}

fn parse_api_error(
    status: u16,
    error_body: &str,
    provider_label: &str,
    retry_after: Option<u64>,
) -> ParsedApiError {
    let lower_body = error_body.to_lowercase();
    let is_quota_error = lower_body.contains("quota")
        || lower_body.contains("billing")
        || lower_body.contains("insufficient_quota")
        || lower_body.contains("credit");

    match status {
        400 => ParsedApiError {
            message: format!("{}: Bad request - {}", provider_label, error_body),
            retryable: false,
            retry_after: None,
        },
        401 => ParsedApiError {
            message: format!(
                "{}: Invalid API key or authentication failed",
                provider_label
            ),
            retryable: false,
            retry_after: None,
        },
        402 => ParsedApiError {
            message: format!(
                "{}: Payment required - Check your billing/quota",
                provider_label
            ),
            retryable: false,
            retry_after: None,
        },
        403 => ParsedApiError {
            message: format!(
                "{}: Access forbidden - Check API key permissions",
                provider_label
            ),
            retryable: false,
            retry_after: None,
        },
        404 => ParsedApiError {
            message: format!(
                "{}: Model or endpoint not found - Check model name",
                provider_label
            ),
            retryable: false,
            retry_after: None,
        },
        429 if is_quota_error => ParsedApiError {
            message: format!(
                "{}: Quota exceeded - Check your billing/usage limits",
                provider_label
            ),
            retryable: false,
            retry_after: None,
        },
        429 => ParsedApiError {
            message: format!(
                "{}: Rate limit exceeded - Please wait before retrying",
                provider_label
            ),
            retryable: true,
            retry_after: retry_after.or(Some(60_000)),
        },
        500 | 502 | 503 | 504 => ParsedApiError {
            message: format!(
                "{}: Server error ({}) - Try again later",
                provider_label, status
            ),
            retryable: true,
            retry_after: retry_after.or(Some(30_000)),
        },
        _ => ParsedApiError {
            message: format!("{}: API error {} - {}", provider_label, status, error_body),
            retryable: status >= 500,
            retry_after: None,
        },
    }
}

fn mediaflow_api_error_summary(error: &MediaFlowApiError) -> String {
    match error.code.as_deref() {
        Some(code) => format!("{} ({})", error.message, code),
        None => error.message.clone(),
    }
}

fn parse_mediaflow_api_error_body(error_body: &str) -> MediaFlowApiError {
    let Ok(parsed) = serde_json::from_str::<Value>(error_body) else {
        return MediaFlowApiError {
            message: error_body.to_string(),
            code: None,
            request_id: None,
            raw_body: error_body.to_string(),
        };
    };

    let error = parsed.get("error");
    let message = error
        .and_then(|error| error.get("message"))
        .or_else(|| parsed.get("message"))
        .and_then(Value::as_str)
        .unwrap_or(error_body)
        .to_string();
    let code = error
        .and_then(|error| error.get("code"))
        .or_else(|| parsed.get("code"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let request_id = error
        .and_then(|error| error.get("request_id"))
        .or_else(|| parsed.get("request_id"))
        .and_then(Value::as_str)
        .map(str::to_string);

    MediaFlowApiError {
        message,
        code,
        request_id,
        raw_body: error_body.to_string(),
    }
}

fn parse_mediaflow_api_error(
    status: u16,
    error: &MediaFlowApiError,
    retry_after: Option<u64>,
) -> ParsedApiError {
    let retryable = match error.code.as_deref() {
        Some("rate_limit_exceeded" | "free_daily_request_in_progress") => true,
        Some("provider_error" | "service_unavailable") => true,
        Some(
            "free_daily_limit_exceeded"
            | "free_daily_model_not_allowed"
            | "insufficient_credits"
            | "invalid_request"
            | "invalid_token"
            | "starter_access_expired"
            | "starter_model_not_allowed"
            | "subscription_required",
        ) => false,
        _ => status == 429 || status >= 500,
    };
    let retry_after = if retryable {
        match status {
            429 => retry_after.or(Some(60_000)),
            500 | 502 | 503 | 504 => retry_after.or(Some(30_000)),
            _ => retry_after,
        }
    } else {
        None
    };

    ParsedApiError {
        message: format!("MediaFlow: {}", mediaflow_api_error_summary(error)),
        retryable,
        retry_after,
    }
}

fn mediaflow_api_error_message(error_body: &str) -> String {
    mediaflow_api_error_summary(&parse_mediaflow_api_error_body(error_body))
}

fn request_body(value: Value) -> Result<String, LlmResponse> {
    serde_json::to_string(&value).map_err(|e| {
        error_response(
            format!("Failed to serialize LLM request: {}", e),
            false,
            None,
            None,
        )
    })
}

fn mediaflow_chat_request(
    client: &reqwest::Client,
    request_id: &str,
    access_token: &str,
) -> reqwest::RequestBuilder {
    client
        .post(mediaflow_api::chat_completions_url())
        .bearer_auth(access_token)
        .header("X-Request-Id", request_id)
}

fn mediaflow_chat_cancel_request(
    client: &reqwest::Client,
    request_id: &str,
    access_token: &str,
) -> reqwest::RequestBuilder {
    client
        .post(mediaflow_api::chat_completion_cancel_url(request_id))
        .bearer_auth(access_token)
        .header("X-Request-Id", request_id)
}

async fn send_json_request(
    request: reqwest::RequestBuilder,
    body: Value,
    provider: LlmProvider,
) -> Result<Value, LlmResponse> {
    let response = request
        .header(CONTENT_TYPE, HeaderValue::from_static("application/json"))
        .body(request_body(body)?)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                timeout_response(provider.label())
            } else {
                let backend = if provider == LlmProvider::Mediaflow {
                    "backend "
                } else {
                    ""
                };
                error_response(
                    format!(
                        "{}: Network error - Check your {}connection",
                        provider.label(),
                        backend
                    ),
                    true,
                    Some(5000),
                    None,
                )
            }
        })?;

    let status = response.status().as_u16();
    let retry_after = retry_after_millis(response.headers());
    let body = response.text().await.map_err(|e| {
        error_response(
            format!("{}: Failed to read response - {}", provider.label(), e),
            false,
            None,
            Some(status),
        )
    })?;

    if !(200..300).contains(&status) {
        if provider == LlmProvider::Mediaflow {
            let api_error = parse_mediaflow_api_error_body(&body);
            let parsed = parse_mediaflow_api_error(status, &api_error, retry_after);
            return Err(mediaflow_error_response(
                parsed.message,
                parsed.retryable,
                parsed.retry_after,
                Some(status),
                api_error.code,
                Some(api_error.message),
                api_error.request_id,
                Some(api_error.raw_body),
            ));
        }

        let error_body = if provider == LlmProvider::Mediaflow {
            mediaflow_api_error_message(&body)
        } else {
            body
        };
        let parsed = parse_api_error(status, &error_body, provider.label(), retry_after);
        return Err(error_response(
            parsed.message,
            parsed.retryable,
            parsed.retry_after,
            Some(status),
        ));
    }

    serde_json::from_str::<Value>(&body).map_err(|e| {
        error_response(
            format!(
                "{}: Failed to parse JSON response - {}",
                provider.label(),
                e
            ),
            false,
            None,
            Some(status),
        )
    })
}

async fn call_openai_compatible(
    request_builder: reqwest::RequestBuilder,
    request: &LlmRequest,
    include_temperature: bool,
) -> LlmResponse {
    let body = build_openai_chat_body(request, include_temperature);
    match send_json_request(request_builder, body, request.provider).await {
        Ok(response) => openai_chat_response(response),
        Err(error) => error,
    }
}

async fn call_openai(client: &reqwest::Client, request: &LlmRequest) -> LlmResponse {
    call_openai_compatible(
        client
            .post(OPENAI_CHAT_COMPLETIONS_URL)
            .bearer_auth(&request.api_key),
        request,
        true,
    )
    .await
}

async fn call_anthropic(client: &reqwest::Client, request: &LlmRequest) -> LlmResponse {
    let content_parts = ensure_content_parts(request);
    let body = json!({
        "model": &request.model,
        "system": &request.system_prompt,
        "messages": [
            { "role": "user", "content": build_anthropic_content(&content_parts) },
        ],
    });

    let response = match send_json_request(
        client
            .post(ANTHROPIC_MESSAGES_URL)
            .header("x-api-key", &request.api_key)
            .header("anthropic-version", "2023-06-01"),
        body,
        request.provider,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => return error,
    };

    let finish_reason = response
        .get("stop_reason")
        .and_then(Value::as_str)
        .map(str::to_string);
    let content = extract_anthropic_text(response.get("content").unwrap_or(&Value::Null));
    let mut output = empty_success(content);
    output.truncated = Some(finish_reason.as_deref() == Some("max_tokens"));
    output.finish_reason = finish_reason;
    output.usage = normalize_anthropic_usage(response.get("usage"));
    output
}

fn google_generate_content_url(model: &str, api_key: &str) -> String {
    format!(
        "{}/v1beta/models/{}:generateContent?key={}",
        GOOGLE_GENERATE_CONTENT_BASE_URL, model, api_key
    )
}

async fn call_google(client: &reqwest::Client, request: &LlmRequest) -> LlmResponse {
    let content_parts = ensure_content_parts(request);
    let mut generation_config = json!({
        "temperature": request.temperature.unwrap_or(0.3),
        "thinkingConfig": {
            "thinkingLevel": "medium",
        },
    });
    if request.response_mode == LlmResponseMode::Json {
        generation_config["responseMimeType"] = json!("application/json");
    }

    let body = json!({
        "systemInstruction": {
            "parts": [{ "text": &request.system_prompt }],
        },
        "contents": [
            { "parts": build_google_parts(&content_parts) },
        ],
        "generationConfig": generation_config,
    });

    let response = match send_json_request(
        client.post(google_generate_content_url(
            &request.model,
            &request.api_key,
        )),
        body,
        request.provider,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => return error,
    };

    let finish_reason = response
        .pointer("/candidates/0/finishReason")
        .and_then(Value::as_str)
        .map(str::to_string);
    let content = extract_google_text(
        response
            .pointer("/candidates/0/content/parts")
            .unwrap_or(&Value::Null),
    );
    let mut output = empty_success(content);
    output.truncated = Some(finish_reason.as_deref() == Some("MAX_TOKENS"));
    output.finish_reason = finish_reason;
    output.usage = normalize_google_usage(response.get("usageMetadata"));
    output
}

async fn call_openrouter(client: &reqwest::Client, request: &LlmRequest) -> LlmResponse {
    call_openai_compatible(
        client
            .post(OPENROUTER_CHAT_COMPLETIONS_URL)
            .bearer_auth(&request.api_key)
            .header("HTTP-Referer", mediaflow_api::public_base_url())
            .header("X-Title", OPENROUTER_TITLE),
        request,
        true,
    )
    .await
}

fn mediaflow_cancel_token(request: &LlmRequest) -> Option<String> {
    if request.provider == LlmProvider::Mediaflow
        && !request.mediaflow_access_token.trim().is_empty()
    {
        Some(request.mediaflow_access_token.clone())
    } else {
        None
    }
}

async fn send_mediaflow_chat_cancel(request_id: String, access_token: String) {
    let Ok(client) = http_client() else {
        return;
    };

    let _ = mediaflow_chat_cancel_request(&client, &request_id, &access_token)
        .send()
        .await;
}

fn spawn_mediaflow_chat_cancel(request_id: String, access_token: String) {
    tauri::async_runtime::spawn(async move {
        send_mediaflow_chat_cancel(request_id, access_token).await;
    });
}

async fn call_mediaflow(
    client: &reqwest::Client,
    request_id: &str,
    request: &LlmRequest,
) -> LlmResponse {
    if request.mediaflow_access_token.trim().is_empty() {
        return mediaflow_error_response(
            "MediaFlow: Invalid API key or authentication failed",
            false,
            None,
            Some(401),
            Some("invalid_token".to_string()),
            Some("Invalid or expired token.".to_string()),
            None,
            None,
        );
    }

    call_openai_compatible(
        mediaflow_chat_request(client, request_id, &request.mediaflow_access_token),
        request,
        false,
    )
    .await
}

async fn call_provider(request_id: &str, request: LlmRequest) -> LlmResponse {
    if request.provider != LlmProvider::Mediaflow && request.api_key.trim().is_empty() {
        return error_response(
            format!("No API key configured for {}", request.provider.key()),
            false,
            None,
            None,
        );
    }

    if request.model.trim().is_empty() {
        return error_response("No model selected", false, None, None);
    }

    let client = match http_client() {
        Ok(client) => client,
        Err(error) => return error_response(error, false, None, None),
    };

    match request.provider {
        LlmProvider::Openai => call_openai(&client, &request).await,
        LlmProvider::Anthropic => call_anthropic(&client, &request).await,
        LlmProvider::Google => call_google(&client, &request).await,
        LlmProvider::Openrouter => call_openrouter(&client, &request).await,
        LlmProvider::Mediaflow => call_mediaflow(&client, request_id, &request).await,
    }
}

async fn run_abortable_llm_request(
    request_id: String,
    request: LlmRequest,
) -> Result<LlmResponse, String> {
    let mediaflow_access_token = mediaflow_cancel_token(&request);
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    {
        let mut guard = LLM_ABORTS
            .lock()
            .map_err(|_| "Failed to acquire LLM request lock".to_string())?;
        prune_pre_registered_cancels(&mut guard);
        if guard.pre_registered_cancels.remove(&request_id).is_some() {
            return Ok(cancelled_response());
        }
        guard.active.insert(
            request_id.clone(),
            ActiveLlmRequest {
                abort_handle,
                mediaflow_access_token,
            },
        );
    }

    let result = Abortable::new(call_provider(&request_id, request), abort_registration).await;
    if let Ok(mut guard) = LLM_ABORTS.lock() {
        guard.active.remove(&request_id);
        guard.pre_registered_cancels.remove(&request_id);
    }

    match result {
        Ok(response) => Ok(response),
        Err(_) => Ok(cancelled_response()),
    }
}

#[tauri::command]
pub(crate) async fn llm_complete(
    request_id: String,
    request: LlmRequest,
) -> Result<LlmResponse, String> {
    run_abortable_llm_request(request_id, request).await
}

#[tauri::command]
pub(crate) fn cancel_llm_request(request_id: String) -> Result<(), String> {
    let active_request = {
        let mut guard = LLM_ABORTS
            .lock()
            .map_err(|_| "Failed to acquire LLM request lock".to_string())?;
        prune_pre_registered_cancels(&mut guard);
        let active_request = guard.active.remove(&request_id);
        if active_request.is_none() {
            guard
                .pre_registered_cancels
                .insert(request_id.clone(), Instant::now());
        }
        active_request
    };

    if let Some(active_request) = active_request {
        if let Some(access_token) = active_request.mediaflow_access_token {
            spawn_mediaflow_chat_cancel(request_id, access_token);
        }
        active_request.abort_handle.abort();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        LlmContentPart, LlmProvider, LlmRequest, LlmResponseMode, build_google_parts,
        build_openai_chat_body, build_openai_content, google_generate_content_url,
        mediaflow_api_error_message, mediaflow_error_response, parse_api_error,
        parse_mediaflow_api_error, parse_mediaflow_api_error_body,
    };

    fn request(provider: LlmProvider) -> LlmRequest {
        LlmRequest {
            provider,
            api_key: "key".to_string(),
            model: "model".to_string(),
            system_prompt: "system".to_string(),
            user_prompt: "user".to_string(),
            user_content_parts: Vec::new(),
            temperature: None,
            response_mode: LlmResponseMode::Json,
            mediaflow_access_token: String::new(),
        }
    }

    #[test]
    fn build_openai_content_maps_text_and_image_parts() {
        let parts = vec![
            LlmContentPart::Text {
                text: "hello".to_string(),
            },
            LlmContentPart::Image {
                mime_type: "image/png".to_string(),
                data: "abc".to_string(),
            },
        ];

        let content = build_openai_content(&parts);

        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[1]["image_url"]["url"], "data:image/png;base64,abc");
    }

    #[test]
    fn build_openai_chat_body_includes_temperature_when_provider_supports_it() {
        let mut request = request(LlmProvider::Openai);
        request.temperature = Some(0.7);

        let body = build_openai_chat_body(&request, true);

        assert_eq!(body["temperature"].as_f64(), Some(0.7));
    }

    #[test]
    fn build_openai_chat_body_omits_temperature_when_provider_does_not_support_it() {
        let mut request = request(LlmProvider::Mediaflow);
        request.temperature = Some(0.7);

        let body = build_openai_chat_body(&request, false);

        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn build_google_parts_maps_image_inline_data() {
        let parts = vec![LlmContentPart::Image {
            mime_type: "image/jpeg".to_string(),
            data: "xyz".to_string(),
        }];

        let content = build_google_parts(&parts);

        assert_eq!(content[0]["inlineData"]["mimeType"], "image/jpeg");
    }

    #[test]
    fn parse_api_error_marks_rate_limits_retryable() {
        let error = parse_api_error(429, "too many requests", "OpenAI", None);

        assert!(error.retryable);
        assert_eq!(error.retry_after, Some(60_000));
    }

    #[test]
    fn parse_api_error_marks_quota_limits_not_retryable() {
        let error = parse_api_error(429, "quota exceeded", "OpenAI", None);

        assert!(!error.retryable);
    }

    #[test]
    fn mediaflow_api_error_message_extracts_code_and_message() {
        let body = r#"{"error":{"message":"No credits","code":"billing_required"}}"#;

        assert_eq!(
            mediaflow_api_error_message(body),
            "No credits (billing_required)"
        );
    }

    #[test]
    fn mediaflow_api_error_body_extracts_structured_fields() {
        let body = r#"{"error":{"message":"Rate limit exceeded.","code":"rate_limit_exceeded","request_id":"req_123"}}"#;

        let error = parse_mediaflow_api_error_body(body);

        assert_eq!(error.message, "Rate limit exceeded.");
        assert_eq!(error.code.as_deref(), Some("rate_limit_exceeded"));
        assert_eq!(error.request_id.as_deref(), Some("req_123"));
        assert_eq!(error.raw_body, body);
    }

    #[test]
    fn mediaflow_api_error_marks_rate_limits_retryable() {
        let api_error = parse_mediaflow_api_error_body(
            r#"{"error":{"message":"Rate limit exceeded.","code":"rate_limit_exceeded"}}"#,
        );

        let parsed = parse_mediaflow_api_error(429, &api_error, None);

        assert!(parsed.retryable);
        assert_eq!(parsed.retry_after, Some(60_000));
        assert_eq!(
            parsed.message,
            "MediaFlow: Rate limit exceeded. (rate_limit_exceeded)"
        );
    }

    #[test]
    fn mediaflow_api_error_marks_usage_limits_not_retryable() {
        let api_error = parse_mediaflow_api_error_body(
            r#"{"error":{"message":"Free daily usage limit exceeded.","code":"free_daily_limit_exceeded"}}"#,
        );

        let parsed = parse_mediaflow_api_error(429, &api_error, None);

        assert!(!parsed.retryable);
        assert_eq!(parsed.retry_after, None);
    }

    #[test]
    fn mediaflow_api_error_response_serializes_structured_fields() {
        let response = mediaflow_error_response(
            "MediaFlow: Rate limit exceeded. (rate_limit_exceeded)",
            true,
            Some(60_000),
            Some(429),
            Some("rate_limit_exceeded".to_string()),
            Some("Rate limit exceeded.".to_string()),
            Some("req_123".to_string()),
            Some(r#"{"error":{"code":"rate_limit_exceeded"}}"#.to_string()),
        );

        let serialized = serde_json::to_value(response).expect("serialize response");

        assert_eq!(serialized["errorCode"], "rate_limit_exceeded");
        assert_eq!(serialized["errorMessage"], "Rate limit exceeded.");
        assert_eq!(serialized["requestId"], "req_123");
        assert_eq!(
            serialized["technicalError"],
            r#"{"error":{"code":"rate_limit_exceeded"}}"#
        );
    }

    #[test]
    fn google_generate_content_url_contains_model_and_key() {
        assert_eq!(
            google_generate_content_url("gemini-pro", "test-key"),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=test-key"
        );
    }

    #[tokio::test]
    async fn call_provider_rejects_missing_model() {
        let mut request = request(LlmProvider::Openai);
        request.model.clear();

        let response = super::call_provider("req_missing_model", request).await;

        assert_eq!(response.error.as_deref(), Some("No model selected"));
    }

    #[test]
    fn mediaflow_chat_requests_include_request_id_and_auth() {
        let client = reqwest::Client::new();
        let chat = super::mediaflow_chat_request(&client, "req_123", "token")
            .body("{}")
            .build()
            .expect("request should build");
        let cancel = super::mediaflow_chat_cancel_request(&client, "req_123", "token")
            .build()
            .expect("request should build");

        assert_eq!(
            chat.url().as_str(),
            super::mediaflow_api::chat_completions_url()
        );
        assert_eq!(cancel.method(), reqwest::Method::POST);
        assert_eq!(
            cancel.url().as_str(),
            super::mediaflow_api::chat_completion_cancel_url("req_123")
        );

        for request in [&chat, &cancel] {
            assert_eq!(request.headers().get("X-Request-Id").unwrap(), "req_123");
            assert_eq!(
                request
                    .headers()
                    .get(reqwest::header::AUTHORIZATION)
                    .unwrap(),
                "Bearer token"
            );
        }
    }

    #[tokio::test]
    async fn run_abortable_llm_request_honors_cancel_before_request_registration() {
        let request_id = "pre_cancelled_llm_request".to_string();

        super::cancel_llm_request(request_id.clone()).expect("pre-cancel should be accepted");
        let response =
            super::run_abortable_llm_request(request_id, request(LlmProvider::Mediaflow))
                .await
                .expect("request should resolve");

        assert_eq!(response.cancelled, Some(true));
        assert_eq!(response.error.as_deref(), Some("Request cancelled"));
    }
}
