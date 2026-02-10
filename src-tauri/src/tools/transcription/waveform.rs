use std::path::Path;

use crate::shared::hash::md5_hash;
use crate::shared::store::resolve_ffmpeg_path;
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::validation::validate_media_path;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

/// Timeout for audio conversion for waveform (2 minutes)
const AUDIO_CONVERT_TIMEOUT: Duration = Duration::from_secs(120);

/// Convert audio file to a lightweight format for waveform visualization
/// Converts to low-bitrate MP3 for small file size while maintaining playability
/// Returns the path to the converted file in the system temp directory
#[tauri::command]
pub(crate) async fn convert_audio_for_waveform(
    app: tauri::AppHandle,
    audio_path: String,
    track_index: Option<i32>,
) -> Result<String, String> {
    validate_media_path(&audio_path)?;

    let _sleep_guard = SleepInhibitGuard::try_acquire("Waveform conversion").ok();

    let input = Path::new(&audio_path);
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");

    // Use system temp directory for waveform cache
    let temp_dir = std::env::temp_dir().join("rsextractor_waveform");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // Create a unique filename based on the original path hash AND track index
    let track_idx = track_index.unwrap_or(0);
    let cache_key = format!("{}::track{}", audio_path, track_idx);
    let path_hash = format!("{:x}", md5_hash(&cache_key));
    let output_path = temp_dir.join(format!(
        "{}_track{}_{}.mp3",
        stem,
        track_idx,
        &path_hash[..8]
    ));
    let output_str = output_path.to_str().unwrap().to_string();

    // If already converted, return existing file
    if output_path.exists() {
        return Ok(output_str);
    }

    // FFmpeg command to convert to low-bitrate MP3
    let audio_stream = format!("a:{}", track_idx);
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let convert_future = async {
        Command::new(&ffmpeg_path)
            .args([
                "-y",
                "-i",
                &audio_path,
                "-b:a",
                "128k",
                "-ac",
                "1",
                "-map",
                &audio_stream, // Use specified audio stream
                &output_str,
            ])
            .output()
            .await
    };

    let output = timeout(AUDIO_CONVERT_TIMEOUT, convert_future)
        .await
        .map_err(|_| {
            format!(
                "Waveform conversion timeout after {} seconds",
                AUDIO_CONVERT_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("Failed to convert for waveform: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Waveform conversion failed: {}", stderr));
    }

    if !output_path.exists() {
        return Err("Waveform conversion failed: output file not created".to_string());
    }

    Ok(output_str)
}
