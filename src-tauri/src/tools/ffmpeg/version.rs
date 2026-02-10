use crate::shared::store::{resolve_ffmpeg_path, resolve_ffprobe_path};
use tokio::process::Command;

/// Check if ffmpeg and ffprobe are available
#[tauri::command]
pub(crate) async fn check_ffmpeg(app: tauri::AppHandle) -> Result<bool, String> {
    let ffprobe_path = resolve_ffprobe_path(&app)?;
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;

    let ffprobe_check = Command::new(&ffprobe_path).arg("-version").output().await;
    let ffmpeg_check = Command::new(&ffmpeg_path).arg("-version").output().await;

    match (ffprobe_check, ffmpeg_check) {
        (Ok(probe), Ok(mpeg)) if probe.status.success() && mpeg.status.success() => Ok(true),
        _ => Ok(false),
    }
}

/// Get FFmpeg version string
#[tauri::command]
pub(crate) async fn get_ffmpeg_version(app: tauri::AppHandle) -> Result<String, String> {
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let output = Command::new(&ffmpeg_path)
        .arg("-version")
        .output()
        .await
        .map_err(|e| format!("Failed to get FFmpeg version: {}", e))?;

    if output.status.success() {
        let version_str = String::from_utf8_lossy(&output.stdout);
        // Extract first line which contains version
        if let Some(first_line) = version_str.lines().next() {
            // Try to extract just the version number
            if let Some(version) = first_line.split_whitespace().nth(2) {
                return Ok(version.to_string());
            }
        }
        Ok("Unknown".to_string())
    } else {
        Err("FFmpeg not found".to_string())
    }
}
