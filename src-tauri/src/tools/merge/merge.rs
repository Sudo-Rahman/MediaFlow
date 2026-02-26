use crate::shared::ffmpeg_progress::FfmpegProgressTracker;
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::store::{resolve_ffmpeg_path, resolve_ffprobe_path};
use crate::shared::validation::{validate_media_path, validate_output_path};
use crate::tools::ffprobe::FFPROBE_TIMEOUT;
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use tauri::Emitter;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

/// Timeout for FFmpeg merge operations (10 minutes)
const FFMPEG_MERGE_TIMEOUT: Duration = Duration::from_secs(600);

#[cfg_attr(not(test), allow(dead_code))]
fn enabled_source_indices(
    source_track_configs: Option<&[Value]>,
    original_stream_count: usize,
) -> Vec<usize> {
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

struct SourceTrackSelection<'a> {
    input_idx: usize,
    original_index: usize,
    config: Option<&'a Value>,
}

fn build_source_track_selections<'a>(
    source_track_configs: Option<&'a [Value]>,
    original_stream_count: usize,
    args: &mut Vec<String>,
    video_path: &str,
) -> (Vec<SourceTrackSelection<'a>>, usize) {
    let mut selections = Vec::new();
    let mut delayed_input_indices: HashMap<i64, usize> = HashMap::new();
    let mut next_input_idx = 1usize;

    if let Some(configs) = source_track_configs {
        for source_config in configs {
            let enabled = source_config
                .get("config")
                .and_then(|cfg| cfg.get("enabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            if !enabled {
                continue;
            }

            let Some(original_index) = source_config
                .get("originalIndex")
                .and_then(|v| v.as_u64())
                .map(|i| i as usize)
            else {
                continue;
            };

            let delay_ms = source_config
                .get("config")
                .and_then(|cfg| cfg.get("delayMs"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            let input_idx = if delay_ms == 0 {
                0
            } else if let Some(existing_input_idx) = delayed_input_indices.get(&delay_ms) {
                *existing_input_idx
            } else {
                let delay_sec = delay_ms as f64 / 1000.0;
                args.push("-itsoffset".to_string());
                args.push(format!("{:.3}", delay_sec));
                args.push("-i".to_string());
                args.push(video_path.to_string());

                let new_input_idx = next_input_idx;
                delayed_input_indices.insert(delay_ms, new_input_idx);
                next_input_idx += 1;
                new_input_idx
            };

            selections.push(SourceTrackSelection {
                input_idx,
                original_index,
                config: source_config.get("config"),
            });
        }
    } else {
        for original_index in 0..original_stream_count {
            selections.push(SourceTrackSelection {
                input_idx: 0,
                original_index,
                config: None,
            });
        }
    }

    (selections, next_input_idx)
}

fn build_merge_args(
    video_path: &str,
    tracks: &[Value],
    source_track_configs: Option<&[Value]>,
    original_stream_count: usize,
    output_path: &str,
) -> Vec<String> {
    let mut args = vec!["-y".to_string(), "-i".to_string(), video_path.to_string()];
    let (source_track_selections, mut next_input_idx) = build_source_track_selections(
        source_track_configs,
        original_stream_count,
        &mut args,
        video_path,
    );
    let mut attached_track_inputs: Vec<(usize, &Value)> = Vec::new();

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
            attached_track_inputs.push((next_input_idx, track));
            next_input_idx += 1;
        }
    }

    for source_track in &source_track_selections {
        args.push("-map".to_string());
        args.push(format!(
            "{}:{}",
            source_track.input_idx, source_track.original_index
        ));
    }

    for (input_idx, _) in &attached_track_inputs {
        args.push("-map".to_string());
        args.push(format!("{}:0", input_idx));
    }

    args.push("-c:v".to_string());
    args.push("copy".to_string());
    args.push("-c:a".to_string());
    args.push("copy".to_string());
    args.push("-c:s".to_string());
    args.push("copy".to_string());

    for (output_stream_idx, source_track) in source_track_selections.iter().enumerate() {
        if let Some(cfg) = source_track.config {
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
    }

    let attached_start_idx = source_track_selections.len();
    for (i, (_, track)) in attached_track_inputs.iter().enumerate() {
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

    args.push("-progress".to_string());
    args.push("pipe:1".to_string());
    args.push(output_path.to_string());
    args
}

fn emit_merge_progress(
    app: &tauri::AppHandle,
    video_path: &str,
    output_path: &str,
    progress: i32,
    speed_bytes_per_sec: Option<f64>,
) {
    let _ = app.emit(
        "merge-progress",
        serde_json::json!({
            "videoPath": video_path,
            "outputPath": output_path,
            "progress": progress,
            "speedBytesPerSec": speed_bytes_per_sec
        }),
    );
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
    duration_us: Option<u64>,
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
    let mut child = Command::new(ffmpeg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    emit_merge_progress(&app, &video_path, &output_path, 0, None);

    if let Some(pid) = child.id() {
        if let Ok(mut guard) = super::state::MERGE_PROCESS_IDS.lock() {
            guard.insert(video_path.clone(), pid);
        }
    }

    if let Ok(mut guard) = super::state::MERGE_OUTPUT_PATHS.lock() {
        guard.insert(video_path.clone(), output_path.clone());
    }

    if let Some(stdout) = child.stdout.take() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let app_for_progress = app.clone();
        let video_path_for_progress = video_path.clone();
        let output_path_for_progress = output_path.clone();

        tokio::spawn(async move {
            let mut tracker = FfmpegProgressTracker::new(duration_us);
            let mut last_progress = 0;
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(update) = tracker.handle_line(&line) {
                    if let Some(progress) = update.progress {
                        last_progress = progress;
                    }

                    emit_merge_progress(
                        &app_for_progress,
                        &video_path_for_progress,
                        &output_path_for_progress,
                        last_progress,
                        update.speed_bytes_per_sec,
                    );

                    if update.is_end {
                        last_progress = 100;
                    }
                }
            }
        });
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

    emit_merge_progress(&app, &video_path, &output_path, 100, None);

    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use serde_json::json;

    use super::{build_merge_args, enabled_source_indices, merge_tracks_with_bins};

    fn has_arg_pair(args: &[String], left: &str, right: &str) -> bool {
        args.windows(2)
            .any(|window| window[0] == left && window[1] == right)
    }

    fn count_arg_pair(args: &[String], left: &str, right: &str) -> usize {
        args.windows(2)
            .filter(|window| window[0] == left && window[1] == right)
            .count()
    }

    fn stream_start_time(stream: &Value) -> f64 {
        stream
            .get("start_time")
            .and_then(|v| v.as_str())
            .expect("stream should have start_time")
            .parse::<f64>()
            .expect("start_time should be numeric")
    }

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
        assert!(args.windows(2).any(|w| w == ["-progress", "pipe:1"]));
        assert_eq!(args.last().map(String::as_str), Some("/tmp/out.mkv"));
    }

    #[test]
    fn build_merge_args_maps_multiple_external_tracks() {
        let tracks = vec![
            json!({"inputPath": "/tmp/sub1.srt", "config": {"language": "eng"}}),
            json!({"inputPath": "/tmp/sub2.srt", "config": {"language": "fra"}}),
        ];

        let args = build_merge_args("/tmp/video.mkv", &tracks, None, 2, "/tmp/out.mkv");

        assert!(has_arg_pair(&args, "-map", "0:0"));
        assert!(has_arg_pair(&args, "-map", "0:1"));
        assert!(has_arg_pair(&args, "-map", "1:0"));
        assert!(has_arg_pair(&args, "-map", "2:0"));
    }

    #[test]
    fn build_merge_args_applies_source_delay_with_dedicated_input() {
        let source_configs = vec![
            json!({"originalIndex": 0, "config": {"enabled": true, "delayMs": 1500}}),
            json!({"originalIndex": 1, "config": {"enabled": true, "delayMs": 0}}),
        ];

        let args = build_merge_args(
            "/tmp/video.mkv",
            &[],
            Some(&source_configs),
            2,
            "/tmp/out.mkv",
        );

        assert!(has_arg_pair(&args, "-itsoffset", "1.500"));
        assert!(has_arg_pair(&args, "-map", "1:0"));
        assert!(has_arg_pair(&args, "-map", "0:1"));
    }

    #[test]
    fn build_merge_args_reuses_source_delay_inputs_with_same_delay() {
        let source_configs = vec![
            json!({"originalIndex": 0, "config": {"enabled": true, "delayMs": 900}}),
            json!({"originalIndex": 1, "config": {"enabled": true, "delayMs": 900}}),
            json!({"originalIndex": 2, "config": {"enabled": true, "delayMs": 0}}),
        ];

        let args = build_merge_args(
            "/tmp/video.mkv",
            &[],
            Some(&source_configs),
            3,
            "/tmp/out.mkv",
        );

        assert_eq!(count_arg_pair(&args, "-itsoffset", "0.900"), 1);
        assert!(has_arg_pair(&args, "-map", "1:0"));
        assert!(has_arg_pair(&args, "-map", "1:1"));
        assert!(has_arg_pair(&args, "-map", "0:2"));
    }

    #[test]
    fn build_merge_args_maps_external_inputs_after_source_delay_inputs() {
        let tracks = vec![
            json!({"inputPath": "/tmp/sub1.srt", "config": {"language": "eng"}}),
            json!({"inputPath": "/tmp/sub2.srt", "config": {"language": "fra"}}),
        ];
        let source_configs = vec![json!({
            "originalIndex": 0,
            "config": {"enabled": true, "delayMs": 1200, "language": "jpn"}
        })];

        let args = build_merge_args(
            "/tmp/video.mkv",
            &tracks,
            Some(&source_configs),
            2,
            "/tmp/out.mkv",
        );

        assert!(has_arg_pair(&args, "-itsoffset", "1.200"));
        assert!(has_arg_pair(&args, "-map", "1:0"));
        assert!(has_arg_pair(&args, "-map", "2:0"));
        assert!(has_arg_pair(&args, "-map", "3:0"));
        assert!(has_arg_pair(&args, "-metadata:s:1", "language=eng"));
        assert!(has_arg_pair(&args, "-metadata:s:2", "language=fra"));
    }

    #[test]
    fn build_merge_args_applies_metadata_and_disposition_for_source_and_attached_tracks() {
        let tracks = vec![json!({
            "inputPath": "/tmp/sub.srt",
            "config": {
                "language": "eng",
                "title": "English subtitle",
                "default": true,
                "forced": false
            }
        })];
        let source_configs = vec![json!({
            "originalIndex": 0,
            "config": {
                "enabled": true,
                "language": "jpn",
                "title": "Main stream",
                "default": false,
                "forced": true
            }
        })];

        let args = build_merge_args(
            "/tmp/video.mkv",
            &tracks,
            Some(&source_configs),
            1,
            "/tmp/out.mkv",
        );

        assert!(has_arg_pair(&args, "-metadata:s:0", "language=jpn"));
        assert!(has_arg_pair(&args, "-metadata:s:0", "title=Main stream"));
        assert!(has_arg_pair(&args, "-disposition:0", "forced"));

        assert!(has_arg_pair(&args, "-metadata:s:1", "language=eng"));
        assert!(has_arg_pair(
            &args,
            "-metadata:s:1",
            "title=English subtitle"
        ));
        assert!(has_arg_pair(&args, "-disposition:1", "default"));
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

        let probe_json = crate::tools::ffprobe::probe::probe_file_with_ffprobe(
            "ffprobe",
            video.to_string_lossy().as_ref(),
        )
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

        let merged_probe = crate::tools::ffprobe::probe::probe_file_with_ffprobe(
            "ffprobe",
            output.to_string_lossy().as_ref(),
        )
        .await
        .expect("probe merged output should succeed");
        let merged_value: Value =
            serde_json::from_str(&merged_probe).expect("merged probe json should be valid");

        let subtitle_stream = merged_value
            .get("streams")
            .and_then(|v| v.as_array())
            .and_then(|streams| {
                streams.iter().find(|stream| {
                    stream
                        .get("codec_type")
                        .and_then(|v| v.as_str())
                        .map(|codec_type| codec_type == "subtitle")
                        .unwrap_or(false)
                })
            })
            .expect("merged output should contain subtitle stream");

        let language = subtitle_stream
            .get("tags")
            .and_then(|tags| tags.get("language"))
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        assert_eq!(language, "eng");

        let title = subtitle_stream
            .get("tags")
            .and_then(|tags| tags.get("title"))
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        assert_eq!(title, "English");

        let default_disposition = subtitle_stream
            .get("disposition")
            .and_then(|d| d.get("default"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        assert_eq!(default_disposition, 1);
    }

    #[tokio::test]
    async fn merge_tracks_applies_delay_to_source_audio_track() {
        let video = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("merged-source-delay.mkv");

        let probe_json = crate::tools::ffprobe::probe::probe_file_with_ffprobe(
            "ffprobe",
            video.to_string_lossy().as_ref(),
        )
        .await
        .expect("probe should succeed");
        let probe_value: Value =
            serde_json::from_str(&probe_json).expect("valid probe json expected");

        let source_track_configs: Vec<Value> = probe_value
            .get("streams")
            .and_then(|v| v.as_array())
            .expect("streams should be an array")
            .iter()
            .filter_map(|stream| {
                let index = stream.get("index")?.as_u64()?;
                let codec_type = stream.get("codec_type").and_then(|v| v.as_str())?;

                if !matches!(codec_type, "audio" | "video") {
                    return None;
                }

                let delay_ms = if codec_type == "audio" { 1500 } else { 0 };
                Some(json!({
                    "originalIndex": index,
                    "config": {
                        "enabled": true,
                        "delayMs": delay_ms
                    }
                }))
            })
            .collect();

        merge_tracks_with_bins(
            "ffprobe",
            "ffmpeg",
            video.to_string_lossy().as_ref(),
            &[],
            Some(&source_track_configs),
            output.to_string_lossy().as_ref(),
        )
        .await
        .expect("merge should succeed");

        let merged_probe = crate::tools::ffprobe::probe::probe_file_with_ffprobe(
            "ffprobe",
            output.to_string_lossy().as_ref(),
        )
        .await
        .expect("probe merged output should succeed");
        let merged_value: Value =
            serde_json::from_str(&merged_probe).expect("merged probe json should be valid");

        let streams = merged_value
            .get("streams")
            .and_then(|v| v.as_array())
            .expect("merged output should have streams");

        let audio_stream = streams
            .iter()
            .find(|stream| stream.get("codec_type").and_then(|v| v.as_str()) == Some("audio"))
            .expect("merged output should contain audio stream");
        let video_stream = streams
            .iter()
            .find(|stream| stream.get("codec_type").and_then(|v| v.as_str()) == Some("video"))
            .expect("merged output should contain video stream");

        let audio_start = stream_start_time(audio_stream);
        let video_start = stream_start_time(video_stream);

        assert!(
            audio_start >= 1.4,
            "audio stream should be delayed by ~1.5s, got {audio_start}"
        );
        assert!(
            video_start <= 0.1,
            "video stream should remain near 0s start, got {video_start}"
        );
    }
}
