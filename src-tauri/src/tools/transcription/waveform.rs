use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::shared::ffmpeg_progress::{FfmpegProgressTracker, LONG_FFMPEG_PROGRESS_TIMEOUT};
use crate::shared::hash::stable_hash64;
use crate::shared::process::{tokio_command, wait_with_output_progress_watchdog};
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::store::resolve_ffmpeg_path;
use crate::shared::validation::validate_media_path;

fn waveform_temp_output_path(output_path: &Path) -> PathBuf {
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = output_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("waveform");
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);

    parent.join(format!(
        ".{}.{}.{}.tmp.mp3",
        stem,
        std::process::id(),
        unique
    ))
}

/// Convert audio file to a lightweight format for waveform visualization
/// Converts to low-bitrate MP3 for small file size while maintaining playability
/// Returns the path to the converted file in the system temp directory
pub(super) async fn convert_audio_for_waveform_with_ffmpeg(
    ffmpeg_path: &str,
    audio_path: &str,
    track_index: Option<i32>,
) -> Result<String, String> {
    validate_media_path(audio_path)?;

    let input = Path::new(audio_path);
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");

    let temp_dir = std::env::temp_dir().join("mediaflow_waveform");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let track_idx = track_index.unwrap_or(0);
    let cache_key = format!("{}::track{}", audio_path, track_idx);
    let path_hash = format!("{:x}", stable_hash64(&cache_key));
    let output_path = temp_dir.join(format!(
        "{}_track{}_{}.mp3",
        stem,
        track_idx,
        &path_hash[..8]
    ));
    let output_str = output_path.to_str().unwrap().to_string();

    if output_path.exists() {
        return Ok(output_str);
    }

    let temp_output_path = waveform_temp_output_path(&output_path);
    let temp_output_str = temp_output_path.to_string_lossy().to_string();
    let audio_stream = format!("a:{}", track_idx);
    let mut child = tokio_command(ffmpeg_path)
        .args([
            "-y",
            "-i",
            audio_path,
            "-b:a",
            "128k",
            "-ac",
            "1",
            "-map",
            &audio_stream,
            "-progress",
            "pipe:1",
            &temp_output_str,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to convert for waveform: {}", e))?;

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

    let output = wait_with_output_progress_watchdog(
        child,
        "Waveform conversion",
        activity_rx,
        LONG_FFMPEG_PROGRESS_TIMEOUT,
    )
    .await
    .map_err(|error| {
        let _ = std::fs::remove_file(&temp_output_path);
        error
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = std::fs::remove_file(&temp_output_path);
        return Err(format!("Waveform conversion failed: {}", stderr));
    }

    if !temp_output_path.exists() {
        return Err("Waveform conversion failed: output file not created".to_string());
    }

    let _ = std::fs::remove_file(&output_path);
    std::fs::rename(&temp_output_path, &output_path)
        .map_err(|e| format!("Failed to publish waveform audio: {}", e))?;

    Ok(output_str)
}

#[tauri::command]
pub(crate) async fn convert_audio_for_waveform(
    app: tauri::AppHandle,
    audio_path: String,
    track_index: Option<i32>,
) -> Result<String, String> {
    let _sleep_guard = SleepInhibitGuard::try_acquire("Waveform conversion").ok();
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    convert_audio_for_waveform_with_ffmpeg(&ffmpeg_path, &audio_path, track_index).await
}

#[cfg(test)]
mod tests {
    use super::convert_audio_for_waveform_with_ffmpeg;

    #[tokio::test]
    async fn convert_audio_for_waveform_returns_existing_or_new_mp3_path() {
        let input = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");

        let output = convert_audio_for_waveform_with_ffmpeg(
            crate::test_support::ffmpeg::ffmpeg_path(),
            input.to_string_lossy().as_ref(),
            Some(0),
        )
        .await
        .expect("waveform conversion should succeed");

        assert!(std::path::Path::new(&output).exists());
        assert!(output.ends_with(".mp3"));
    }
}
