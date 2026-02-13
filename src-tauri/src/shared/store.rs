use std::path::Path;
use tauri_plugin_store::StoreExt;

/// Settings store filename
pub(crate) const SETTINGS_STORE_FILE: &str = "settings.json";

/// Store keys for custom FFmpeg/FFprobe paths
pub(crate) const FFMPEG_PATH_KEY: &str = "ffmpegPath";
pub(crate) const FFPROBE_PATH_KEY: &str = "ffprobePath";

fn read_store_path(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    let store = app
        .store(SETTINGS_STORE_FILE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    Ok(store
        .get(key)
        .and_then(|value| value.as_str().map(|s| s.to_string())))
}

fn resolve_binary_path(
    app: &tauri::AppHandle,
    key: &str,
    fallback_cmd: &str,
    label: &str,
) -> Result<String, String> {
    let custom = read_store_path(app, key)?.unwrap_or_default();
    resolve_binary_path_from_custom(&custom, fallback_cmd, label)
}

fn resolve_binary_path_from_custom(
    custom: &str,
    fallback_cmd: &str,
    label: &str,
) -> Result<String, String> {
    let trimmed = custom.trim();
    if trimmed.is_empty() {
        return Ok(fallback_cmd.to_string());
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return Err(format!(
            "Custom {} path does not exist: {}",
            label,
            path.display()
        ));
    }
    if !path.is_file() {
        return Err(format!(
            "Custom {} path is not a file: {}",
            label,
            path.display()
        ));
    }

    Ok(path.to_string_lossy().to_string())
}

pub(crate) fn resolve_ffmpeg_path(app: &tauri::AppHandle) -> Result<String, String> {
    resolve_binary_path(app, FFMPEG_PATH_KEY, "ffmpeg", "FFmpeg")
}

pub(crate) fn resolve_ffprobe_path(app: &tauri::AppHandle) -> Result<String, String> {
    resolve_binary_path(app, FFPROBE_PATH_KEY, "ffprobe", "FFprobe")
}

#[cfg(test)]
mod tests {
    use super::resolve_binary_path_from_custom;

    #[test]
    fn resolve_binary_path_from_custom_returns_fallback_for_empty_custom_path() {
        let resolved =
            resolve_binary_path_from_custom("   ", "ffmpeg", "FFmpeg").expect("fallback expected");
        assert_eq!(resolved, "ffmpeg");
    }

    #[test]
    fn resolve_binary_path_from_custom_rejects_nonexistent_path() {
        let error =
            resolve_binary_path_from_custom("/tmp/definitely-not-a-real-binary", "ffmpeg", "FFmpeg")
                .expect_err("path should not exist");
        assert!(error.contains("does not exist"));
    }

    #[test]
    fn resolve_binary_path_from_custom_rejects_directory_path() {
        let dir = tempfile::tempdir().expect("failed to create temp dir");
        let error = resolve_binary_path_from_custom(
            dir.path().to_string_lossy().as_ref(),
            "ffmpeg",
            "FFmpeg",
        )
        .expect_err("directory path must be rejected");
        assert!(error.contains("is not a file"));
    }

    #[test]
    fn resolve_binary_path_from_custom_accepts_existing_file() {
        let dir = tempfile::tempdir().expect("failed to create temp dir");
        let file = dir.path().join("ffmpeg-custom");
        std::fs::write(&file, b"").expect("failed to create file");

        let resolved = resolve_binary_path_from_custom(
            file.to_string_lossy().as_ref(),
            "ffmpeg",
            "FFmpeg",
        )
        .expect("existing file should be accepted");
        assert_eq!(resolved, file.to_string_lossy().to_string());
    }
}
