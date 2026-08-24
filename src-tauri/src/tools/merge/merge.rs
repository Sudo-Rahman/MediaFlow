use crate::shared::ffmpeg_progress::{FfmpegProgressTracker, LONG_FFMPEG_PROGRESS_TIMEOUT};
use crate::shared::process::{tokio_command, wait_with_output_progress_watchdog};
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::store::{resolve_ffmpeg_path, resolve_ffprobe_path};
use crate::shared::validation::{validate_media_path, validate_output_path};
use crate::tools::ffprobe::probe::probe_file_with_ffprobe;
use crate::tools::media_metadata::{
    OutputStreamMetadata, apply_metadata_args, output_stream_metadata_from_config,
};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

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
    source_stream: Option<&'a Value>,
    config: Option<&'a Value>,
}

fn stream_string_value<'a>(stream: Option<&'a Value>, key: &str) -> Option<&'a str> {
    stream
        .and_then(|stream| stream.get(key))
        .and_then(|value| value.as_str())
}

fn config_string_value<'a>(config: Option<&'a Value>, key: &str) -> Option<&'a str> {
    config
        .and_then(|config| config.get(key))
        .and_then(|value| value.as_str())
}

fn is_data_source_stream(source_stream: Option<&Value>, source_config: Option<&Value>) -> bool {
    stream_string_value(source_stream, "codec_type")
        .or_else(|| config_string_value(source_config, "type"))
        == Some("data")
}

fn unsupported_mkv_subtitle_codec(source_stream: Option<&Value>) -> Option<&str> {
    if stream_string_value(source_stream, "codec_type") != Some("subtitle") {
        return None;
    }

    match stream_string_value(source_stream, "codec_name") {
        Some("mov_text" | "tx3g") => stream_string_value(source_stream, "codec_name"),
        _ => None,
    }
}

fn build_source_track_selections<'a>(
    source_track_configs: Option<&'a [Value]>,
    source_streams: &'a [Value],
    args: &mut Vec<String>,
    video_path: &str,
) -> Result<(Vec<SourceTrackSelection<'a>>, usize), String> {
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

            let source_stream = source_streams.iter().find(|stream| {
                stream
                    .get("index")
                    .and_then(|value| value.as_u64())
                    .is_some_and(|index| index as usize == original_index)
            });

            if is_data_source_stream(source_stream, Some(source_config)) {
                continue;
            }

            if let Some(codec) = unsupported_mkv_subtitle_codec(source_stream) {
                return Err(format!(
                    "MKV merge cannot copy subtitle codec {} from source stream #{}. Disable this track or convert subtitles with Transcode before merging.",
                    codec, original_index
                ));
            }

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
                source_stream,
                config: source_config.get("config"),
            });
        }
    } else {
        for (stream_position, source_stream) in source_streams.iter().enumerate() {
            let original_index = source_stream
                .get("index")
                .and_then(|value| value.as_u64())
                .unwrap_or(stream_position as u64) as usize;

            if is_data_source_stream(Some(source_stream), None) {
                continue;
            }

            if let Some(codec) = unsupported_mkv_subtitle_codec(Some(source_stream)) {
                return Err(format!(
                    "MKV merge cannot copy subtitle codec {} from source stream #{}. Disable this track or convert subtitles with Transcode before merging.",
                    codec, original_index
                ));
            }

            selections.push(SourceTrackSelection {
                input_idx: 0,
                original_index,
                source_stream: Some(source_stream),
                config: None,
            });
        }
    }

    Ok((selections, next_input_idx))
}

