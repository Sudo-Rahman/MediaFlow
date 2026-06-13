use std::path::Path;
use std::process::Stdio;

use tauri::Emitter;

use crate::shared::ffmpeg_progress::{FfmpegProgressTracker, LONG_FFMPEG_PROGRESS_TIMEOUT};
use crate::shared::process::{tokio_command, wait_with_output_progress_watchdog};
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::store::resolve_ffmpeg_path;
use crate::shared::validation::{validate_media_path, validate_output_path};
use crate::tools::ffprobe::{get_media_duration_us, get_media_duration_us_with_ffprobe};

/// Transcode audio/video to OPUS format (mono 96kbps)
/// If track_index is provided, extract that specific audio track
/// Otherwise, use the first audio track
#[cfg_attr(not(test), allow(dead_code))]
pub(super) async fn transcode_to_opus_with_bins(
    ffmpeg_path: &str,
    ffprobe_path: &str,
    input_path: &str,
    output_path: &str,
    track_index: Option<u32>,
) -> Result<String, String> {
    validate_media_path(input_path)?;
    validate_output_path(output_path)?;

    let duration_us = get_media_duration_us_with_ffprobe(ffprobe_path, input_path)
        .await
        .unwrap_or(0);

    let map_arg = match track_index {
        Some(idx) => format!("0:a:{}", idx),
        None => "0:a:0".to_string(),
    };

    let mut child = tokio_command(ffmpeg_path)
        .args([
            "-y",
            "-i",
            input_path,
            "-map",
            &map_arg,
            "-c:a",
            "libopus",
            "-b:a",
            "96k",
            "-ac",
            "1",
            "-progress",
            "pipe:1",
            output_path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    let (activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();
    if let Some(stdout) = child.stdout.take() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let activity_tx_for_progress = activity_tx.clone();
        tokio::spawn(async move {
            let mut tracker = FfmpegProgressTracker::new((duration_us > 0).then_some(duration_us));
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

    let output = wait_with_output_progress_watchdog(
        child,
        "Audio transcode",
        activity_rx,
        LONG_FFMPEG_PROGRESS_TIMEOUT,
    )
    .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Transcode failed: {}", stderr));
    }

    if !Path::new(output_path).exists() {
        return Err("Transcode failed: output file not created".to_string());
    }

    Ok(output_path.to_string())
}

#[tauri::command]
pub(crate) async fn transcode_to_opus(
    app: tauri::AppHandle,
    input_path: String,
    output_path: String,
    track_index: Option<u32>,
) -> Result<String, String> {
    validate_media_path(&input_path)?;
    validate_output_path(&output_path)?;

    let _sleep_guard = SleepInhibitGuard::try_acquire("Audio transcoding").ok();

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
    let mut child = tokio_command(ffmpeg_path)
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

    let (activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();

    if let Some(mut stdout) = stdout {
        use tokio::io::AsyncBufReadExt;
        use tokio::io::BufReader;

        let activity_tx_for_progress = activity_tx.clone();
        tokio::spawn(async move {
            let mut tracker = FfmpegProgressTracker::new((duration_us > 0).then_some(duration_us));
            let reader = BufReader::new(&mut stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(update) = tracker.handle_line(&line) {
                    if update.advanced {
                        let _ = activity_tx_for_progress.send(());
                    }

                    if let Some(progress) = update.progress {
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
        });
    }

    drop(activity_tx);

    let input_path_for_cleanup = input_path.clone();
    let output = wait_with_output_progress_watchdog(
        child,
        "Audio transcode",
        activity_rx,
        LONG_FFMPEG_PROGRESS_TIMEOUT,
    )
    .await
    .map_err(|error| {
        if let Ok(mut guard) = super::TRANSCODE_PROCESS_IDS.lock() {
            guard.remove(&input_path_for_cleanup);
        }
        error
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

#[cfg(test)]
mod tests {
    use super::transcode_to_opus_with_bins;

    #[tokio::test]
    async fn transcode_to_opus_generates_output_file() {
        let input = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("audio.opus");

        let result_path = transcode_to_opus_with_bins(
            crate::test_support::ffmpeg::ffmpeg_path(),
            crate::test_support::ffmpeg::ffprobe_path(),
            input.to_string_lossy().as_ref(),
            output.to_string_lossy().as_ref(),
            Some(0),
        )
        .await
        .expect("transcode should succeed");

        assert_eq!(result_path, output.to_string_lossy().to_string());
        assert!(output.exists());
    }
}
