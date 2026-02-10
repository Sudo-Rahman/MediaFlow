use serde::{Deserialize, Serialize};

/// File metadata structure
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct FileMetadata {
    size: u64,
    created_at: Option<u64>,  // Unix timestamp in milliseconds
    modified_at: Option<u64>, // Unix timestamp in milliseconds
}

/// Get file metadata (size, created, modified dates)
#[tauri::command]
pub(crate) async fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let metadata =
        std::fs::metadata(&path).map_err(|e| format!("Failed to get file metadata: {}", e))?;

    let size = metadata.len();

    let created_at = metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);

    Ok(FileMetadata {
        size,
        created_at,
        modified_at,
    })
}
