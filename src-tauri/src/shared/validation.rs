use std::path::Path;

/// Allowed media file extensions
pub(crate) const ALLOWED_MEDIA_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "avi", "mov", "webm", "m4v", "mks", "mka", "m4a", "mp3", "flac", "wav", "ogg",
    "aac", "ac3", "dts", "srt", "ass", "ssa", "vtt", "sub", "sup", "opus", "wma",
];

/// Validate that a path exists and is a file with an allowed extension
pub(crate) fn validate_media_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);

    // Check if path exists
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }

    // Check if it's a file (not a directory)
    if !path.is_file() {
        return Err(format!("Not a file: {}", path.display()));
    }

    // Check extension
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if !ALLOWED_MEDIA_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("Unsupported file type: .{}", ext));
    }

    Ok(())
}

/// Validate that a path is safe (no path traversal) and parent directory exists
pub(crate) fn validate_output_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);

    // Check for path traversal attempts
    let path_str = path.to_string_lossy();
    if path_str.contains("..") {
        return Err("Path traversal not allowed".to_string());
    }

    // Check that parent directory exists
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!(
                "Output directory does not exist: {}",
                parent.display()
            ));
        }
    }

    Ok(())
}

/// Validate that a directory path exists
pub(crate) fn validate_directory_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);

    if !path.exists() {
        return Err(format!("Directory not found: {}", path.display()));
    }

    if !path.is_dir() {
        return Err(format!("Not a directory: {}", path.display()));
    }

    Ok(())
}
