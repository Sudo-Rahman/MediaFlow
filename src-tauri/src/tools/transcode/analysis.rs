use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use crate::shared::process::tokio_command;
use serde_json::Value;
use tokio::time::timeout;

use crate::shared::hash::stable_hash64;
use crate::shared::store::{resolve_ffmpeg_path, resolve_ffprobe_path};
use crate::shared::validation::validate_media_path;
use crate::tools::ffprobe::probe::probe_file_with_ffprobe;

const ANALYSIS_FRAME_TIMEOUT: Duration = Duration::from_secs(60);

pub(crate) fn select_analysis_timestamps(duration_us: u64, frame_count: usize) -> Vec<f64> {
    if duration_us == 0 || frame_count == 0 {
        return Vec::new();
    }

    let duration_seconds = duration_us as f64 / 1_000_000.0;
    if duration_seconds <= 0.0 {
        return Vec::new();
    }

    let guard = duration_seconds.min(1.0) / 2.0;
    let usable_start = guard;
    let usable_end = (duration_seconds - guard).max(usable_start);
    let usable_span = (usable_end - usable_start).max(0.0);

    (0..frame_count)
        .map(|index| {
            if usable_span <= 0.0 {
                return usable_start.max(0.0);
            }

            let ratio = (index + 1) as f64 / (frame_count + 1) as f64;
            usable_start + (usable_span * ratio)
        })
        .collect()
}

fn input_has_video_stream(probe_value: &Value) -> bool {
    probe_value
        .get("streams")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .any(|stream| {
            stream
                .get("codec_type")
                .and_then(|value| value.as_str())
                .is_some_and(|codec_type| codec_type == "video")
        })
}

fn build_analysis_frame_dir(input_path: &str) -> PathBuf {
    std::env::temp_dir()
        .join("mediaflow_transcode_analysis")
        .join(format!("{:016x}", stable_hash64(input_path)))
}

pub(crate) async fn extract_transcode_analysis_frames_with_bins(
    ffmpeg_path: &str,
    ffprobe_path: &str,
    input_path: &str,
    frame_count: usize,
) -> Result<Vec<String>, String> {
    validate_media_path(input_path)?;

    let probe_json = probe_file_with_ffprobe(ffprobe_path, input_path).await?;
    let probe_value: Value = serde_json::from_str(&probe_json)
        .map_err(|error| format!("Invalid probe JSON: {}", error))?;

    if !input_has_video_stream(&probe_value) {
        return Ok(Vec::new());
    }

    let duration_us =
        crate::tools::ffprobe::get_media_duration_us_with_ffprobe(ffprobe_path, input_path)
            .await
            .unwrap_or(0);
    let timestamps = select_analysis_timestamps(duration_us, frame_count);
    if timestamps.is_empty() {
        return Ok(Vec::new());
    }

    let output_dir = build_analysis_frame_dir(input_path);
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Failed to create analysis frame directory: {}", error))?;

    let mut output_paths = Vec::with_capacity(timestamps.len());
    for (index, timestamp) in timestamps.iter().enumerate() {
        let output_path = output_dir.join(format!("frame-{}.png", index + 1));
        let timestamp_arg = format!("{:.3}", timestamp);

        let output = timeout(
            ANALYSIS_FRAME_TIMEOUT,
            tokio_command(ffmpeg_path)
                .args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-ss",
                    &timestamp_arg,
                    "-i",
                    input_path,
                    "-frames:v",
                    "1",
                    output_path.to_string_lossy().as_ref(),
                ])
                .output(),
        )
        .await
        .map_err(|_| "Timed out while extracting analysis frame".to_string())?
        .map_err(|error| format!("Failed to run ffmpeg for analysis frames: {}", error))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Failed to extract analysis frame: {}",
                stderr.trim()
            ));
        }

        output_paths.push(output_path.to_string_lossy().to_string());
    }

    Ok(output_paths)
}

#[tauri::command]
pub(crate) async fn extract_transcode_analysis_frames(
    app: tauri::AppHandle,
    input_path: String,
    frame_count: Option<usize>,
) -> Result<Vec<String>, String> {
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let ffprobe_path = resolve_ffprobe_path(&app)?;
    extract_transcode_analysis_frames_with_bins(
        &ffmpeg_path,
        &ffprobe_path,
        &input_path,
        frame_count.unwrap_or(6),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{extract_transcode_analysis_frames_with_bins, select_analysis_timestamps};

    #[test]
    fn select_analysis_timestamps_spreads_across_duration() {
        let timestamps = select_analysis_timestamps(120_000_000, 6);
        assert_eq!(timestamps.len(), 6);
        assert!(timestamps[0] > 0.0);
        assert!(timestamps[5] < 120.0);
        assert!(timestamps.windows(2).all(|window| window[1] > window[0]));
    }

    #[tokio::test]
    async fn extract_transcode_analysis_frames_returns_images_for_video_input() {
        let input = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");

        let output_paths = extract_transcode_analysis_frames_with_bins(
            crate::test_support::ffmpeg::ffmpeg_path(),
            crate::test_support::ffmpeg::ffprobe_path(),
            input.to_string_lossy().as_ref(),
            3,
        )
        .await
        .expect("analysis frames should be extracted");

        assert_eq!(output_paths.len(), 3);
        assert!(
            output_paths
                .iter()
                .all(|path| std::path::Path::new(path).exists())
        );
        assert!(output_paths.iter().all(|path| path.ends_with(".png")));
    }
}
