use crate::shared::store::{resolve_ffmpeg_path, resolve_ffprobe_path};
use crate::shared::validation::{validate_media_path, validate_output_path};
use crate::tools::ffprobe::FFPROBE_TIMEOUT;
use serde_json::Value;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

/// Timeout for FFmpeg merge operations (10 minutes)
const FFMPEG_MERGE_TIMEOUT: Duration = Duration::from_secs(600);

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

    // Build list of enabled source track indices
    let enabled_source_indices: Vec<usize> = if let Some(ref configs) = source_track_configs {
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
        // If no configs provided, enable all original tracks
        (0..original_stream_count).collect()
    };

    let mut args = vec![
        "-y".to_string(), // Overwrite output
        "-i".to_string(),
        video_path.clone(),
    ];

    // Add input files for each attached track with optional delay
    for track in &tracks {
        if let Some(input_path) = track.get("inputPath").and_then(|v| v.as_str()) {
            // Check for delay
            let delay_ms = track
                .get("config")
                .and_then(|c| c.get("delayMs"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            if delay_ms != 0 {
                // Convert ms to seconds for itsoffset
                let delay_sec = delay_ms as f64 / 1000.0;
                args.push("-itsoffset".to_string());
                args.push(format!("{:.3}", delay_sec));
            }

            args.push("-i".to_string());
            args.push(input_path.to_string());
        }
    }

    // Map selected streams from main video
    for &idx in &enabled_source_indices {
        args.push("-map".to_string());
        args.push(format!("0:{}", idx));
    }

    // Map additional tracks (external files)
    for (i, _track) in tracks.iter().enumerate() {
        let input_idx = i + 1;
        args.push("-map".to_string());
        args.push(format!("{}:0", input_idx));
    }

    // Copy video and audio codecs
    args.push("-c:v".to_string());
    args.push("copy".to_string());
    args.push("-c:a".to_string());
    args.push("copy".to_string());

    // For subtitles, copy ASS/SSA as-is, convert text-based formats to ASS for MKV compatibility
    args.push("-c:s".to_string());
    args.push("copy".to_string());

    // Apply metadata and disposition for enabled source tracks
    if let Some(ref configs) = source_track_configs {
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
                // Language
                if let Some(lang) = cfg.get("language").and_then(|v| v.as_str()) {
                    if !lang.is_empty() {
                        args.push(format!("-metadata:s:{}", output_stream_idx));
                        args.push(format!("language={}", lang));
                    }
                }

                // Title
                if let Some(title) = cfg.get("title").and_then(|v| v.as_str()) {
                    args.push(format!("-metadata:s:{}", output_stream_idx));
                    args.push(format!("title={}", title));
                }

                // Default and forced flags
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

    // Now set metadata and disposition for each added (attached) track
    let attached_start_idx = enabled_source_indices.len();
    for (i, track) in tracks.iter().enumerate() {
        let output_stream_idx = attached_start_idx + i;

        if let Some(config) = track.get("config") {
            // Language
            if let Some(lang) = config.get("language").and_then(|v| v.as_str()) {
                if !lang.is_empty() && lang != "und" {
                    args.push(format!("-metadata:s:{}", output_stream_idx));
                    args.push(format!("language={}", lang));
                }
            }

            // Title
            if let Some(title) = config.get("title").and_then(|v| v.as_str()) {
                if !title.is_empty() {
                    args.push(format!("-metadata:s:{}", output_stream_idx));
                    args.push(format!("title={}", title));
                }
            }

            // Default and forced flags
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

    // Output file
    args.push(output_path.clone());

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