fn build_merge_args(
    video_path: &str,
    tracks: &[Value],
    source_track_configs: Option<&[Value]>,
    source_streams: &[Value],
    output_path: &str,
) -> Result<Vec<String>, String> {
    let mut args = vec!["-y".to_string(), "-i".to_string(), video_path.to_string()];
    let (source_track_selections, mut next_input_idx) =
        build_source_track_selections(source_track_configs, source_streams, &mut args, video_path)?;
    let mut attached_track_inputs: Vec<(usize, &Value)> = Vec::new();
    let mut output_metadata = Vec::<OutputStreamMetadata>::new();

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
        output_metadata.push(output_stream_metadata_from_config(
            output_metadata.len(),
            source_track.source_stream,
            source_track.config,
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
    args.push("-max_interleave_delta".to_string());
    args.push("0".to_string());

    let attached_start_idx = source_track_selections.len();
    for (i, (_, track)) in attached_track_inputs.iter().enumerate() {
        let output_stream_idx = attached_start_idx + i;

        output_metadata.push(output_stream_metadata_from_config(
            output_stream_idx,
            None,
            track.get("config"),
        ));
    }

    apply_metadata_args(&mut args, "mkv", None, &output_metadata);

    args.push("-progress".to_string());
    args.push("pipe:1".to_string());
    args.push(output_path.to_string());
    Ok(args)
}

struct PreparedMergeTracks {
    tracks: Vec<Value>,
    temporary_paths: Vec<PathBuf>,
}

impl Drop for PreparedMergeTracks {
    fn drop(&mut self) {
        for path in &self.temporary_paths {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn is_ass_subtitle_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("ass") || extension.eq_ignore_ascii_case("ssa")
        })
}

fn normalize_ass_line_endings(content: &[u8]) -> Vec<u8> {
    // FFmpeg keeps the ASS header in Matroska's CodecPrivate data. CRLF line
    // endings are needed for compatibility with players that parse that
    // header differently from a standalone ASS file.
    if std::str::from_utf8(content).is_err() {
        return content.to_vec();
    }

    let mut normalized = Vec::with_capacity(content.len());
    let mut previous_was_carriage_return = false;

    for &byte in content {
        match byte {
            b'\r' => {
                normalized.push(byte);
                previous_was_carriage_return = true;
            }
            b'\n' => {
                if !previous_was_carriage_return {
                    normalized.push(b'\r');
                }
                normalized.push(byte);
                previous_was_carriage_return = false;
            }
            _ => {
                normalized.push(byte);
                previous_was_carriage_return = false;
            }
        }
    }

    normalized
}

fn prepare_merge_tracks(
    tracks: &[Value],
    output_path: &str,
) -> Result<PreparedMergeTracks, String> {
    let mut prepared_tracks = tracks.to_vec();
    let mut temporary_paths = Vec::new();

    for (track_index, track) in prepared_tracks.iter_mut().enumerate() {
        let Some(input_path) = track
            .get("inputPath")
            .and_then(|value| value.as_str())
            .map(str::to_owned)
        else {
            continue;
        };

        if !is_ass_subtitle_path(&input_path) {
            continue;
        }

        let content = std::fs::read(&input_path)
            .map_err(|error| format!("Failed to read ASS subtitle {}: {}", input_path, error))?;
        let normalized = normalize_ass_line_endings(&content);
        if normalized == content {
            continue;
        }

        let extension = Path::new(&input_path)
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("ass");
        let temporary_path =
            merge_neighbor_path(Path::new(output_path), &format!("ass-{}", track_index))
                .with_extension(extension);
        let mut temporary_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|error| {
                format!(
                    "Failed to create normalized ASS subtitle {}: {}",
                    temporary_path.display(),
                    error
                )
            })?;

        if let Err(error) = temporary_file
            .write_all(&normalized)
            .and_then(|_| temporary_file.flush())
        {
            let _ = std::fs::remove_file(&temporary_path);
            return Err(format!(
                "Failed to write normalized ASS subtitle {}: {}",
                temporary_path.display(),
                error
            ));
        }
        drop(temporary_file);

        if let Some(input_path_value) = track.get_mut("inputPath") {
            *input_path_value = Value::String(temporary_path.to_string_lossy().into_owned());
        }
        temporary_paths.push(temporary_path);
    }

    Ok(PreparedMergeTracks {
        tracks: prepared_tracks,
        temporary_paths,
    })
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

fn remove_partial_merge_output(output_path: &str) {
    let _ = std::fs::remove_file(output_path);
}

fn merge_neighbor_path(output_path: &Path, role: &str) -> PathBuf {
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = output_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("merge-output");
    let extension = output_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value))
        .unwrap_or_default();
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);

    parent.join(format!(
        ".{}.{}.{}.{}{}",
        stem,
        std::process::id(),
        unique,
        role,
        extension
    ))
}

