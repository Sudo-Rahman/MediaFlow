use tiktoken_rs::o200k_base_singleton;

/// Count tokens in a text using tiktoken o200k_base encoding (GPT-4o, GPT-5)
/// Runs async to avoid blocking the main thread
#[tauri::command]
pub(crate) async fn count_tokens(text: String) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || {
        let bpe = o200k_base_singleton();
        bpe.encode_with_special_tokens(&text).len()
    })
    .await
    .map_err(|e| format!("Token counting failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::count_tokens;

    #[tokio::test]
    async fn count_tokens_returns_positive_count_for_non_empty_text() {
        let count = count_tokens("Hello world".to_string())
            .await
            .expect("token count should succeed");
        assert!(count > 0);
    }
}
