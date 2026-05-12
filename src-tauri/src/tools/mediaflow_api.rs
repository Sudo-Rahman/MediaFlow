use reqwest::header::ORIGIN;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri_plugin_opener::open_url;

const USER_AGENT: &str = "MediaFlow/1.0";
#[cfg(debug_assertions)]
const MEDIAFLOW_BASE_URL: &str = "https://mediaflowtools.com";
#[cfg(not(debug_assertions))]
const MEDIAFLOW_BASE_URL: &str = "https://mediaflowtools.com";
const CLIENT_ID: &str = "mediaflow-desktop";
const AUTH_SCOPE: &str = "openid profile email offline_access";
const WEB_OAUTH_CALLBACK_PATH: &str = "/desktop/oauth/callback";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct MediaFlowHttpResponse {
    status: u16,
    body: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct MediaFlowTokenResponse {
    access_token: String,
    token_type: Option<String>,
    expires_in: Option<u64>,
    #[serde(alias = "refreshToken")]
    refresh_token: Option<String>,
    scope: Option<String>,
    id_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct MediaFlowUser {
    email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

pub(crate) fn public_base_url() -> &'static str {
    MEDIAFLOW_BASE_URL
}

fn mediaflow_url(path: &str) -> String {
    format!("{}/{}", MEDIAFLOW_BASE_URL, path.trim_start_matches('/'))
}

pub(crate) fn chat_completions_url() -> String {
    mediaflow_url("/api/v1/chat/completions")
}

pub(crate) fn chat_completion_cancel_url(request_id: &str) -> String {
    let path = format!("/api/v1/chat/completions/cancel?request_id={request_id}");
    mediaflow_url(&path)
}

pub(crate) fn audio_transcriptions_url() -> String {
    mediaflow_url("/api/v1/audio/transcriptions")
}

fn account_usage_url() -> String {
    mediaflow_url("/api/v1/account/usage")
}

fn auth_url(path: &str) -> String {
    mediaflow_url(&format!("/api/auth{path}"))
}

fn web_redirect_uri() -> String {
    mediaflow_url(WEB_OAUTH_CALLBACK_PATH)
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to create MediaFlow HTTP client: {e}"))
}

fn auth_form_post(path: &str) -> Result<reqwest::RequestBuilder, String> {
    Ok(http_client()?
        .post(auth_url(path))
        .header(ORIGIN, MEDIAFLOW_BASE_URL))
}

fn parse_url(url: &str) -> Result<reqwest::Url, String> {
    reqwest::Url::parse(url).map_err(|e| format!("Invalid MediaFlow URL: {e}"))
}

fn authorize_redirect_to(code_challenge: &str, state: &str) -> Result<String, String> {
    let mut authorize_url = parse_url(&auth_url("/oauth2/authorize"))?;
    authorize_url
        .query_pairs_mut()
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", &web_redirect_uri())
        .append_pair("response_type", "code")
        .append_pair("scope", AUTH_SCOPE)
        .append_pair("code_challenge", code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state);

    Ok(format!(
        "{}?{}",
        authorize_url.path(),
        authorize_url.query().unwrap_or_default()
    ))
}

fn login_url(code_challenge: &str, state: &str) -> Result<String, String> {
    let redirect_to = authorize_redirect_to(code_challenge, state)?;
    let mut login_url = parse_url(&mediaflow_url("/auth/login"))?;
    login_url
        .query_pairs_mut()
        .append_pair("redirectTo", &redirect_to);
    Ok(login_url.to_string())
}

async fn response_text(response: reqwest::Response) -> Result<MediaFlowHttpResponse, String> {
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read MediaFlow response: {e}"))?;
    Ok(MediaFlowHttpResponse { status, body })
}

async fn token_request(
    form: Vec<(&'static str, String)>,
) -> Result<MediaFlowTokenResponse, String> {
    let response = auth_form_post("/oauth2/token")?
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("MediaFlow OAuth token request failed: {e}"))?;
    let transfer = response_text(response).await?;

    if !(200..300).contains(&transfer.status) {
        return Err(format!(
            "MediaFlow OAuth token request failed ({}): {}",
            transfer.status, transfer.body
        ));
    }

    serde_json::from_str::<MediaFlowTokenResponse>(&transfer.body)
        .map_err(|e| format!("Failed to parse MediaFlow token response: {e}"))
}

#[tauri::command]
pub(crate) fn open_mediaflow_sign_in(code_challenge: String, state: String) -> Result<(), String> {
    open_url(login_url(&code_challenge, &state)?, None::<&str>)
        .map_err(|e| format!("Failed to open MediaFlow sign-in URL: {e}"))
}

#[tauri::command]
pub(crate) fn open_mediaflow_dashboard() -> Result<(), String> {
    open_url(mediaflow_url("/dashboard"), None::<&str>)
        .map_err(|e| format!("Failed to open MediaFlow dashboard: {e}"))
}

#[tauri::command]
pub(crate) async fn exchange_mediaflow_authorization_code(
    code: String,
    code_verifier: String,
) -> Result<MediaFlowTokenResponse, String> {
    token_request(vec![
        ("grant_type", "authorization_code".to_string()),
        ("client_id", CLIENT_ID.to_string()),
        ("redirect_uri", web_redirect_uri()),
        ("code", code),
        ("code_verifier", code_verifier),
    ])
    .await
}

#[tauri::command]
pub(crate) async fn refresh_mediaflow_access_token(
    refresh_token: String,
) -> Result<MediaFlowTokenResponse, String> {
    token_request(vec![
        ("grant_type", "refresh_token".to_string()),
        ("client_id", CLIENT_ID.to_string()),
        ("refresh_token", refresh_token),
    ])
    .await
}

#[tauri::command]
pub(crate) async fn fetch_mediaflow_user_info(
    access_token: String,
) -> Result<MediaFlowUser, String> {
    let response = http_client()?
        .get(auth_url("/oauth2/userinfo"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch MediaFlow account information: {e}"))?;
    let transfer = response_text(response).await?;

    if !(200..300).contains(&transfer.status) {
        return Err("Failed to fetch MediaFlow account information.".to_string());
    }

    let body = serde_json::from_str::<Value>(&transfer.body)
        .map_err(|e| format!("Failed to parse MediaFlow account response: {e}"))?;
    let email = body
        .get("email")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if email.is_empty() {
        return Err("MediaFlow account response did not include an email.".to_string());
    }

    let name = body.get("name").and_then(Value::as_str).map(str::to_string);
    Ok(MediaFlowUser { email, name })
}

#[tauri::command]
pub(crate) async fn revoke_mediaflow_refresh_token(refresh_token: String) -> Result<(), String> {
    auth_form_post("/oauth2/revoke")?
        .form(&[
            ("client_id", CLIENT_ID),
            ("token", refresh_token.as_str()),
            ("token_type_hint", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("MediaFlow token revocation failed: {e}"))?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn fetch_mediaflow_account_usage(
    access_token: String,
) -> Result<MediaFlowHttpResponse, String> {
    let response = http_client()?
        .get(account_usage_url())
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("MediaFlow usage request failed: {e}"))?;

    response_text(response).await
}

#[cfg(test)]
mod tests {
    use super::{
        MEDIAFLOW_BASE_URL, audio_transcriptions_url, auth_form_post, authorize_redirect_to,
        chat_completions_url, login_url, public_base_url,
    };

    #[test]
    fn mediaflow_base_url_uses_debug_url_for_debug_builds() {
        assert_eq!(MEDIAFLOW_BASE_URL, "http://localhost:5173");
    }

    #[test]
    fn public_base_url_uses_selected_mediaflow_base_url() {
        assert_eq!(public_base_url(), MEDIAFLOW_BASE_URL);
    }

    #[test]
    fn chat_completions_url_uses_selected_base_url() {
        assert_eq!(
            chat_completions_url(),
            format!("{MEDIAFLOW_BASE_URL}/api/v1/chat/completions")
        );
    }

    #[test]
    fn audio_transcriptions_url_uses_selected_base_url() {
        assert_eq!(
            audio_transcriptions_url(),
            format!("{MEDIAFLOW_BASE_URL}/api/v1/audio/transcriptions")
        );
    }

    #[test]
    fn authorize_redirect_to_contains_oauth_parameters() {
        let redirect_to =
            authorize_redirect_to("challenge", "state").expect("redirect URL should build");

        assert!(redirect_to.starts_with("/api/auth/oauth2/authorize?"));
        assert!(redirect_to.contains("client_id=mediaflow-desktop"));
        assert!(redirect_to.contains("code_challenge=challenge"));
        assert!(redirect_to.contains("state=state"));
    }

    #[test]
    fn login_url_wraps_authorize_redirect() {
        let url = login_url("challenge", "state").expect("login URL should build");
        let parsed = reqwest::Url::parse(&url).expect("login URL should parse");

        assert_eq!(parsed.path(), "/auth/login");
        assert!(parsed.query().unwrap_or_default().contains("redirectTo="));
    }

    #[test]
    fn auth_form_post_sets_same_origin_header() {
        let request = auth_form_post("/oauth2/token")
            .expect("request builder should be created")
            .form(&[("grant_type", "authorization_code")])
            .build()
            .expect("request should build");

        assert_eq!(
            request.headers().get(reqwest::header::ORIGIN).unwrap(),
            MEDIAFLOW_BASE_URL
        );
    }
}
