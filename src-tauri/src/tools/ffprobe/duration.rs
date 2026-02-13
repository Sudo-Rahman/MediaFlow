use crate::shared::store::resolve_ffprobe_path;
use tokio::process::Command;

/// Get media duration in microseconds using ffprobe
/// This is used to calculate progress percentage during transcoding
pub(crate) async fn get_media_duration_us(
    app: &tauri::AppHandle,
    path: &str,
) -> Result<u64, String> {
    let ffprobe_path = resolve_ffprobe_path(app)?;
    get_media_duration_us_with_ffprobe(&ffprobe_path, path).await
}

pub(crate) async fn get_media_duration_us_with_ffprobe(
    ffprobe_path: &str,
    path: &str,
) -> Result<u64, String> {
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

#[cfg(test)]
mod tests {
    use super::get_media_duration_us_with_ffprobe;

    #[tokio::test]
    async fn get_media_duration_us_returns_non_zero_for_sample_video() {
        let video = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");

        let duration = get_media_duration_us_with_ffprobe("ffprobe", video.to_string_lossy().as_ref())
        .await
        .expect("duration probe should succeed");

        assert!(duration > 0);
    }
}
