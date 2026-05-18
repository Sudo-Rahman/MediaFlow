use std::process::Stdio;

use crate::shared::process::tokio_command;
use crate::shared::process::wait_with_output_timeout;
use crate::shared::store::resolve_ffprobe_path;
use crate::shared::validation::validate_media_path;
use crate::tools::ffprobe::FFPROBE_TIMEOUT;
use serde_json::Value;

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
    let child = tokio_command(ffprobe_path)
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
    let value: Value = serde_json::from_str(probe_json)
        .map_err(|e| format!("Failed to parse ffprobe stream metadata: {}", e))?;
    let streams = value
        .get("streams")
        .and_then(|streams| streams.as_array())
        .ok_or_else(|| "FFprobe output did not contain streams".to_string())?;

    let video_stream = streams
        .iter()
        .find(|stream| {
            stream.get("codec_type").and_then(|value| value.as_str()) == Some("video")
                && !stream_is_attached_picture(stream)
        })
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

    if stream_rotation_swaps_dimensions(video_stream) {
        Ok(VideoDimensions {
            width: height,
            height: width,
        })
    } else {
        Ok(VideoDimensions { width, height })
    }
}

fn stream_is_attached_picture(stream: &Value) -> bool {
    stream
        .get("disposition")
        .and_then(|disposition| disposition.get("attached_pic"))
        .is_some_and(ffprobe_flag_is_enabled)
}

fn ffprobe_flag_is_enabled(value: &Value) -> bool {
    value.as_bool().unwrap_or_else(|| {
        value
            .as_i64()
            .map(|flag| flag != 0)
            .or_else(|| {
                value
                    .as_str()
                    .map(|flag| flag == "1" || flag.eq_ignore_ascii_case("true"))
            })
            .unwrap_or(false)
    })
}

fn stream_rotation_swaps_dimensions(stream: &Value) -> bool {
    stream_rotation_degrees(stream).is_some_and(is_right_angle_rotation)
}

fn stream_rotation_degrees(stream: &Value) -> Option<f64> {
    stream
        .get("side_data_list")
        .and_then(|value| value.as_array())
        .and_then(|side_data_list| {
            side_data_list.iter().find_map(|side_data| {
                side_data
                    .get("rotation")
                    .and_then(rotation_degrees_from_value)
                    .or_else(|| {
                        side_data
                            .get("tags")
                            .and_then(|tags| tags.get("rotate"))
                            .and_then(rotation_degrees_from_value)
                    })
            })
        })
        .or_else(|| {
            stream
                .get("tags")
                .and_then(|tags| tags.get("rotate"))
                .and_then(rotation_degrees_from_value)
        })
}

fn rotation_degrees_from_value(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| {
        value
            .as_str()
            .and_then(|rotation| rotation.trim().parse::<f64>().ok())
    })
}

fn is_right_angle_rotation(rotation: f64) -> bool {
    if !rotation.is_finite() {
        return false;
    }

    let normalized = rotation.rem_euclid(360.0).round() as u16;
    normalized == 90 || normalized == 270
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
    fn parse_primary_video_dimensions_skips_attached_picture_streams() {
        let json = r#"{
            "streams": [
                { "codec_type": "audio", "width": 2, "height": 2 },
                {
                    "codec_type": "video",
                    "width": 600,
                    "height": 600,
                    "disposition": { "attached_pic": 1 }
                },
                {
                    "codec_type": "video",
                    "width": 1920,
                    "height": 1080,
                    "disposition": { "attached_pic": 0 }
                }
            ]
        }"#;

        let dimensions = parse_primary_video_dimensions(json)
            .expect("non-attached video stream dimensions should parse");

        assert_eq!(dimensions.width, 1920);
        assert_eq!(dimensions.height, 1080);
    }

    #[test]
    fn parse_primary_video_dimensions_swaps_for_side_data_rotation_90() {
        let json = r#"{
            "streams": [
                {
                    "codec_type": "video",
                    "width": 1920,
                    "height": 1080,
                    "side_data_list": [{ "rotation": 90 }]
                }
            ]
        }"#;

        let dimensions = parse_primary_video_dimensions(json)
            .expect("rotated video stream dimensions should parse");

        assert_eq!(dimensions.width, 1080);
        assert_eq!(dimensions.height, 1920);
    }

    #[test]
    fn parse_primary_video_dimensions_swaps_for_side_data_tags_rotate_270() {
        let json = r#"{
            "streams": [
                {
                    "codec_type": "video",
                    "width": 1920,
                    "height": 1080,
                    "side_data_list": [{ "tags": { "rotate": "270" } }]
                }
            ]
        }"#;

        let dimensions = parse_primary_video_dimensions(json)
            .expect("rotated video stream dimensions should parse");

        assert_eq!(dimensions.width, 1080);
        assert_eq!(dimensions.height, 1920);
    }

    #[test]
    fn parse_primary_video_dimensions_swaps_for_stream_tags_rotate_negative_90() {
        let json = r#"{
            "streams": [
                {
                    "codec_type": "video",
                    "width": 1920,
                    "height": 1080,
                    "tags": { "rotate": "-90" }
                }
            ]
        }"#;

        let dimensions = parse_primary_video_dimensions(json)
            .expect("rotated video stream dimensions should parse");

        assert_eq!(dimensions.width, 1080);
        assert_eq!(dimensions.height, 1920);
    }

    #[test]
    fn parse_primary_video_dimensions_swaps_for_nearly_right_angle_rotation() {
        let json = r#"{
            "streams": [
                {
                    "codec_type": "video",
                    "width": 1920,
                    "height": 1080,
                    "side_data_list": [{ "rotation": "89.9999" }]
                }
            ]
        }"#;

        let dimensions = parse_primary_video_dimensions(json)
            .expect("rotated video stream dimensions should parse");

        assert_eq!(dimensions.width, 1080);
        assert_eq!(dimensions.height, 1920);
    }

    #[test]
    fn parse_primary_video_dimensions_keeps_original_for_rotation_180() {
        let json = r#"{
            "streams": [
                {
                    "codec_type": "video",
                    "width": 1920,
                    "height": 1080,
                    "side_data_list": [{ "rotation": 180 }]
                }
            ]
        }"#;

        let dimensions = parse_primary_video_dimensions(json)
            .expect("rotated video stream dimensions should parse");

        assert_eq!(dimensions.width, 1920);
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
