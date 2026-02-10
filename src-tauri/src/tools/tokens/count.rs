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