fn publish_merge_output(temp_output_path: &Path, output_path: &Path) -> Result<(), String> {
    let backup_path = output_path
        .exists()
        .then(|| merge_neighbor_path(output_path, "backup"));

    if let Some(backup_path) = backup_path.as_ref() {
        std::fs::rename(output_path, backup_path)
            .map_err(|e| format!("Failed to prepare existing merge output replacement: {}", e))?;
    }

    match std::fs::rename(temp_output_path, output_path) {
        Ok(()) => {
            if let Some(backup_path) = backup_path {
                let _ = std::fs::remove_file(backup_path);
            }
            Ok(())
        }
        Err(error) => {
            if let Some(backup_path) = backup_path.as_ref() {
                let _ = std::fs::rename(backup_path, output_path);
            }
            Err(format!("Failed to publish merge output: {}", error))
        }
    }
}

fn clear_merge_tracking(video_path: &str) {
    if let Ok(mut guard) = super::state::MERGE_PROCESS_IDS.lock() {
        guard.remove(video_path);
    }
    if let Ok(mut guard) = super::state::MERGE_OUTPUT_PATHS.lock() {
        guard.remove(video_path);
    }
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

    let probe_json_string = probe_file_with_ffprobe(ffprobe_path, video_path).await?;
    let probe_json: Value = serde_json::from_str(&probe_json_string)
        .map_err(|e| format!("Failed to parse probe output: {}", e))?;
    let streams = probe_json
        .get("streams")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();
    let final_output_path = Path::new(output_path);
    let temp_output_path = merge_neighbor_path(final_output_path, "tmp");
    let temp_output_str = temp_output_path.to_string_lossy().to_string();
    let prepared_tracks = prepare_merge_tracks(tracks, output_path)?;
    let args = build_merge_args(
        video_path,
        &prepared_tracks.tracks,
        source_track_configs,
        &streams,
        &temp_output_str,
    )?;

    let mut child = tokio_command(ffmpeg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    let (activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();
    if let Some(stdout) = child.stdout.take() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let activity_tx_for_progress = activity_tx.clone();
        tokio::spawn(async move {
            let mut tracker = FfmpegProgressTracker::new(None);
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if tracker
                    .handle_line(&line)
                    .is_some_and(|update| update.advanced)
                {
                    let _ = activity_tx_for_progress.send(());
                }
            }
        });
    }
    drop(activity_tx);

    let wait_result = wait_with_output_progress_watchdog(
        child,
        "FFmpeg merge",
        activity_rx,
        LONG_FFMPEG_PROGRESS_TIMEOUT,
    )
    .await
    .map_err(|error| {
        remove_partial_merge_output(&temp_output_str);
        error
    });
    drop(prepared_tracks);
    let output = wait_result?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        remove_partial_merge_output(&temp_output_str);
        return Err(format!("FFmpeg merge failed: {}", stderr));
    }

    if !temp_output_path.exists() {
        return Err("FFmpeg merge failed: output file not created".to_string());
    }

    publish_merge_output(&temp_output_path, final_output_path)?;

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
    let probe_json_string = probe_file_with_ffprobe(&ffprobe_path, &video_path).await?;
    let probe_json: Value = serde_json::from_str(&probe_json_string)
        .map_err(|e| format!("Failed to parse probe output: {}", e))?;

    let streams = probe_json
        .get("streams")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();
    let final_output_path = Path::new(&output_path);
    let temp_output_path = merge_neighbor_path(final_output_path, "tmp");
    let temp_output_str = temp_output_path.to_string_lossy().to_string();
    let prepared_tracks = prepare_merge_tracks(&tracks, &output_path)?;

    let args = build_merge_args(
        &video_path,
        &prepared_tracks.tracks,
        source_track_configs.as_deref(),
        &streams,
        &temp_output_str,
    )?;

    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let mut child = tokio_command(ffmpeg_path)
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
        guard.insert(video_path.clone(), temp_output_str.clone());
    }

    let (activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();

    if let Some(stdout) = child.stdout.take() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let app_for_progress = app.clone();
        let video_path_for_progress = video_path.clone();
        let output_path_for_progress = output_path.clone();
        let activity_tx_for_progress = activity_tx.clone();

        tokio::spawn(async move {
            let mut tracker = FfmpegProgressTracker::new(duration_us);
            let mut last_progress = 0;
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(update) = tracker.handle_line(&line) {
                    if update.advanced {
                        let _ = activity_tx_for_progress.send(());
                    }

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
    drop(activity_tx);

    let wait_result = wait_with_output_progress_watchdog(
        child,
        "FFmpeg merge",
        activity_rx,
        LONG_FFMPEG_PROGRESS_TIMEOUT,
    )
    .await
    .map_err(|error| {
        clear_merge_tracking(&video_path);
        remove_partial_merge_output(&temp_output_str);
        error
    });
    drop(prepared_tracks);
    let output = wait_result?;

    clear_merge_tracking(&video_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        remove_partial_merge_output(&temp_output_str);
        return Err(format!("FFmpeg merge failed: {}", stderr));
    }

    if !temp_output_path.exists() {
        return Err("FFmpeg merge failed: output file not created".to_string());
    }

    publish_merge_output(&temp_output_path, final_output_path)?;

    emit_merge_progress(&app, &video_path, &output_path, 100, None);

    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use serde_json::json;

    use super::{
        build_merge_args, enabled_source_indices, merge_tracks_with_bins, publish_merge_output,
    };

    fn has_arg_pair(args: &[String], left: &str, right: &str) -> bool {
        args.windows(2)
            .any(|window| window[0] == left && window[1] == right)
    }

    fn count_arg_pair(args: &[String], left: &str, right: &str) -> usize {
        args.windows(2)
            .filter(|window| window[0] == left && window[1] == right)
            .count()
    }

    fn mock_streams(count: usize) -> Vec<Value> {
        (0..count)
            .map(|index| {
                json!({
                    "index": index,
                    "tags": {
                        "language": "und"
                    },
                    "disposition": {
                        "default": 0,
                        "forced": 0
                    }
                })
            })
            .collect()
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
    fn build_merge_args_skips_data_streams_for_mkv() {
        let source_streams = vec![
            json!({"index": 0, "codec_type": "video", "codec_name": "h264"}),
            json!({"index": 6, "codec_type": "data", "codec_name": "bin_data"}),
        ];
        let source_configs = vec![
            json!({"originalIndex": 0, "config": {"enabled": true}}),
            json!({"originalIndex": 6, "config": {"enabled": true}}),
        ];

        let args = build_merge_args(
            "/tmp/video.mp4",
            &[],
            Some(&source_configs),
            &source_streams,
            "/tmp/out.mkv",
        )
        .expect("data streams should be skipped, not rejected");

        assert!(has_arg_pair(&args, "-map", "0:0"));
        assert!(!has_arg_pair(&args, "-map", "0:6"));
    }

    #[test]
    fn build_merge_args_skips_data_streams_without_source_configs() {
        let source_streams = vec![
            json!({"index": 0, "codec_type": "video", "codec_name": "h264"}),
            json!({"index": 6, "codec_type": "data", "codec_name": "bin_data"}),
        ];

        let args = build_merge_args("/tmp/video.mp4", &[], None, &source_streams, "/tmp/out.mkv")
            .expect("data streams should be skipped, not rejected");

        assert!(has_arg_pair(&args, "-map", "0:0"));
        assert!(!has_arg_pair(&args, "-map", "0:6"));
    }

    #[test]
    fn build_merge_args_disables_ffmpeg_interleave_buffering_for_mkv() {
        let source_streams = vec![json!({
            "index": 0,
            "codec_type": "video",
            "codec_name": "hevc"
        })];

        let args = build_merge_args("/tmp/video.mkv", &[], None, &source_streams, "/tmp/out.mkv")
            .expect("merge arguments should be built");

        assert!(has_arg_pair(&args, "-max_interleave_delta", "0"));
    }

    #[test]
    fn build_merge_args_rejects_mov_text_subtitles_for_mkv() {
        let source_streams = vec![json!({
            "index": 2,
            "codec_type": "subtitle",
            "codec_name": "mov_text"
        })];
        let source_configs = vec![json!({"originalIndex": 2, "config": {"enabled": true}})];

        let error = build_merge_args(
            "/tmp/video.mp4",
            &[],
            Some(&source_configs),
            &source_streams,
            "/tmp/out.mkv",
        )
        .expect_err("mov_text subtitles should be rejected for MKV copy");

        assert_eq!(
            error,
            "MKV merge cannot copy subtitle codec mov_text from source stream #2. Disable this track or convert subtitles with Transcode before merging."
        );
    }

    #[test]
    fn build_merge_args_rejects_mov_text_subtitles_without_source_configs() {
        let source_streams = vec![json!({
            "index": 2,
            "codec_type": "subtitle",
            "codec_name": "tx3g"
        })];

        let error = build_merge_args("/tmp/video.mp4", &[], None, &source_streams, "/tmp/out.mkv")
            .expect_err("tx3g subtitles should be rejected for MKV copy");

        assert_eq!(
            error,
            "MKV merge cannot copy subtitle codec tx3g from source stream #2. Disable this track or convert subtitles with Transcode before merging."
        );
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
    fn publish_merge_output_replaces_existing_output_after_success() {
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("merged.mkv");
        let partial = temp.path().join(".merged.tmp.mkv");
        std::fs::write(&output, b"old").expect("failed to create existing output");
        std::fs::write(&partial, b"new").expect("failed to create temp output");

        publish_merge_output(&partial, &output).expect("publish should succeed");

        assert_eq!(
            std::fs::read(&output).expect("failed to read output"),
            b"new"
        );
        assert!(!partial.exists());
    }

    #[test]
    fn publish_merge_output_restores_existing_output_when_publish_fails() {
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("merged.mkv");
        let missing_partial = temp.path().join(".missing.tmp.mkv");
        std::fs::write(&output, b"old").expect("failed to create existing output");

        let error = publish_merge_output(&missing_partial, &output)
            .expect_err("publish should fail without temp output");

        assert!(error.contains("Failed to publish merge output"));
        assert_eq!(
            std::fs::read(&output).expect("failed to read restored output"),
            b"old"
        );
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

        let source_streams = mock_streams(2);
        let args = build_merge_args(
            "/tmp/video.mkv",
            &tracks,
            None,
            &source_streams,
            "/tmp/out.mkv",
        )
        .expect("merge args should build");

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

        let source_streams = mock_streams(2);
        let args = build_merge_args(
            "/tmp/video.mkv",
            &tracks,
            None,
            &source_streams,
            "/tmp/out.mkv",
        )
        .expect("merge args should build");

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
            &mock_streams(2),
            "/tmp/out.mkv",
        )
        .expect("merge args should build");

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
            &mock_streams(3),
            "/tmp/out.mkv",
        )
        .expect("merge args should build");

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
            &mock_streams(2),
            "/tmp/out.mkv",
        )
        .expect("merge args should build");

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
            &mock_streams(1),
            "/tmp/out.mkv",
        )
        .expect("merge args should build");

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
            crate::test_support::ffmpeg::ffprobe_path(),
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
            crate::test_support::ffmpeg::ffprobe_path(),
            crate::test_support::ffmpeg::ffmpeg_path(),
            video.to_string_lossy().as_ref(),
            &tracks,
            Some(&source_track_configs),
            output.to_string_lossy().as_ref(),
        )
        .await
        .expect("merge should succeed");

        assert!(output.exists());

        let merged_probe = crate::tools::ffprobe::probe::probe_file_with_ffprobe(
            crate::test_support::ffmpeg::ffprobe_path(),
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
    async fn merge_tracks_normalizes_external_ass_codec_private_line_endings() {
        let video = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let subtitle = temp.path().join("sub.ass");
        std::fs::write(
            &subtitle,
            b"[Script Info]\n\
ScriptType: v4.00+\n\
PlayResX: 640\n\
PlayResY: 360\n\n\
[V4+ Styles]\n\
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n\
Style: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,40,1\n\n\
[Events]\n\
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n\
Dialogue: 0,0:00:00.00,0:00:00.50,Default,,0,0,0,,First\n\
Dialogue: 0,0:00:00.60,0:00:01.20,Default,,0,0,0,,Second\n",
        )
        .expect("failed to write ASS subtitle");
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
            crate::test_support::ffmpeg::ffprobe_path(),
            video.to_string_lossy().as_ref(),
        )
        .await
        .expect("probe should succeed");
        let probe_value: Value =
            serde_json::from_str(&probe_json).expect("valid probe json expected");
        let source_track_configs: Vec<Value> = probe_value
            .get("streams")
            .and_then(|value| value.as_array())
            .expect("streams should be an array")
            .iter()
            .filter_map(|stream| {
                let index = stream.get("index")?.as_u64()?;
                let codec_type = stream
                    .get("codec_type")
                    .and_then(|value| value.as_str())
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
            crate::test_support::ffmpeg::ffprobe_path(),
            crate::test_support::ffmpeg::ffmpeg_path(),
            video.to_string_lossy().as_ref(),
            &tracks,
            Some(&source_track_configs),
            output.to_string_lossy().as_ref(),
        )
        .await
        .expect("merge should succeed");

        let probe_output = std::process::Command::new(crate::test_support::ffmpeg::ffprobe_path())
            .args([
                "-v",
                "error",
                "-select_streams",
                "s:0",
                "-show_streams",
                "-show_data",
                "-of",
                "json",
                output.to_string_lossy().as_ref(),
            ])
            .output()
            .expect("ffprobe should run");
        assert!(
            probe_output.status.success(),
            "ffprobe failed: {}",
            String::from_utf8_lossy(&probe_output.stderr)
        );

        let value: Value =
            serde_json::from_slice(&probe_output.stdout).expect("valid stream probe expected");
        let extradata = value
            .get("streams")
            .and_then(|streams| streams.as_array())
            .and_then(|streams| streams.first())
            .and_then(|stream| stream.get("extradata"))
            .and_then(|value| value.as_str())
            .expect("ASS stream should expose codec private data");
        assert!(
            extradata.contains("0d 0a"),
            "ASS codec private data should use CRLF line endings: {extradata}"
        );
    }

    #[tokio::test]
    async fn merge_tracks_applies_delay_to_source_audio_track() {
        let video = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("merged-source-delay.mkv");

        let probe_json = crate::tools::ffprobe::probe::probe_file_with_ffprobe(
            crate::test_support::ffmpeg::ffprobe_path(),
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
            crate::test_support::ffmpeg::ffprobe_path(),
            crate::test_support::ffmpeg::ffmpeg_path(),
            video.to_string_lossy().as_ref(),
            &[],
            Some(&source_track_configs),
            output.to_string_lossy().as_ref(),
        )
        .await
        .expect("merge should succeed");

        let merged_probe = crate::tools::ffprobe::probe::probe_file_with_ffprobe(
            crate::test_support::ffmpeg::ffprobe_path(),
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
