use std::path::Path;
use std::process::Stdio;

use tauri::Emitter;
use tokio::time::{Duration, timeout};

use crate::shared::store::resolve_ffmpeg_path;
use crate::shared::validation::{validate_media_path, validate_output_path};
use crate::tools::ffprobe::get_media_duration_us;

/// Timeout for audio transcoding (5 minutes)
const AUDIO_TRANSCODE_TIMEOUT: Duration = Duration::from_secs(300);

/// Transcode audio/video to OPUS format (mono 96kbps)
/// If track_index is provided, extract that specific audio track
/// Otherwise, use the first audio track
#[tauri::command]
pub(crate) async fn transcode_to_opus(
    app: tauri::AppHandle,
    input_path: String,
    output_path: String,
    track_index: Option<u32>,
) -> Result<String, String> {
    validate_media_path(&input_path)?;
    validate_output_path(&output_path)?;

    // Get media duration BEFORE starting FFmpeg for accurate progress
    let duration_us = get_media_duration_us(&app, &input_path).await.unwrap_or(0);

    // Build FFmpeg command
    let map_arg = match track_index {
        Some(idx) => format!("0:a:{}", idx),
        None => "0:a:0".to_string(),
    };

    // Emit initial progress
    let _ = app.emit(
        "transcode-progress",
        serde_json::json!({
            "progress": 0,
            "inputPath": input_path.clone()
        }),
    );

    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let mut child = tokio::process::Command::new(ffmpeg_path)
        .args([
            "-y",
            "-i",
            &input_path,
            "-map",
            &map_arg,
            "-c:a",
            "libopus",
            "-b:a",
            "96k",
            "-ac",
            "1", // Mono
            "-progress",
            "pipe:1", // Progress to stdout
            &output_path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    // Store process ID for cancellation (keyed by input path)
    if let Some(pid) = child.id() {
        if let Ok(mut guard) = super::TRANSCODE_PROCESS_IDS.lock() {
            guard.insert(input_path.clone(), pid);
        }
    }

    // Read stdout for progress
    let stdout = child.stdout.take();
    let app_clone = app.clone();
    let input_path_clone = input_path.clone();

    if let Some(mut stdout) = stdout {
        use tokio::io::AsyncBufReadExt;
        use tokio::io::BufReader;

        tokio::spawn(async move {
            let reader = BufReader::new(&mut stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                // Parse progress from FFmpeg's -progress output
                if line.starts_with("out_time_us=") {
                    if let Ok(time_us) = line.trim_start_matches("out_time_us=").parse::<u64>() {
                        if duration_us > 0 {
                            let progress =
                                ((time_us as f64 / duration_us as f64) * 100.0).min(99.0) as i32;
                            let _ = app_clone.emit(
                                "transcode-progress",
                                serde_json::json!({
                                    "progress": progress,
                                    "inputPath": input_path_clone
                                }),
                            );
                        }
                    }
                }
            }
        });
    }

    // Wait for completion with timeout
    let wait_future = async { child.wait_with_output().await };

    let input_path_for_cleanup = input_path.clone();
    let output = timeout(AUDIO_TRANSCODE_TIMEOUT, wait_future)
        .await
        .map_err(|_| {
            if let Ok(mut guard) = super::TRANSCODE_PROCESS_IDS.lock() {
                guard.remove(&input_path_for_cleanup);
            }
            format!(
                "Transcode timeout after {} seconds",
                AUDIO_TRANSCODE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| {
            if let Ok(mut guard) = super::TRANSCODE_PROCESS_IDS.lock() {
                guard.remove(&input_path_for_cleanup);
            }
            format!("FFmpeg error: {}", e)
        })?;

    // Clear process ID for this file
    if let Ok(mut guard) = super::TRANSCODE_PROCESS_IDS.lock() {
        guard.remove(&input_path);
    }

    // Emit completion
    let _ = app.emit(
        "transcode-progress",
        serde_json::json!({
            "progress": 100,
            "inputPath": input_path
        }),
    );

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Transcode failed: {}", stderr));
    }

    // Verify output exists
    if !Path::new(&output_path).exists() {
        return Err("Transcode failed: output file not created".to_string());
    }

    println!("Transcode finished, {}", output_path);
    Ok(output_path)
}
