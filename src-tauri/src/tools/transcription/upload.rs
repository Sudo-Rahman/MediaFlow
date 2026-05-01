use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use futures_util::future::{AbortHandle, Abortable};
use serde::{Deserialize, Serialize};

use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::validation::validate_media_path;
use crate::tools::mediaflow_api;

static TRANSCRIPTION_UPLOAD_ABORTS: LazyLock<Mutex<HashMap<String, AbortHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const DEEPGRAM_LISTEN_URL: &str = "https://api.deepgram.com/v1/listen";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscriptionUploadConfig {
    model: String,
    language: String,
    punctuate: bool,
    paragraphs: bool,
    smart_format: bool,
    utterances: bool,
    utt_split: f64,
    diarize: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct TranscriptionHttpResponse {
    pub(crate) status: u16,
    pub(crate) body: String,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("MediaFlow/1.0")
        .build()
        .map_err(|e| format!("Failed to create transcription HTTP client: {}", e))
}

fn deepgram_model_for_language(config: &TranscriptionUploadConfig) -> String {
    let is_non_english = config.language != "en" && config.language != "multi";
    if is_non_english && !config.model.contains("general") {
        format!("{}-general", config.model)
    } else {
        config.model.clone()
    }
}

fn deepgram_language_param(language: &str) -> &str {
    if language == "auto" {
        "multi"
    } else {
        language
    }
}

fn deepgram_query_params(config: &TranscriptionUploadConfig) -> Vec<(&'static str, String)> {
    vec![
        ("model", deepgram_model_for_language(config)),
        ("punctuate", config.punctuate.to_string()),
        ("paragraphs", config.paragraphs.to_string()),
        ("smart_format", config.smart_format.to_string()),
        ("utterances", config.utterances.to_string()),
        ("utt_split", config.utt_split.to_string()),
        ("diarize", config.diarize.to_string()),
        (
            "language",
            deepgram_language_param(&config.language).to_string(),
        ),
    ]
}

fn deepgram_request_url(config: &TranscriptionUploadConfig) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(DEEPGRAM_LISTEN_URL)
        .map_err(|e| format!("Invalid Deepgram transcription URL: {}", e))?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in deepgram_query_params(config) {
            query.append_pair(key, &value);
        }
    }
    Ok(url)
}

fn mediaflow_form_params(config: &TranscriptionUploadConfig) -> Vec<(&'static str, String)> {
    vec![
        ("model", config.model.clone()),
        ("punctuate", config.punctuate.to_string()),
        ("paragraphs", config.paragraphs.to_string()),
        ("smart_format", config.smart_format.to_string()),
        ("utterances", config.utterances.to_string()),
        ("utt_split", config.utt_split.to_string()),
        ("diarize", config.diarize.to_string()),
        (
            "language",
            deepgram_language_param(&config.language).to_string(),
        ),
    ]
}

async fn open_audio_file(audio_path: &str) -> Result<(tokio::fs::File, u64), String> {
    validate_media_path(audio_path)?;
    let file = tokio::fs::File::open(audio_path)
        .await
        .map_err(|e| format!("Failed to open audio file: {}", e))?;
    let length = file
        .metadata()
        .await
        .map_err(|e| format!("Failed to read audio file metadata: {}", e))?
        .len();
    Ok((file, length))
}

async fn response_to_transfer(
    response: reqwest::Response,
) -> Result<TranscriptionHttpResponse, String> {
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read transcription response: {}", e))?;
    Ok(TranscriptionHttpResponse { status, body })
}

async fn run_abortable_upload<F>(
    request_id: String,
    upload: F,
) -> Result<TranscriptionHttpResponse, String>
where
    F: std::future::Future<Output = Result<TranscriptionHttpResponse, String>>,
{
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    {
        let mut guard = TRANSCRIPTION_UPLOAD_ABORTS
            .lock()
            .map_err(|_| "Failed to acquire transcription upload lock".to_string())?;
        guard.insert(request_id.clone(), abort_handle);
    }

    let result = Abortable::new(upload, abort_registration).await;
    if let Ok(mut guard) = TRANSCRIPTION_UPLOAD_ABORTS.lock() {
        guard.remove(&request_id);
    }

    match result {
        Ok(response) => response,
        Err(_) => Err("Transcription cancelled".to_string()),
    }
}

