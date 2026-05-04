const KEYCHAIN_SERVICE: &str = "com.sudo-rahman.mediaflow.oauth";
const REFRESH_TOKEN_ACCOUNT: &str = "mediaflow-refresh-token";

fn validate_refresh_token(refresh_token: &str) -> Result<(), String> {
    if refresh_token.trim().is_empty() {
        return Err("Refresh token cannot be empty".to_string());
    }

    Ok(())
}

fn refresh_token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, REFRESH_TOKEN_ACCOUNT)
        .map_err(|error| format!("Failed to open keychain entry: {error}"))
}

#[tauri::command]
pub fn store_refresh_token(refresh_token: String) -> Result<(), String> {
    validate_refresh_token(&refresh_token)?;

    refresh_token_entry()?
        .set_password(&refresh_token)
        .map_err(|error| format!("Failed to store refresh token: {error}"))
}

#[tauri::command]
pub fn get_refresh_token() -> Result<Option<String>, String> {
    match refresh_token_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read refresh token: {error}")),
    }
}

#[tauri::command]
pub fn delete_refresh_token() -> Result<(), String> {
    match refresh_token_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to delete refresh token: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_refresh_token;

    #[test]
    fn rejects_empty_refresh_tokens_before_keychain_access() {
        assert!(validate_refresh_token("").is_err());
        assert!(validate_refresh_token("   ").is_err());
    }

    #[test]
    fn accepts_non_empty_refresh_tokens() {
        assert!(validate_refresh_token("refresh-token").is_ok());
    }
}
