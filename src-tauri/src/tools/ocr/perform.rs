use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::path::Path;

use rayon::prelude::*;
use tauri::Emitter;

use crate::shared::validation::validate_directory_path;
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::tools::ocr::OcrFrameResult;

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn perform_ocr_core(
    frames_dir: &str,
    models_dir: &Path,
    language: &str,
    fps: f64,
    use_gpu: bool,
    num_workers: u32,
) -> Result<Vec<OcrFrameResult>, String> {
    validate_directory_path(frames_dir)?;
    if fps <= 0.0 {
        return Err("FPS must be greater than 0".to_string());
    }

    let mut frames: Vec<_> = std::fs::read_dir(frames_dir)
        .map_err(|e| format!("Failed to read frames directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|ext| ext == "png")
                .unwrap_or(false)
        })
        .collect();
    frames.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    if frames.is_empty() {
        return Ok(Vec::new());
    }

    let frame_data: Vec<(u32, std::path::PathBuf)> = frames
        .iter()
        .enumerate()
        .map(|(i, f)| (i as u32, f.path()))
        .collect();

    let workers = std::cmp::max(1, num_workers) as usize;
    let chunk_size = frame_data.len().div_ceil(workers);
    let chunks: Vec<Vec<(u32, std::path::PathBuf)>> =
        frame_data.chunks(chunk_size).map(|c| c.to_vec()).collect();

    let frame_duration_ms = 1000.0 / fps;

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(chunks.len())
        .build()
        .map_err(|e| format!("Failed to create thread pool: {}", e))?;

    let all_results: Result<Vec<Vec<OcrFrameResult>>, String> = pool.install(|| {
        chunks
            .into_par_iter()
            .map(|chunk_paths| {
                let engine = super::engine::create_ocr_engine(models_dir, language, use_gpu)?;
                let mut worker_results = Vec::with_capacity(chunk_paths.len());

                for (frame_index, frame_path) in chunk_paths {
                    let time_ms = ((frame_index as f64) * frame_duration_ms).round() as u64;

                    let image = match image::open(&frame_path) {
                        Ok(img) => img,
                        Err(_) => continue,
                    };

                    let ocr_results = match engine.recognize(&image) {
                        Ok(results) => results,
                        Err(_) => continue,
                    };

                    let mut sorted_results: Vec<_> = ocr_results.iter().collect();
                    sorted_results.sort_by(|a, b| {
                        let a_top = a.bbox.rect.top();
                        let b_top = b.bbox.rect.top();
                        a_top.partial_cmp(&b_top).unwrap_or(std::cmp::Ordering::Equal)
                    });

                    let combined_text: String = sorted_results
                        .iter()
                        .map(|r| r.text.trim())
                        .filter(|t| !t.is_empty())
                        .collect::<Vec<_>>()
                        .join(" ");

                    let avg_confidence = if sorted_results.is_empty() {
                        0.0
                    } else {
                        sorted_results.iter().map(|r| r.confidence).sum::<f32>() as f64
                            / sorted_results.len() as f64
                    };

                    worker_results.push(OcrFrameResult {
                        frame_index,
                        time_ms,
                        text: combined_text,
                        confidence: avg_confidence,
                    });
                }

                Ok(worker_results)
            })
            .collect()
    });

    let mut results: Vec<OcrFrameResult> = all_results?.into_iter().flatten().collect();
    results.sort_by_key(|r| r.frame_index);
    Ok(results)
}

