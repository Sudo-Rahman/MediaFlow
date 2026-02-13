use crate::shared::store::{resolve_ffmpeg_path, resolve_ffprobe_path};
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::validation::{validate_media_path, validate_output_path};
use crate::tools::ffprobe::FFPROBE_TIMEOUT;
use serde_json::Value;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

/// Timeout for FFmpeg merge operations (10 minutes)
const FFMPEG_MERGE_TIMEOUT: Duration = Duration::from_secs(600);

fn enabled_source_indices(source_track_configs: Option<&[Value]>, original_stream_count: usize) -> Vec<usize> {
    if let Some(configs) = source_track_configs {
        configs
            .iter()
            .filter_map(|c| {
                let enabled = c
                    .get("config")
                    .and_then(|cfg| cfg.get("enabled"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if enabled {
                    c.get("originalIndex")
                        .and_then(|v| v.as_u64())
                        .map(|i| i as usize)
                } else {
                    None
                }
            })
            .collect()
    } else {
        (0..original_stream_count).collect()
    }
}

fn build_merge_args(
    video_path: &str,
    tracks: &[Value],
    source_track_configs: Option<&[Value]>,
    original_stream_count: usize,
    output_path: &str,
) -> Vec<String> {
    let enabled_source_indices = enabled_source_indices(source_track_configs, original_stream_count);

    let mut args = vec!["-y".to_string(), "-i".to_string(), video_path.to_string()];

    for track in tracks {
        if let Some(input_path) = track.get("inputPath").and_then(|v| v.as_str()) {
            let delay_ms = track
                .get("config")
                .and_then(|c| c.get("delayMs"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            if delay_ms != 0 {
                let delay_sec = delay_ms as f64 / 1000.0;
                args.push("-itsoffset".to_string());
                args.push(format!("{:.3}", delay_sec));
            }

            args.push("-i".to_string());
            args.push(input_path.to_string());
        }
    }

    for &idx in &enabled_source_indices {
        args.push("-map".to_string());
        args.push(format!("0:{}", idx));
    }

    for (i, _track) in tracks.iter().enumerate() {
        let input_idx = i + 1;
        args.push("-map".to_string());
        args.push(format!("{}:0", input_idx));
    }

    args.push("-c:v".to_string());
    args.push("copy".to_string());
    args.push("-c:a".to_string());
    args.push("copy".to_string());
    args.push("-c:s".to_string());
    args.push("copy".to_string());

    if let Some(configs) = source_track_configs {
        let mut output_stream_idx = 0;
        for config in configs {
            let enabled = config
                .get("config")
                .and_then(|cfg| cfg.get("enabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);

            if !enabled {
                continue;
            }

            if let Some(cfg) = config.get("config") {
                if let Some(lang) = cfg.get("language").and_then(|v| v.as_str()) {
                    if !lang.is_empty() {
                        args.push(format!("-metadata:s:{}", output_stream_idx));
                        args.push(format!("language={}", lang));
                    }
                }

                if let Some(title) = cfg.get("title").and_then(|v| v.as_str()) {
                    args.push(format!("-metadata:s:{}", output_stream_idx));
                    args.push(format!("title={}", title));
                }

                let is_default = cfg
                    .get("default")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let is_forced = cfg.get("forced").and_then(|v| v.as_bool()).unwrap_or(false);

                if is_default || is_forced {
                    let mut disposition = Vec::new();
                    if is_default {
                        disposition.push("default");
                    }
                    if is_forced {
                        disposition.push("forced");
                    }
                    args.push(format!("-disposition:{}", output_stream_idx));
                    args.push(disposition.join("+"));
                } else {
                    args.push(format!("-disposition:{}", output_stream_idx));
                    args.push("0".to_string());
                }
            }

            output_stream_idx += 1;
        }
    }

    let attached_start_idx = enabled_source_indices.len();
    for (i, track) in tracks.iter().enumerate() {
        let output_stream_idx = attached_start_idx + i;

        if let Some(config) = track.get("config") {
            if let Some(lang) = config.get("language").and_then(|v| v.as_str()) {
                if !lang.is_empty() && lang != "und" {
                    args.push(format!("-metadata:s:{}", output_stream_idx));
                    args.push(format!("language={}", lang));
                }
            }

            if let Some(title) = config.get("title").and_then(|v| v.as_str()) {
                if !title.is_empty() {
                    args.push(format!("-metadata:s:{}", output_stream_idx));
                    args.push(format!("title={}", title));
                }
            }

            let is_default = config
                .get("default")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let is_forced = config
                .get("forced")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if is_default || is_forced {
                let mut disposition = Vec::new();
                if is_default {
                    disposition.push("default");
                }
                if is_forced {
                    disposition.push("forced");
                }
                args.push(format!("-disposition:{}", output_stream_idx));
                args.push(disposition.join("+"));
            } else {
                args.push(format!("-disposition:{}", output_stream_idx));
                args.push("0".to_string());
            }
        }
    }

    args.push(output_path.to_string());
    args
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) async fn merge_tracks_with_bins(
    ffprobe_path: &str,
    ffmpeg_path: &str,
    video_path: &str,
    tracks: &[Value],
    source_track_configs: Option<&[Value]>,
    output_path: &str,
) -> Result<(), String> {
    validate_media_path(video_path)?;
    validate_output_path(output_path)?;

    for track in tracks {
        if let Some(input_path) = track.get("inputPath").and_then(|v| v.as_str()) {
            validate_media_path(input_path)?;
        }
    }

    let probe_future = async move {
        Command::new(ffprobe_path)
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                video_path,
            ])
            .output()
            .await
    };

    let probe_output = timeout(FFPROBE_TIMEOUT, probe_future)
        .await
        .map_err(|_| {
            format!(
                "FFprobe timeout after {} seconds",
                FFPROBE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("Failed to probe video: {}", e))?;

    if !probe_output.status.success() {
        return Err("Failed to probe video file".to_string());
    }

    let probe_json: Value = serde_json::from_slice(&probe_output.stdout)
        .map_err(|e| format!("Failed to parse probe output: {}", e))?;
    let streams = probe_json
        .get("streams")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();
    let original_stream_count = streams.len();

    let args = build_merge_args(
        video_path,
        tracks,
        source_track_configs,
        original_stream_count,
        output_path,
    );

    let wait_future = async move {
        Command::new(ffmpeg_path)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
    };

    let output = timeout(FFMPEG_MERGE_TIMEOUT, wait_future)
        .await
        .map_err(|_| {
            format!(
                "FFmpeg merge timeout after {} seconds",
                FFMPEG_MERGE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg merge failed: {}", stderr));
    }

    Ok(())
}

/// Merge tracks into a video file
/// Uses async tokio::process::Command with timeout
#[tauri::command]
pub(crate) async fn merge_tracks(
    app: tauri::AppHandle,
    video_path: String,
    tracks: Vec<Value>,
    source_track_configs: Option<Vec<Value>>,
    output_path: String,
) -> Result<(), String> {
    // Validate input paths
    validate_media_path(&video_path)?;
    validate_output_path(&output_path)?;

    let _sleep_guard = SleepInhibitGuard::try_acquire("FFmpeg merge").ok();

    // Validate all track input paths
    for track in &tracks {
        if let Some(input_path) = track.get("inputPath").and_then(|v| v.as_str()) {
            validate_media_path(input_path)?;
        }
    }

    // First, probe the video to count streams and get their types
    let ffprobe_path = resolve_ffprobe_path(&app)?;
    let video_path_for_probe = video_path.clone();
    let probe_future = async move {
        Command::new(ffprobe_path)
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                &video_path_for_probe,
            ])
            .output()
            .await
    };

    let probe_output = timeout(FFPROBE_TIMEOUT, probe_future)
        .await
        .map_err(|_| {
            format!(
                "FFprobe timeout after {} seconds",
                FFPROBE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("Failed to probe video: {}", e))?;

    if !probe_output.status.success() {
        return Err("Failed to probe video file".to_string());
    }

    let probe_json: Value = serde_json::from_slice(&probe_output.stdout)
        .map_err(|e| format!("Failed to parse probe output: {}", e))?;

    let streams = probe_json
        .get("streams")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();

    let original_stream_count = streams.len();

    let args = build_merge_args(
        &video_path,
        &tracks,
        source_track_configs.as_deref(),
        original_stream_count,
        &output_path,
    );

    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let child = Command::new(ffmpeg_path)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    if let Some(pid) = child.id() {
        if let Ok(mut guard) = super::state::MERGE_PROCESS_IDS.lock() {
            guard.insert(video_path.clone(), pid);
        }
    }

    if let Ok(mut guard) = super::state::MERGE_OUTPUT_PATHS.lock() {
        guard.insert(video_path.clone(), output_path.clone());
    }

    let wait_future = async { child.wait_with_output().await };

    // Execute with timeout
    let output = timeout(FFMPEG_MERGE_TIMEOUT, wait_future)
        .await
        .map_err(|_| {
            if let Ok(mut guard) = super::state::MERGE_PROCESS_IDS.lock() {
                guard.remove(&video_path);
            }
            if let Ok(mut guard) = super::state::MERGE_OUTPUT_PATHS.lock() {
                guard.remove(&video_path);
            }
            format!(
                "FFmpeg merge timeout after {} seconds",
                FFMPEG_MERGE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| {
            if let Ok(mut guard) = super::state::MERGE_PROCESS_IDS.lock() {
                guard.remove(&video_path);
            }
            if let Ok(mut guard) = super::state::MERGE_OUTPUT_PATHS.lock() {
                guard.remove(&video_path);
            }
            format!("Failed to execute ffmpeg: {}", e)
        })?;

    if let Ok(mut guard) = super::state::MERGE_PROCESS_IDS.lock() {
        guard.remove(&video_path);
    }
    if let Ok(mut guard) = super::state::MERGE_OUTPUT_PATHS.lock() {
        guard.remove(&video_path);
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg merge failed: {}", stderr));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{build_merge_args, enabled_source_indices, merge_tracks_with_bins};

    #[test]
    fn enabled_source_indices_uses_all_streams_when_no_config_provided() {
        let indices = enabled_source_indices(None, 3);
        assert_eq!(indices, vec![0, 1, 2]);
    }

    #[test]
    fn enabled_source_indices_filters_disabled_tracks() {
        let configs = vec![
            json!({"originalIndex": 0, "config": {"enabled": true}}),
            json!({"originalIndex": 1, "config": {"enabled": false}}),
            json!({"originalIndex": 2, "config": {"enabled": true}}),
        ];
        let indices = enabled_source_indices(Some(&configs), 3);
        assert_eq!(indices, vec![0, 2]);
    }

    #[test]
    fn build_merge_args_includes_external_track_delay_and_mapping() {
        let tracks = vec![json!({
            "inputPath": "/tmp/sub.srt",
            "config": {
                "delayMs": 1500,
                "language": "eng",
                "title": "English",
                "default": true,
                "forced": false
            }
        })];

        let args = build_merge_args("/tmp/video.mkv", &tracks, None, 2, "/tmp/out.mkv");

        assert!(args.windows(2).any(|w| w == ["-itsoffset", "1.500"]));
        assert!(args.windows(2).any(|w| w == ["-map", "0:0"]));
        assert!(args.windows(2).any(|w| w == ["-map", "0:1"]));
        assert!(args.windows(2).any(|w| w == ["-map", "1:0"]));
        assert_eq!(args.last().map(String::as_str), Some("/tmp/out.mkv"));
    }

    #[tokio::test]
    async fn merge_tracks_adds_external_subtitle_track() {
        let video = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let subtitle = temp.path().join("sub.srt");
        std::fs::write(
            &subtitle,
            b"1\n00:00:00,000 --> 00:00:01,000\nHello world\n",
        )
        .expect("failed to write subtitle");
        let output = temp.path().join("merged.mkv");

        let tracks = vec![json!({
            "inputPath": subtitle.to_string_lossy().to_string(),
            "config": {
                "language": "eng",
                "title": "English",
                "default": true,
                "forced": false
            }
        })];

        let probe_json =
            crate::tools::ffprobe::probe::probe_file_with_ffprobe("ffprobe", video.to_string_lossy().as_ref())
                .await
                .expect("probe should succeed");
        let probe_value: serde_json::Value =
            serde_json::from_str(&probe_json).expect("valid probe json expected");
        let source_track_configs: Vec<serde_json::Value> = probe_value
            .get("streams")
            .and_then(|v| v.as_array())
            .expect("streams should be an array")
            .iter()
            .filter_map(|stream| {
                let index = stream.get("index")?.as_u64()?;
                let codec_type = stream
                    .get("codec_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let enabled = matches!(codec_type, "video" | "audio" | "subtitle");
                Some(json!({
                    "originalIndex": index,
                    "config": {
                        "enabled": enabled
                    }
                }))
            })
            .collect();

        merge_tracks_with_bins(
            "ffprobe",
            "ffmpeg",
            video.to_string_lossy().as_ref(),
            &tracks,
            Some(&source_track_configs),
            output.to_string_lossy().as_ref(),
        )
        .await
        .expect("merge should succeed");

        assert!(output.exists());
    }
}
