use crate::shared::store::resolve_ffprobe_path;
use tokio::process::Command;

/// Get media duration in microseconds using ffprobe
/// This is used to calculate progress percentage during transcoding
pub(crate) async fn get_media_duration_us(
    app: &tauri::AppHandle,
    path: &str,
) -> Result<u64, String> {
    let ffprobe_path = resolve_ffprobe_path(app)?;
    let output = Command::new(&ffprobe_path)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let duration_str = String::from_utf8_lossy(&output.stdout);
    let duration_secs: f64 = duration_str
        .trim()
        .parse()
        .map_err(|_| format!("Invalid duration: {}", duration_str.trim()))?;

    Ok((duration_secs * 1_000_000.0) as u64)
}
