use std::path::Path;

use tauri::Emitter;
use tokio::time::{Duration, timeout};

use crate::shared::hash::md5_hash;
use crate::shared::store::resolve_ffmpeg_path;
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::validation::validate_media_path;
use crate::tools::ffprobe::{get_media_duration_us, get_media_duration_us_with_ffprobe};
use crate::tools::ocr::OcrRegion;

/// Timeout for frame extraction (30 minutes for long videos)
const FRAME_EXTRACTION_TIMEOUT: Duration = Duration::from_secs(1800);

/// Extract frames from video at specified FPS
/// Returns the number of frames extracted
#[cfg_attr(not(test), allow(dead_code))]
pub(super) async fn extract_ocr_frames_with_bins(
    ffmpeg_path: &str,
    ffprobe_path: &str,
    video_path: &str,
    fps: f64,
    region: Option<OcrRegion>,
) -> Result<(String, u32), String> {
    validate_media_path(video_path)?;

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path_hash = format!("{:x}", md5_hash(&format!("{}::{}", video_path, nonce)));
    let temp_dir = std::env::temp_dir()
        .join("mediaflow_ocr_frames")
        .join(&path_hash[..12]);

    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to clean temp directory: {}", e))?;
    }
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let output_pattern = temp_dir.join("frame_%06d.png");
    let output_pattern_str = output_pattern.to_str().unwrap();

    let _estimated_frames = get_media_duration_us_with_ffprobe(ffprobe_path, video_path)
        .await
        .unwrap_or(0);

    let mut filters = vec![format!("fps={}", fps)];
    if let Some(ref r) = region {
        filters.push(format!(
            "crop=iw*{}:ih*{}:iw*{}:ih*{}",
            r.width, r.height, r.x, r.y
        ));
    }
    let filter_str = filters.join(",");

    let wait_future = async move {
        tokio::process::Command::new(ffmpeg_path)
            .args([
                "-y",
                "-i",
                video_path,
                "-vf",
                &filter_str,
                "-f",
                "image2",
                output_pattern_str,
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
    };

    let output = timeout(FRAME_EXTRACTION_TIMEOUT, wait_future)
        .await
        .map_err(|_| {
            format!(
                "Frame extraction timeout after {} seconds",
                FRAME_EXTRACTION_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("FFmpeg error: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Frame extraction failed: {}", stderr));
    }

    let frame_count = std::fs::read_dir(&temp_dir)
        .map_err(|e| format!("Failed to read frames directory: {}", e))?
        .filter(|entry| {
            entry
                .as_ref()
                .map(|e| {
                    e.path()
                        .extension()
                        .map(|ext| ext == "png")
                        .unwrap_or(false)
                })
                .unwrap_or(false)
        })
        .count() as u32;

    Ok((temp_dir.to_string_lossy().to_string(), frame_count))
}

#[tauri::command]
pub(crate) async fn extract_ocr_frames(
    app: tauri::AppHandle,
    video_path: String,
    file_id: String,
    fps: f64,
    region: Option<OcrRegion>,
) -> Result<(String, u32), String> {
    validate_media_path(&video_path)?;

    let _sleep_guard = SleepInhibitGuard::try_acquire("OCR frame extraction").ok();

    // Create output directory
    let path_hash = format!("{:x}", md5_hash(&video_path));
    let temp_dir = std::env::temp_dir()
        .join("mediaflow_ocr_frames")
        .join(&path_hash[..12]);

    // Clean previous extraction if exists
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to clean temp directory: {}", e))?;
    }
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let output_pattern = temp_dir.join("frame_%06d.png");
    let output_pattern_str = output_pattern.to_str().unwrap();

    // Get video info for frame count estimation
    let duration_us = get_media_duration_us(&app, &video_path).await.unwrap_or(0);
    let estimated_frames = if duration_us > 0 {
        ((duration_us as f64 / 1_000_000.0) * fps) as u32
    } else {
        1000 // Fallback
    };

    // Build filter chain
    let mut filters = vec![format!("fps={}", fps)];

    if let Some(ref r) = region {
        // Crop filter with relative coordinates
        // First scale to get dimensions, then crop
        filters.push(format!(
            "crop=iw*{}:ih*{}:iw*{}:ih*{}",
            r.width, r.height, r.x, r.y
        ));
    }

    let filter_str = filters.join(",");

    // Emit start
    let _ = app.emit(
        "ocr-progress",
        serde_json::json!({
            "fileId": file_id,
            "phase": "extracting",
            "current": 0,
            "total": estimated_frames,
            "message": "Starting frame extraction..."
        }),
    );

    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let mut child = tokio::process::Command::new(ffmpeg_path)
        .args([
            "-y",
            "-i",
            &video_path,
            "-vf",
            &filter_str,
            "-f",
            "image2",
            "-progress",
            "pipe:1",
            output_pattern_str,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    // Store PID
    if let Some(pid) = child.id() {
        if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
            guard.insert(file_id.clone(), pid);
        }
    }

    // Progress tracking
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
                if line.starts_with("frame=") {
                    if let Ok(frame) = line.trim_start_matches("frame=").trim().parse::<u32>() {
                        let _ = app_clone.emit(
                            "ocr-progress",
                            serde_json::json!({
                                "fileId": file_id_clone,
                                "phase": "extracting",
                                "current": frame,
                                "total": estimated_frames,
                                "message": format!("Extracting frame {}...", frame)
                            }),
                        );
                    }
                }
            }
        });
    }

    // Wait for completion
    let file_id_for_cleanup = file_id.clone();
    let output = timeout(FRAME_EXTRACTION_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            format!(
                "Frame extraction timeout after {} seconds",
                FRAME_EXTRACTION_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| {
            if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            format!("FFmpeg error: {}", e)
        })?;

    // Clear PID
    if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
        guard.remove(&file_id);
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Frame extraction failed: {}", stderr));
    }

    // Count extracted frames
    let frame_count = std::fs::read_dir(&temp_dir)
        .map_err(|e| format!("Failed to read frames directory: {}", e))?
        .filter(|entry| {
            entry
                .as_ref()
                .map(|e| {
                    e.path()
                        .extension()
                        .map(|ext| ext == "png")
                        .unwrap_or(false)
                })
                .unwrap_or(false)
        })
        .count() as u32;

    // Emit completion
    let _ = app.emit(
        "ocr-progress",
        serde_json::json!({
            "fileId": file_id,
            "phase": "extracting",
            "current": frame_count,
            "total": frame_count,
            "message": format!("Extracted {} frames", frame_count)
        }),
    );

    Ok((temp_dir.to_string_lossy().to_string(), frame_count))
}

