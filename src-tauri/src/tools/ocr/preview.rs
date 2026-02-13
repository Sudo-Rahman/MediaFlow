use std::path::Path;

use tauri::Emitter;
use tokio::time::{Duration, timeout};

use crate::shared::hash::md5_hash;
use crate::shared::store::resolve_ffmpeg_path;
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::validation::validate_media_path;
use crate::tools::ffprobe::{get_media_duration_us, get_media_duration_us_with_ffprobe};

/// Timeout for video transcoding for preview (10 minutes)
const VIDEO_PREVIEW_TRANSCODE_TIMEOUT: Duration = Duration::from_secs(600);

/// Transcode video to 480p MP4 for HTML5 preview
/// Uses H.264 video, AAC audio (mono 96kbps)
#[cfg_attr(not(test), allow(dead_code))]
pub(super) async fn transcode_for_preview_with_bins(
    ffmpeg_path: &str,
    ffprobe_path: &str,
    input_path: &str,
) -> Result<String, String> {
    validate_media_path(input_path)?;

    let input = Path::new(input_path);
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let path_hash = format!("{:x}", md5_hash(input_path));

    let temp_dir = std::env::temp_dir().join("mediaflow_preview");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let output_path = temp_dir.join(format!("{}_{}.mp4", stem, &path_hash[..8]));
    let output_str = output_path.to_str().unwrap().to_string();

    if output_path.exists() {
        return Ok(output_str);
    }

    let _duration_us = get_media_duration_us_with_ffprobe(ffprobe_path, input_path)
        .await
        .unwrap_or(0);

    let output_arg = output_str.clone();
    let wait_future = async move {
        tokio::process::Command::new(ffmpeg_path)
            .args([
                "-y",
                "-i",
                input_path,
                "-vf",
                "scale=-2:480",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "28",
                "-c:a",
                "aac",
                "-b:a",
                "96k",
                "-ac",
                "1",
                &output_arg,
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
    };

    let output = timeout(VIDEO_PREVIEW_TRANSCODE_TIMEOUT, wait_future)
        .await
        .map_err(|_| {
            format!(
                "Video transcoding timeout after {} seconds",
                VIDEO_PREVIEW_TRANSCODE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("FFmpeg error: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = std::fs::remove_file(&output_path);
        return Err(format!("Video transcoding failed: {}", stderr));
    }

    if !output_path.exists() {
        return Err("Transcoding failed: output file not created".to_string());
    }

    Ok(output_str)
}

#[tauri::command]
pub(crate) async fn transcode_for_preview(
    app: tauri::AppHandle,
    input_path: String,
    file_id: String,
) -> Result<String, String> {
    validate_media_path(&input_path)?;

    let _sleep_guard = SleepInhibitGuard::try_acquire("Video preview transcoding").ok();

    // Create output path in temp directory
    let input = Path::new(&input_path);
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let path_hash = format!("{:x}", md5_hash(&input_path));

    let temp_dir = std::env::temp_dir().join("mediaflow_preview");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let output_path = temp_dir.join(format!("{}_{}.mp4", stem, &path_hash[..8]));
    let output_str = output_path.to_str().unwrap().to_string();

    // Check if already transcoded
    if output_path.exists() {
        return Ok(output_str);
    }

    // Get duration for progress
    let duration_us = get_media_duration_us(&app, &input_path).await.unwrap_or(0);

    // Emit initial progress
    let _ = app.emit(
        "ocr-progress",
        serde_json::json!({
            "fileId": file_id,
            "phase": "transcoding",
            "current": 0,
            "total": 100,
            "message": "Starting video transcoding..."
        }),
    );

    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let mut child = tokio::process::Command::new(ffmpeg_path)
        .args([
            "-y",
            "-i",
            &input_path,
            "-vf",
            "scale=-2:480",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "28",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-ac",
            "1",
            "-progress",
            "pipe:1",
            &output_str,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    // Store PID for cancellation
    if let Some(pid) = child.id() {
        if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
            guard.insert(file_id.clone(), pid);
        }
    }

    // Store output path for cleanup on cancel/error
    if let Ok(mut guard) = super::state::OCR_TRANSCODE_PATHS.lock() {
        guard.insert(file_id.clone(), output_str.clone());
    }

    // Read stdout for progress
    let stdout = child.stdout.take();
    let app_clone = app.clone();
    let file_id_clone = file_id.clone();

    if let Some(mut stdout) = stdout {
        use tokio::io::AsyncBufReadExt;
        use tokio::io::BufReader;

        tokio::spawn(async move {
            let reader = BufReader::new(&mut stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if line.starts_with("out_time_us=") {
                    if let Ok(time_us) = line.trim_start_matches("out_time_us=").parse::<u64>() {
                        if duration_us > 0 {
                            let progress =
                                ((time_us as f64 / duration_us as f64) * 100.0).min(99.0) as i32;
                            let _ = app_clone.emit(
                                "ocr-progress",
                                serde_json::json!({
                                    "fileId": file_id_clone,
                                    "phase": "transcoding",
                                    "current": progress,
                                    "total": 100,
                                    "message": format!("Transcoding video... {}%", progress)
                                }),
                            );
                        }
                    }
                }
            }
        });
    }

    // Wait for completion
    let file_id_for_cleanup = file_id.clone();
    let output_path_for_cleanup = output_str.clone();
    let output = timeout(VIDEO_PREVIEW_TRANSCODE_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            if let Ok(mut guard) = super::state::OCR_TRANSCODE_PATHS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            // Clean up partial file on timeout
            let _ = std::fs::remove_file(&output_path_for_cleanup);
            format!(
                "Video transcoding timeout after {} seconds",
                VIDEO_PREVIEW_TRANSCODE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| {
            if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            if let Ok(mut guard) = super::state::OCR_TRANSCODE_PATHS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            // Clean up partial file on error
            let _ = std::fs::remove_file(&output_path_for_cleanup);
            format!("FFmpeg error: {}", e)
        })?;

    // Clear PID and path tracking
    if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
        guard.remove(&file_id);
    }
    if let Ok(mut guard) = super::state::OCR_TRANSCODE_PATHS.lock() {
        guard.remove(&file_id);
    }

    // Emit completion
    let _ = app.emit(
        "ocr-progress",
        serde_json::json!({
            "fileId": file_id,
            "phase": "transcoding",
            "current": 100,
            "total": 100,
            "message": "Transcoding complete"
        }),
    );

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Clean up partial file on FFmpeg failure
        let _ = std::fs::remove_file(&output_path);
        return Err(format!("Video transcoding failed: {}", stderr));
    }

    if !output_path.exists() {
        return Err("Transcoding failed: output file not created".to_string());
    }

    Ok(output_str)
}

#[cfg(test)]
mod tests {
    use super::transcode_for_preview_with_bins;

    #[tokio::test]
    async fn transcode_for_preview_creates_mp4_file() {
        let input = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");

        let output = transcode_for_preview_with_bins(
            "ffmpeg",
            "ffprobe",
            input.to_string_lossy().as_ref(),
        )
        .await
        .expect("preview transcode should succeed");

        assert!(std::path::Path::new(&output).exists());
        assert!(output.ends_with(".mp4"));
    }
}
