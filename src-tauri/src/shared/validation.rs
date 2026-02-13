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

#[cfg(test)]
mod tests {
    use super::{validate_directory_path, validate_media_path, validate_output_path};

    #[test]
    fn validate_media_path_rejects_missing_file() {
        let error =
            validate_media_path("/tmp/definitely-missing.mp4").expect_err("missing file expected");
        assert!(error.contains("File not found"));
    }

    #[test]
    fn validate_media_path_rejects_directory() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let error = validate_media_path(dir.path().to_string_lossy().as_ref())
            .expect_err("directory should be rejected");
        assert!(error.contains("Not a file"));
    }

    #[test]
    fn validate_media_path_accepts_allowed_extension() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let file = dir.path().join("input.MP4");
        std::fs::write(&file, b"data").expect("failed to create media file");

        validate_media_path(file.to_string_lossy().as_ref()).expect("valid media path expected");
    }

    #[test]
    fn validate_media_path_rejects_unsupported_extension() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let file = dir.path().join("input.xyz");
        std::fs::write(&file, b"data").expect("failed to create media file");

        let error = validate_media_path(file.to_string_lossy().as_ref())
            .expect_err("unsupported extension should fail");
        assert!(error.contains("Unsupported file type"));
    }

    #[test]
    fn validate_output_path_rejects_path_traversal() {
        let error = validate_output_path("../escape.mp4").expect_err("path traversal should fail");
        assert!(error.contains("Path traversal not allowed"));
    }

    #[test]
    fn validate_output_path_rejects_missing_parent() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("missing").join("out.mp4");
        let error = validate_output_path(output.to_string_lossy().as_ref())
            .expect_err("missing parent should fail");
        assert!(error.contains("Output directory does not exist"));
    }

    #[test]
    fn validate_output_path_accepts_existing_parent() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("out.mp4");
        validate_output_path(output.to_string_lossy().as_ref()).expect("output path should be valid");
    }

    #[test]
    fn validate_directory_path_checks_directory_existence() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        validate_directory_path(dir.path().to_string_lossy().as_ref()).expect("directory should pass");

        let missing = dir.path().join("missing");
        let error = validate_directory_path(missing.to_string_lossy().as_ref())
            .expect_err("missing directory should fail");
        assert!(error.contains("Directory not found"));
    }
}
