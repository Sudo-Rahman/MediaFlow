use std::process::Stdio;

use crate::shared::process::tokio_command;
use crate::shared::process::wait_with_output_timeout;
use crate::shared::store::resolve_ffprobe_path;
use crate::tools::ffprobe::FFPROBE_TIMEOUT;
use serde_json::Value;

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
    let child = tokio_command(ffprobe_path)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    let output = wait_with_output_timeout(child, "FFprobe", FFPROBE_TIMEOUT).await?;

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

pub(crate) fn parse_duration_us_from_probe_json(probe_json: &str) -> Result<Option<u64>, String> {
    let value: Value = serde_json::from_str(probe_json)
        .map_err(|error| format!("Failed to parse ffprobe duration metadata: {}", error))?;
    let Some(duration_value) = value
        .get("format")
        .and_then(|format| format.get("duration"))
    else {
        return Ok(None);
    };

    let duration_seconds = match duration_value {
        Value::String(duration) => duration
            .trim()
            .parse::<f64>()
            .map_err(|_| format!("Invalid duration: {}", duration_value)),
        Value::Number(duration) => duration
            .as_f64()
            .ok_or_else(|| format!("Invalid duration: {}", duration_value)),
        _ => return Ok(None),
    }?;

    if duration_seconds.is_finite() && duration_seconds > 0.0 {
        Ok(Some((duration_seconds * 1_000_000.0) as u64))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::{get_media_duration_us_with_ffprobe, parse_duration_us_from_probe_json};

    #[tokio::test]
    async fn get_media_duration_us_returns_non_zero_for_sample_video() {
        let video = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");

        let duration = get_media_duration_us_with_ffprobe(
            crate::test_support::ffmpeg::ffprobe_path(),
            video.to_string_lossy().as_ref(),
        )
        .await
        .expect("duration probe should succeed");

        assert!(duration > 0);
    }

    #[test]
    fn parse_duration_us_from_probe_json_reads_format_duration() {
        let duration =
            parse_duration_us_from_probe_json(r#"{"format":{"duration":"12.500"},"streams":[]}"#)
                .expect("json should parse");

        assert_eq!(duration, Some(12_500_000));
    }

    #[test]
    fn parse_duration_us_from_probe_json_returns_none_for_missing_duration() {
        let duration = parse_duration_us_from_probe_json(r#"{"format":{},"streams":[]}"#)
            .expect("json should parse");

        assert_eq!(duration, None);
    }

    #[test]
    fn parse_duration_us_from_probe_json_rejects_invalid_duration() {
        let error = parse_duration_us_from_probe_json(
            r#"{"format":{"duration":"not-a-duration"},"streams":[]}"#,
        )
        .expect_err("invalid duration should fail");

        assert!(error.contains("Invalid duration"));
    }
}