/// Clean up OCR frames directory
#[tauri::command]
pub(crate) async fn cleanup_ocr_frames(frames_dir: String) -> Result<(), String> {
    let path = Path::new(&frames_dir);
    if path.exists() && path.is_dir() {
        std::fs::remove_dir_all(&frames_dir)
            .map_err(|e| format!("Failed to cleanup frames: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{cleanup_ocr_frames, extract_ocr_frames_with_bins};

    #[tokio::test]
    async fn cleanup_ocr_frames_removes_existing_directory() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let frames_dir = dir.path().join("frames");
        std::fs::create_dir_all(&frames_dir).expect("failed to create frames dir");
        std::fs::write(frames_dir.join("frame_000001.png"), b"png").expect("failed to create frame");

        cleanup_ocr_frames(frames_dir.to_string_lossy().to_string())
            .await
            .expect("cleanup should succeed");

        assert!(!frames_dir.exists());
    }

    #[tokio::test]
    async fn extract_ocr_frames_creates_png_sequence() {
        let video = crate::test_support::assets::ensure_ocr_video()
            .await
            .expect("failed to prepare ocr video");

        let (frames_dir, count) = extract_ocr_frames_with_bins(
            "ffmpeg",
            "ffprobe",
            video.to_string_lossy().as_ref(),
            1.0,
            None,
        )
        .await
        .expect("frame extraction should succeed");

        assert!(count > 0);
        assert!(std::path::Path::new(&frames_dir).exists());

        cleanup_ocr_frames(frames_dir)
            .await
            .expect("cleanup should succeed");
    }
}
