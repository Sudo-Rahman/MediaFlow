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
