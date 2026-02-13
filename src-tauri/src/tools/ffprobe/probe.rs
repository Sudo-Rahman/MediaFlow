use crate::shared::store::resolve_ffprobe_path;
use crate::shared::validation::validate_media_path;
use crate::tools::ffprobe::FFPROBE_TIMEOUT;
use tokio::process::Command;
use tokio::time::timeout;

/// Probe a video file using ffprobe and return JSON output
/// Uses async tokio::process::Command with timeout
#[tauri::command]
pub(crate) async fn probe_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    // Validate input path
    validate_media_path(&path)?;
    let ffprobe_path = resolve_ffprobe_path(&app)?;
    probe_file_with_ffprobe(&ffprobe_path, &path).await
}

pub(crate) async fn probe_file_with_ffprobe(ffprobe_path: &str, path: &str) -> Result<String, String> {
    let probe_future = async move {
        Command::new(ffprobe_path)
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                "-show_format",
                path,
            ])
            .output()
            .await
    };

    // Execute with timeout
    let output = timeout(FFPROBE_TIMEOUT, probe_future)
        .await
        .map_err(|_| {
            format!(
                "FFprobe timeout after {} seconds",
                FFPROBE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| {
            format!(
                "Failed to execute ffprobe: {}. Make sure FFmpeg is installed.",
                e
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8 output: {}", e))
}

#[cfg(test)]
mod tests {
    use super::probe_file_with_ffprobe;

    #[tokio::test]
    async fn probe_file_returns_streams_json_for_sample_video() {
        let video = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");

        let json = probe_file_with_ffprobe("ffprobe", video.to_string_lossy().as_ref())
            .await
            .expect("probe should succeed");
        let value: serde_json::Value = serde_json::from_str(&json).expect("valid json expected");
        assert!(value.get("streams").is_some());
    }
}
