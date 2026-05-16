use std::process::Stdio;

use crate::shared::process::wait_with_output_timeout;
use crate::shared::store::resolve_ffprobe_path;
use crate::shared::validation::validate_media_path;
use crate::tools::ffprobe::FFPROBE_TIMEOUT;
use tokio::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct VideoDimensions {
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// Probe a video file using ffprobe and return JSON output
/// Uses async tokio::process::Command with timeout
#[tauri::command]
pub(crate) async fn probe_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    // Validate input path
    validate_media_path(&path)?;
    let ffprobe_path = resolve_ffprobe_path(&app)?;
    probe_file_with_ffprobe(&ffprobe_path, &path).await
}

pub(crate) async fn probe_file_with_ffprobe(
    ffprobe_path: &str,
    path: &str,
) -> Result<String, String> {
    let child = Command::new(ffprobe_path)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to execute ffprobe: {}. Make sure FFmpeg is installed.",
                e
            )
        })?;

    let output = wait_with_output_timeout(child, "FFprobe", FFPROBE_TIMEOUT).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8 output: {}", e))
}

pub(crate) fn parse_primary_video_dimensions(probe_json: &str) -> Result<VideoDimensions, String> {
    let value: serde_json::Value = serde_json::from_str(probe_json)
        .map_err(|e| format!("Failed to parse ffprobe stream metadata: {}", e))?;
    let streams = value
        .get("streams")
        .and_then(|streams| streams.as_array())
        .ok_or_else(|| "FFprobe output did not contain streams".to_string())?;

    let video_stream = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(|value| value.as_str()) == Some("video"))
        .ok_or_else(|| "FFprobe output did not contain valid video dimensions".to_string())?;
    let width = video_stream
        .get("width")
        .and_then(|value| value.as_u64())
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| "FFprobe output did not contain valid video dimensions".to_string())?;
    let height = video_stream
        .get("height")
        .and_then(|value| value.as_u64())
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| "FFprobe output did not contain valid video dimensions".to_string())?;

    Ok(VideoDimensions { width, height })
}

pub(crate) async fn get_primary_video_dimensions_with_ffprobe(
    ffprobe_path: &str,
    path: &str,
) -> Result<VideoDimensions, String> {
    let json = probe_file_with_ffprobe(ffprobe_path, path).await?;
    parse_primary_video_dimensions(&json)
}

#[cfg(test)]
mod tests {
    use super::{parse_primary_video_dimensions, probe_file_with_ffprobe};

    #[tokio::test]
    async fn probe_file_returns_streams_json_for_sample_video() {
        let video = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");

        let json = probe_file_with_ffprobe(
            crate::test_support::ffmpeg::ffprobe_path(),
            video.to_string_lossy().as_ref(),
        )
        .await
        .expect("probe should succeed");
        let value: serde_json::Value = serde_json::from_str(&json).expect("valid json expected");
        assert!(value.get("streams").is_some());
    }

    #[test]
    fn parse_primary_video_dimensions_uses_first_video_stream() {
        let json = r#"{
            "streams": [
                { "codec_type": "audio", "width": 2, "height": 2 },
                { "codec_type": "video", "width": 1440, "height": 1080 },
                { "codec_type": "video", "width": 1920, "height": 1080 }
            ]
        }"#;

        let dimensions = parse_primary_video_dimensions(json)
            .expect("first video stream dimensions should parse");

        assert_eq!(dimensions.width, 1440);
        assert_eq!(dimensions.height, 1080);
    }

    #[test]
    fn parse_primary_video_dimensions_rejects_missing_video_stream() {
        let json = r#"{ "streams": [{ "codec_type": "audio" }] }"#;

        let error = parse_primary_video_dimensions(json)
            .expect_err("missing video stream should be rejected");

        assert!(error.contains("valid video dimensions"));
    }

    #[test]
    fn parse_primary_video_dimensions_rejects_invalid_dimensions() {
        let json = r#"{ "streams": [{ "codec_type": "video", "width": 0, "height": 1080 }] }"#;

        let error =
            parse_primary_video_dimensions(json).expect_err("zero width should be rejected");

        assert!(error.contains("valid video dimensions"));
    }
}