/// Perform OCR on extracted frames using PP-OCRv5 with rayon parallel processing
/// Each parallel worker creates its own OcrEngine instance for thread-safety
#[tauri::command]
pub(crate) async fn perform_ocr(
    app: tauri::AppHandle,
    frames_dir: String,
    file_id: String,
    language: String,
    fps: f64,
    use_gpu: bool,
    num_workers: u32,
) -> Result<Vec<OcrFrameResult>, String> {
    validate_directory_path(&frames_dir)?;

    if fps <= 0.0 {
        return Err("FPS must be greater than 0".to_string());
    }

    let _sleep_guard = SleepInhibitGuard::try_acquire("OCR processing").ok();

    // Register this OCR operation for cancellation support
    if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
        guard.insert(file_id.clone(), 0);
    }

    // Helper to cleanup on exit
    let file_id_cleanup = file_id.clone();
    let cleanup = || {
        if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
            guard.remove(&file_id_cleanup);
        }
    };

    // Get OCR models directory
    let models_dir = super::engine::get_ocr_models_dir(&app)?;

    // Get list of frame files
    let mut frames: Vec<_> = std::fs::read_dir(&frames_dir)
        .map_err(|e| format!("Failed to read frames directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|ext| ext == "png")
                .unwrap_or(false)
        })
        .collect();

    // Sort by filename
    frames.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    let total_frames = frames.len() as u32;

    if total_frames == 0 {
        cleanup();
        return Ok(Vec::new());
    }

    let num_workers = std::cmp::max(1, num_workers) as usize;

    // Emit start - initializing workers
    let _ = app.emit(
        "ocr-progress",
        serde_json::json!({
            "fileId": file_id,
            "phase": "ocr",
            "current": 0,
            "total": total_frames,
            "message": format!("Starting OCR with {} parallel workers...", num_workers)
        }),
    );

    // Collect frame paths with their original indices
    let frame_data: Vec<(u32, std::path::PathBuf)> = frames
        .iter()
        .enumerate()
        .map(|(i, f)| (i as u32, f.path()))
        .collect();

    // Divide frames into chunks for parallel workers
    let chunk_size = (frame_data.len() + num_workers - 1) / num_workers;
    let chunks: Vec<Vec<(u32, std::path::PathBuf)>> =
        frame_data.chunks(chunk_size).map(|c| c.to_vec()).collect();

    // Shared progress counter for smooth progress updates
    let progress_counter = Arc::new(AtomicU32::new(0));

    // Clone values for the blocking task
    let models_dir_clone = models_dir.clone();
    let language_clone = language.clone();
    let file_id_clone = file_id.clone();
    let app_clone = app.clone();
    let progress_counter_clone = Arc::clone(&progress_counter);

    let frame_duration_ms = 1000.0 / fps;

    // Run parallel OCR in a blocking task
    let results = tokio::task::spawn_blocking(move || {
        // Configure rayon thread pool for this operation
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(chunks.len())
            .build()
            .map_err(|e| format!("Failed to create thread pool: {}", e))?;

        pool.install(|| {
            // Process chunks in parallel - each worker creates its own engine
            let all_results: Result<Vec<Vec<OcrFrameResult>>, String> = chunks
                .into_par_iter()
                .map(|chunk_paths| {
                    // Check for cancellation before starting this worker
                    let is_cancelled = super::state::OCR_PROCESS_IDS
                        .lock()
                        .map(|guard| !guard.contains_key(&file_id_clone))
                        .unwrap_or(false);

                    if is_cancelled {
                        return Err("OCR cancelled".to_string());
                    }

                    // Create engine for this worker (each worker has its own engine)
                    let engine = super::engine::create_ocr_engine(
                        &models_dir_clone,
                        &language_clone,
                        use_gpu,
                    )?;

                    let mut worker_results = Vec::with_capacity(chunk_paths.len());

                    for (frame_index, frame_path) in chunk_paths {
                        // Check for cancellation periodically
                        let is_cancelled = super::state::OCR_PROCESS_IDS
                            .lock()
                            .map(|guard| !guard.contains_key(&file_id_clone))
                            .unwrap_or(false);

                        if is_cancelled {
                            return Err("OCR cancelled".to_string());
                        }

                        let time_ms = ((frame_index as f64) * frame_duration_ms).round() as u64;

                        // Load the image
                        let image = match image::open(&frame_path) {
                            Ok(img) => img,
                            Err(e) => {
                                eprintln!("Failed to open frame {}: {}", frame_path.display(), e);
                                // Update progress even for failed frames
                                let current =
                                    progress_counter_clone.fetch_add(1, Ordering::Relaxed) + 1;
                                let _ = app_clone.emit(
                                    "ocr-progress",
                                    serde_json::json!({
                                        "fileId": file_id_clone,
                                        "phase": "ocr",
                                        "current": current,
                                        "total": total_frames,
                                        "message": format!("Processing frame {}/{}...", current, total_frames)
                                    }),
                                );
                                continue;
                            }
                        };

                        // Run OCR detection and recognition
                        let ocr_results = match engine.recognize(&image) {
                            Ok(results) => results,
                            Err(e) => {
                                eprintln!("OCR failed on frame {}: {}", frame_path.display(), e);
                                // Update progress even for failed frames
                                let current =
                                    progress_counter_clone.fetch_add(1, Ordering::Relaxed) + 1;
                                let _ = app_clone.emit(
                                    "ocr-progress",
                                    serde_json::json!({
                                        "fileId": file_id_clone,
                                        "phase": "ocr",
                                        "current": current,
                                        "total": total_frames,
                                        "message": format!("Processing frame {}/{}...", current, total_frames)
                                    }),
                                );
                                continue;
                            }
                        };

                        // Sort results by vertical position (top to bottom) for subtitle ordering
                        let mut sorted_results: Vec<_> = ocr_results.iter().collect();
                        sorted_results.sort_by(|a, b| {
                            let a_top = a.bbox.rect.top();
                            let b_top = b.bbox.rect.top();
                            a_top.partial_cmp(&b_top).unwrap_or(std::cmp::Ordering::Equal)
                        });

                        // Combine text from all detected regions
                        let combined_text: String = sorted_results
                            .iter()
                            .map(|r| r.text.trim())
                            .filter(|t| !t.is_empty())
                            .collect::<Vec<_>>()
                            .join(" ");

                        // Calculate average confidence
                        let avg_confidence = if sorted_results.is_empty() {
                            0.0
                        } else {
                            sorted_results.iter().map(|r| r.confidence).sum::<f32>() as f64
                                / sorted_results.len() as f64
                        };

                        worker_results.push(OcrFrameResult {
                            frame_index,
                            time_ms,
                            text: combined_text,
                            confidence: avg_confidence,
                        });

                        // Emit progress for each frame (smooth progress bar)
                        let current = progress_counter_clone.fetch_add(1, Ordering::Relaxed) + 1;
                        let _ = app_clone.emit(
                            "ocr-progress",
                            serde_json::json!({
                                "fileId": file_id_clone,
                                "phase": "ocr",
                                "current": current,
                                "total": total_frames,
                                "message": format!("Processing frame {}/{}...", current, total_frames)
                            }),
                        );
                    }

                    Ok(worker_results)
                })
                .collect();

            // Flatten results and sort by frame index
            all_results.map(|chunk_results| {
                let mut results: Vec<OcrFrameResult> =
                    chunk_results.into_iter().flatten().collect();
                results.sort_by_key(|r| r.frame_index);
                results
            })
        })
    })
    .await
    .map_err(|e| {
        cleanup();
        format!("OCR task failed: {}", e)
    })??;

    // Emit completion
    let _ = app.emit(
        "ocr-progress",
        serde_json::json!({
            "fileId": file_id,
            "phase": "ocr",
            "current": total_frames,
            "total": total_frames,
            "message": "OCR processing complete"
        }),
    );

    // Clean up cancellation tracking
    cleanup();

    Ok(results)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::path::PathBuf;

    use crate::tools::ocr::OcrFrameResult;
    use crate::tools::ocr::OcrSubtitleCleanupOptions;

    use super::perform_ocr_core;

    fn ensure_minimal_models() -> Result<PathBuf, String> {
        let models_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("ocr-models");
        for file in [
            "PP-OCRv5_mobile_det.mnn",
            "PP-OCRv5_mobile_rec.mnn",
            "ppocr_keys_v5.txt",
        ] {
            let path = models_dir.join(file);
            if !path.exists() {
                return Err(format!("Missing OCR model file: {}", path.display()));
            }
        }
        Ok(models_dir)
    }

    fn normalized_words(text: &str) -> Vec<String> {
        text.chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_uppercase()
                } else {
                    ' '
                }
            })
            .collect::<String>()
            .split_whitespace()
            .map(|w| w.to_string())
            .collect()
    }

    fn assert_contains_expected_ocr_words(results: &[OcrFrameResult], expected: &str) {
        let mut observed = HashSet::new();
        for result in results {
            for word in normalized_words(&result.text) {
                observed.insert(word);
            }
        }

        let expected_words = normalized_words(expected);
        for word in expected_words {
            assert!(
                observed.contains(&word),
                "expected OCR output to contain word '{}', observed words: {:?}",
                word,
                observed
            );
        }
    }

    #[tokio::test]
    async fn perform_ocr_returns_results_for_extracted_frames() {
        let models_dir = ensure_minimal_models().expect("failed to validate models");

        let video = crate::test_support::assets::ensure_ocr_video()
            .await
            .expect("failed to prepare ocr video");
        let (frames_dir, frame_count) = crate::tools::ocr::frames::extract_ocr_frames_with_bins(
            "ffmpeg",
            "ffprobe",
            video.to_string_lossy().as_ref(),
            1.0,
            None,
        )
        .await
        .expect("failed to extract frames");
        assert!(frame_count > 0);

        let results = perform_ocr_core(
            &frames_dir,
            &models_dir,
            "multi",
            1.0,
            false,
            1,
        )
        .expect("perform_ocr should succeed");

        assert!(!results.is_empty());
        assert_contains_expected_ocr_words(&results, "HELLO OCR TEST");

        crate::tools::ocr::frames::cleanup_ocr_frames(frames_dir)
            .await
            .expect("cleanup frames should succeed");
    }

    #[tokio::test]
    async fn ocr_pipeline_generates_and_exports_subtitles() {
        let models_dir = ensure_minimal_models().expect("failed to validate models");

        let video = crate::test_support::assets::ensure_ocr_video()
            .await
            .expect("failed to prepare ocr video");
        let (frames_dir, _frame_count) = crate::tools::ocr::frames::extract_ocr_frames_with_bins(
            "ffmpeg",
            "ffprobe",
            video.to_string_lossy().as_ref(),
            1.0,
            None,
        )
        .await
        .expect("failed to extract frames");

        let ocr_results = perform_ocr_core(
            &frames_dir,
            &models_dir,
            "multi",
            1.0,
            false,
            1,
        )
        .expect("perform_ocr should succeed");

        let subtitles = crate::tools::ocr::subtitles::generate_subtitles_core(
            &ocr_results,
            1.0,
            0.1,
            OcrSubtitleCleanupOptions::default(),
            |_current, _total| {},
        )
        .expect("subtitle generation should succeed");
        assert!(!subtitles.is_empty());
        let subtitle_results: Vec<OcrFrameResult> = subtitles
            .iter()
            .enumerate()
            .map(|(idx, subtitle)| OcrFrameResult {
                frame_index: idx as u32,
                time_ms: subtitle.start_time,
                text: subtitle.text.clone(),
                confidence: subtitle.confidence,
            })
            .collect();
        assert_contains_expected_ocr_words(&subtitle_results, "HELLO OCR TEST");

        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("ocr_pipeline.srt");
        crate::tools::ocr::export::export_ocr_subtitles(
            subtitles,
            output.to_string_lossy().to_string(),
            "srt".to_string(),
        )
        .await
        .expect("subtitle export should succeed");

        assert!(output.exists());

        crate::tools::ocr::frames::cleanup_ocr_frames(frames_dir)
            .await
            .expect("cleanup frames should succeed");
    }
}