#[tauri::command]
pub(crate) async fn transcribe_deepgram_audio_file(
    request_id: String,
    audio_path: String,
    config: TranscriptionUploadConfig,
    api_key: String,
) -> Result<TranscriptionHttpResponse, String> {
    run_abortable_upload(request_id, async move {
        let _sleep_guard = SleepInhibitGuard::try_acquire("MediaFlow: Transcription").ok();
        let client = http_client()?;
        let url = deepgram_request_url(&config)?;
        let (file, length) = open_audio_file(&audio_path).await?;

        let response = client
            .post(url)
            .header("Authorization", format!("Token {}", api_key))
            .header("Content-Type", "audio/opus")
            .header("Content-Length", length)
            .body(reqwest::Body::from(file))
            .send()
            .await
            .map_err(|e| format!("Deepgram transcription request failed: {}", e))?;

        response_to_transfer(response).await
    })
    .await
}

#[tauri::command]
pub(crate) async fn transcribe_mediaflow_audio_file(
    request_id: String,
    audio_path: String,
    config: TranscriptionUploadConfig,
    access_token: String,
) -> Result<TranscriptionHttpResponse, String> {
    run_abortable_upload(request_id, async move {
        let _sleep_guard = SleepInhibitGuard::try_acquire("MediaFlow: Transcription").ok();
        let client = http_client()?;
        let url = reqwest::Url::parse(&mediaflow_api::audio_transcriptions_url())
            .map_err(|e| format!("Invalid MediaFlow transcription URL: {}", e))?;
        let (file, length) = open_audio_file(&audio_path).await?;

        let file_part = reqwest::multipart::Part::stream_with_length(file, length)
            .file_name("audio.opus")
            .mime_str("audio/opus")
            .map_err(|e| format!("Failed to build audio upload part: {}", e))?;
        let mut form = reqwest::multipart::Form::new().part("file", file_part);
        for (key, value) in mediaflow_form_params(&config) {
            form = form.text(key, value);
        }

        let response = client
            .post(url)
            .bearer_auth(access_token)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("MediaFlow transcription request failed: {}", e))?;

        response_to_transfer(response).await
    })
    .await
}

#[tauri::command]
pub(crate) fn cancel_audio_transcription_upload(request_id: String) -> Result<(), String> {
    let abort_handle = {
        let mut guard = TRANSCRIPTION_UPLOAD_ABORTS
            .lock()
            .map_err(|_| "Failed to acquire transcription upload lock".to_string())?;
        guard.remove(&request_id)
    };

    if let Some(handle) = abort_handle {
        handle.abort();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        DEEPGRAM_LISTEN_URL, TranscriptionUploadConfig, deepgram_model_for_language,
        deepgram_query_params, deepgram_request_url, mediaflow_form_params,
    };

    fn config() -> TranscriptionUploadConfig {
        TranscriptionUploadConfig {
            model: "nova-3".to_string(),
            language: "fr".to_string(),
            punctuate: true,
            paragraphs: true,
            smart_format: true,
            utterances: true,
            utt_split: 0.5,
            diarize: false,
        }
    }

    #[test]
    fn deepgram_model_adds_general_for_non_english_languages() {
        assert_eq!(deepgram_model_for_language(&config()), "nova-3-general");
    }

    #[test]
    fn deepgram_model_keeps_existing_general_model() {
        let mut config = config();
        config.model = "nova-3-general".to_string();

        assert_eq!(deepgram_model_for_language(&config), "nova-3-general");
    }

    #[test]
    fn deepgram_model_keeps_english_model() {
        let mut config = config();
        config.language = "en".to_string();

        assert_eq!(deepgram_model_for_language(&config), "nova-3");
    }

    #[test]
    fn deepgram_request_url_maps_config_to_query_params() {
        let url = deepgram_request_url(&config()).expect("valid URL expected");
        let query = url.query().expect("query should be present");

        assert_eq!(url.as_str().split('?').next(), Some(DEEPGRAM_LISTEN_URL));
        assert!(query.contains("model=nova-3-general"));
        assert!(query.contains("language=fr"));
        assert!(query.contains("smart_format=true"));
        assert!(query.contains("utt_split=0.5"));
    }

    #[test]
    fn deepgram_query_params_maps_auto_language_to_multi() {
        let mut config = config();
        config.language = "auto".to_string();

        assert!(
            deepgram_query_params(&config)
                .iter()
                .any(|(key, value)| *key == "language" && value == "multi")
        );
    }

    #[test]
    fn mediaflow_form_params_use_original_model_and_multi_language_alias() {
        let mut config = config();
        config.language = "auto".to_string();

        let params = mediaflow_form_params(&config);
        assert!(
            params
                .iter()
                .any(|(key, value)| *key == "model" && value == "nova-3")
        );
        assert!(
            params
                .iter()
                .any(|(key, value)| *key == "language" && value == "multi")
        );
    }
}
