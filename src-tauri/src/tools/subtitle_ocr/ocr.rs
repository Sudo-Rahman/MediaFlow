use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU32, Ordering},
};
use std::thread::{self, JoinHandle};

use image::{DynamicImage, RgbaImage};
use tauri::Emitter;

use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::tools::ocr::{create_ocr_engine, get_ocr_models_dir, resolve_ocr_engine_threads};
use crate::tools::subtitle_ocr::assets::write_decoded_bitmap_assets;
use crate::tools::subtitle_ocr::decode::{
    BitmapSubtitleSource, DecodedBitmapCue, count_bitmap_subtitle_source_with_stop,
    decode_bitmap_subtitle_source_with_handler, validate_bitmap_subtitle_source,
};
use crate::tools::subtitle_ocr::progress::{ProgressTotal, SubtitleOcrProgressEmitter};
use crate::tools::subtitle_ocr::stabilize::stabilize_cues;
use crate::tools::subtitle_ocr::text::reconstruct_text_from_boxes;
use crate::tools::subtitle_ocr::{
    SubtitleOcrBox, SubtitleOcrCue, SubtitleOcrLiveCueEvent, SubtitleOcrPipelineResult,
    SubtitleOcrRawCue,
};

#[derive(Clone)]
struct PipelineProgress {
    ocr: SubtitleOcrProgressEmitter,
    ai_cleaning: SubtitleOcrProgressEmitter,
}

#[tauri::command]
pub(crate) async fn run_subtitle_ocr_pipeline(
    app: tauri::AppHandle,
    item_id: String,
    run_id: String,
    source_path: String,
    idx_path: Option<String>,
    sub_path: Option<String>,
    language: String,
    use_gpu: bool,
    expected_bitmap_count: Option<u32>,
) -> Result<SubtitleOcrPipelineResult, String> {
    if item_id.trim().is_empty() {
        return Err("Subtitle OCR item id is required".to_string());
    }
    if run_id.trim().is_empty() {
        return Err("Subtitle OCR run id is required".to_string());
    }

    let _sleep_guard = SleepInhibitGuard::try_acquire("Running Subtitle OCR pipeline").ok();
    let source =
        validate_bitmap_subtitle_source(&source_path, idx_path.as_deref(), sub_path.as_deref())?;
    let models_dir = get_ocr_models_dir(&app)?;
    super::state::begin_operation(&item_id, &run_id)?;

    let item_id_for_task = item_id.clone();
    let run_id_for_task = run_id.clone();
    let task = tokio::task::spawn_blocking(move || {
        run_subtitle_ocr_pipeline_blocking(
            &item_id_for_task,
            &run_id_for_task,
            &source,
            app,
            models_dir,
            &language,
            use_gpu,
            expected_bitmap_count,
        )
    });

    let join_result = task.await;
    let _ = super::state::clear_registered_operation(&item_id, &run_id);
    let result = join_result.map_err(|e| format!("Subtitle OCR pipeline task failed: {}", e))?;
    if result.is_ok() {
        let _ = super::state::clear_cancelled(&item_id, &run_id);
    }

    result
}

fn run_subtitle_ocr_pipeline_blocking(
    item_id: &str,
    run_id: &str,
    source: &super::decode::BitmapSubtitleSource,
    app: tauri::AppHandle,
    models_dir: PathBuf,
    language: &str,
    use_gpu: bool,
    expected_bitmap_count: Option<u32>,
) -> Result<SubtitleOcrPipelineResult, String> {
    ensure_not_cancelled(item_id, run_id)?;
    let live_event_app = app.clone();
    let progress = PipelineProgress {
        ocr: SubtitleOcrProgressEmitter::new(
            app.clone(),
            item_id.to_string(),
            run_id.to_string(),
            "ocr",
            initial_bitmap_total(expected_bitmap_count),
        ),
        ai_cleaning: SubtitleOcrProgressEmitter::new(
            app,
            item_id.to_string(),
            run_id.to_string(),
            "ai_cleaning",
            1,
        ),
    };
    let processed_count = Arc::new(AtomicU32::new(0));
    let mut background_count = start_background_bitmap_count(
        should_start_background_count(expected_bitmap_count),
        source,
        item_id,
        run_id,
        progress.ocr.clone(),
        Arc::clone(&processed_count),
    );

    let engine_threads = resolve_ocr_engine_threads(1);
    let engine = create_ocr_engine(&models_dir, language, use_gpu, engine_threads, true)?;
    progress.ocr.emit_force(0);

    let mut decoded_metadata = Vec::new();
    let mut raw_ocr_cues = Vec::new();
    let mut final_candidates = Vec::new();
    let mut decoded_count = 0u32;
    decode_bitmap_subtitle_source_with_handler(source, item_id, run_id, |mut decoded| {
        ensure_not_cancelled(item_id, run_id)?;
        decoded_count = decoded_count.saturating_add(1);
        processed_count.store(decoded_count, Ordering::Relaxed);
        let bitmap_assets =
            write_decoded_bitmap_assets(item_id, run_id, &decoded.metadata, &decoded.rgba)?;
        decoded.metadata.preview_path = Some(bitmap_assets.preview_path);
        let metadata = decoded.metadata.clone();
        let raw_cue = ocr_decoded_bitmap(&engine, decoded)?;
        let provisional_cue = provisional_cue_from_raw(&raw_cue);
        emit_live_cue_event(
            &live_event_app,
            item_id,
            run_id,
            &metadata,
            &raw_cue,
            &provisional_cue,
        );
        if !raw_cue.text.trim().is_empty() {
            final_candidates.push(provisional_cue);
        }
        decoded_metadata.push(metadata);
        raw_ocr_cues.push(raw_cue);
        progress.ocr.emit(decoded_count);
        Ok(())
    })?;

    stop_background_bitmap_count(&mut background_count);
    progress
        .ocr
        .emit_force_with_total(decoded_count, decoded_count);

    ensure_not_cancelled(item_id, run_id)?;
    if decoded_count == 0 {
        progress.ai_cleaning.emit_force(1);
        return Ok(empty_subtitle_ocr_pipeline_result());
    }

    progress.ai_cleaning.emit_force(0);
    let stabilized_cues = stabilize_cues(&final_candidates);
    let final_cues = build_final_subtitle_ocr_cues(&raw_ocr_cues, stabilized_cues.clone());
    progress.ai_cleaning.emit_force(1);

    Ok(SubtitleOcrPipelineResult {
        decoded_cues: decoded_metadata,
        raw_ocr_cues,
        final_cues,
        stabilized_cues,
    })
}

struct BackgroundBitmapCountTask {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Drop for BackgroundBitmapCountTask {
    fn drop(&mut self) {
        self.stop();
    }
}

impl BackgroundBitmapCountTask {
    fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn stop_background_bitmap_count(background_count: &mut Option<BackgroundBitmapCountTask>) {
    if let Some(mut task) = background_count.take() {
        task.stop();
    }
}

fn start_background_bitmap_count(
    enabled: bool,
    source: &BitmapSubtitleSource,
    item_id: &str,
    run_id: &str,
    progress: SubtitleOcrProgressEmitter,
    processed_count: Arc<AtomicU32>,
) -> Option<BackgroundBitmapCountTask> {
    if !enabled {
        return None;
    }

    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let source = source.clone();
    let item_id = item_id.to_string();
    let run_id = run_id.to_string();
    let handle = thread::spawn(move || {
        let count = count_bitmap_subtitle_source_with_stop(&source, &item_id, &run_id, || {
            thread_stop.load(Ordering::Relaxed)
        });
        if thread_stop.load(Ordering::Relaxed)
            || super::state::is_operation_cancelled(&item_id, &run_id)
        {
            return;
        }

        if let Ok(total) = count {
            let current = processed_count.load(Ordering::Relaxed);
            if thread_stop.load(Ordering::Relaxed)
                || super::state::is_operation_cancelled(&item_id, &run_id)
            {
                return;
            }

            progress.emit_force_with_total(current, total);
        }
    });

    Some(BackgroundBitmapCountTask {
        stop,
        handle: Some(handle),
    })
}

fn empty_subtitle_ocr_pipeline_result() -> SubtitleOcrPipelineResult {
    SubtitleOcrPipelineResult {
        decoded_cues: Vec::new(),
        raw_ocr_cues: Vec::new(),
        final_cues: Vec::new(),
        stabilized_cues: Vec::new(),
    }
}

fn initial_bitmap_total(expected_bitmap_count: Option<u32>) -> ProgressTotal {
    expected_bitmap_count
        .filter(|count| *count > 0)
        .map(ProgressTotal::Known)
        .unwrap_or(ProgressTotal::Unknown)
}

fn should_start_background_count(expected_bitmap_count: Option<u32>) -> bool {
    expected_bitmap_count.unwrap_or(0) == 0
}

fn build_final_subtitle_ocr_cues(
    raw_ocr_cues: &[SubtitleOcrRawCue],
    stabilized_cues: Vec<SubtitleOcrCue>,
) -> Vec<SubtitleOcrCue> {
    if raw_ocr_cues.is_empty() {
        return stabilized_cues;
    }

    let mut stabilized_index_by_source = HashMap::new();
    for (index, cue) in stabilized_cues.iter().enumerate() {
        for source_cue_id in &cue.source_cue_ids {
            stabilized_index_by_source.insert(source_cue_id.as_str(), index);
        }
    }

    let mut emitted_stabilized_cues = vec![false; stabilized_cues.len()];
    let mut final_cues = Vec::with_capacity(raw_ocr_cues.len().max(stabilized_cues.len()));
    for raw_cue in raw_ocr_cues {
        if let Some(index) = stabilized_index_by_source.get(raw_cue.cue_id.as_str()) {
            if !emitted_stabilized_cues[*index] {
                final_cues.push(stabilized_cues[*index].clone());
                emitted_stabilized_cues[*index] = true;
            }
            continue;
        }

        final_cues.push(blank_final_cue_from_raw(raw_cue));
    }

    for (index, cue) in stabilized_cues.into_iter().enumerate() {
        if !emitted_stabilized_cues[index] {
            final_cues.push(cue);
        }
    }

    final_cues
}

fn blank_final_cue_from_raw(raw_cue: &SubtitleOcrRawCue) -> SubtitleOcrCue {
    SubtitleOcrCue {
        id: raw_cue.cue_id.clone(),
        source_cue_ids: vec![raw_cue.cue_id.clone()],
        start_time_ms: raw_cue.start_time_ms,
        end_time_ms: raw_cue.end_time_ms,
        text: String::new(),
        confidence: raw_cue.confidence,
    }
}

fn ensure_not_cancelled(item_id: &str, run_id: &str) -> Result<(), String> {
    if super::state::is_operation_cancelled(item_id, run_id) {
        Err("Subtitle OCR operation cancelled".to_string())
    } else {
        Ok(())
    }
}

fn provisional_cue_from_raw(raw_cue: &SubtitleOcrRawCue) -> SubtitleOcrCue {
    SubtitleOcrCue {
        id: raw_cue.cue_id.clone(),
        source_cue_ids: vec![raw_cue.cue_id.clone()],
        start_time_ms: raw_cue.start_time_ms,
        end_time_ms: raw_cue.end_time_ms,
        text: raw_cue.text.clone(),
        confidence: raw_cue.confidence,
    }
}

fn emit_live_cue_event(
    app: &tauri::AppHandle,
    item_id: &str,
    run_id: &str,
    bitmap: &super::SubtitleOcrDecodedCue,
    raw_cue: &SubtitleOcrRawCue,
    provisional_cue: &SubtitleOcrCue,
) {
    let _ = app.emit(
        "subtitle-ocr-live-cue",
        SubtitleOcrLiveCueEvent {
            item_id: item_id.to_string(),
            run_id: run_id.to_string(),
            bitmap: bitmap.clone(),
            raw_cue: raw_cue.clone(),
            provisional_cue: provisional_cue.clone(),
        },
    );
}

fn ocr_decoded_bitmap(
    engine: &ocr_rs::OcrEngine,
    decoded: DecodedBitmapCue,
) -> Result<SubtitleOcrRawCue, String> {
    let DecodedBitmapCue { metadata, rgba } = decoded;
    let image = RgbaImage::from_raw(metadata.width, metadata.height, rgba).ok_or_else(|| {
        "Decoded Subtitle OCR bitmap dimensions did not match RGBA data".to_string()
    })?;
    let image = DynamicImage::ImageRgba8(image);
    recognize_subtitle_ocr_image(engine, &metadata, &image)
}

fn recognize_subtitle_ocr_image(
    engine: &ocr_rs::OcrEngine,
    metadata: &crate::tools::subtitle_ocr::SubtitleOcrDecodedCue,
    image: &DynamicImage,
) -> Result<SubtitleOcrRawCue, String> {
    let ocr_results = engine
        .recognize(image)
        .map_err(|e| format!("Subtitle OCR recognition failed: {}", e))?;
    let boxes = ocr_results
        .iter()
        .map(|result| SubtitleOcrBox {
            text: result.text.clone(),
            confidence: result.confidence as f64,
            x: result.bbox.rect.left().max(0) as f64,
            y: result.bbox.rect.top().max(0) as f64,
            width: result.bbox.rect.width() as f64,
            height: result.bbox.rect.height() as f64,
        })
        .collect::<Vec<_>>();
    let text = reconstruct_text_from_boxes(&boxes);
    let confidence = average_confidence(&boxes);

    Ok(SubtitleOcrRawCue {
        cue_id: metadata.cue_id.clone(),
        start_time_ms: metadata.start_time_ms,
        end_time_ms: metadata.end_time_ms,
        cache_key: metadata.cache_key.clone(),
        boxes,
        text,
        confidence,
    })
}

fn average_confidence(boxes: &[SubtitleOcrBox]) -> f64 {
    if boxes.is_empty() {
        0.0
    } else {
        boxes.iter().map(|ocr_box| ocr_box.confidence).sum::<f64>() / boxes.len() as f64
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::path::{Path, PathBuf};
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    use std::thread;
    use std::time::Duration;

    use image::{DynamicImage, Rgba, RgbaImage};

    use super::{
        BackgroundBitmapCountTask, build_final_subtitle_ocr_cues,
        empty_subtitle_ocr_pipeline_result, initial_bitmap_total, ocr_decoded_bitmap,
        should_start_background_count,
    };
    use crate::tools::ocr::{create_ocr_engine, resolve_ocr_engine_threads};
    use crate::tools::subtitle_ocr::decode::{
        BitmapSubtitleSource, decode_bitmap_subtitle_source_with_handler_and_stop,
    };
    use crate::tools::subtitle_ocr::progress::ProgressTotal;
    use crate::tools::subtitle_ocr::{
        SubtitleOcrBox, SubtitleOcrCue, SubtitleOcrPipelineResult, SubtitleOcrRawCue,
    };

    #[test]
    fn empty_subtitle_ocr_pipeline_result_has_no_artifacts_or_cues() {
        let result = empty_subtitle_ocr_pipeline_result();

        assert!(result.decoded_cues.is_empty());
        assert!(result.raw_ocr_cues.is_empty());
        assert!(result.stabilized_cues.is_empty());
        assert!(result.final_cues.is_empty());
    }

    #[test]
    fn initial_bitmap_total_uses_expected_count_when_available() {
        assert_eq!(initial_bitmap_total(Some(373)), ProgressTotal::Known(373));
        assert_eq!(initial_bitmap_total(Some(0)), ProgressTotal::Unknown);
        assert_eq!(initial_bitmap_total(None), ProgressTotal::Unknown);
    }

    #[test]
    fn background_count_starts_only_without_expected_count() {
        assert!(!should_start_background_count(Some(373)));
        assert!(should_start_background_count(Some(0)));
        assert!(should_start_background_count(None));
    }

    #[test]
    fn background_count_stop_joins_running_thread() {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let finished = Arc::new(AtomicBool::new(false));
        let thread_finished = Arc::clone(&finished);
        let handle = thread::spawn(move || {
            while !thread_stop.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(1));
            }
            thread_finished.store(true, Ordering::Relaxed);
        });

        let mut task = BackgroundBitmapCountTask {
            stop,
            handle: Some(handle),
        };
        task.stop();

        assert!(finished.load(Ordering::Relaxed));
        assert!(task.handle.is_none());
    }

    fn raw_cue(cue_id: &str, text: &str) -> SubtitleOcrRawCue {
        raw_cue_at(cue_id, 1_000, 2_500, text)
    }

    fn raw_cue_at(
        cue_id: &str,
        start_time_ms: u64,
        end_time_ms: u64,
        text: &str,
    ) -> SubtitleOcrRawCue {
        SubtitleOcrRawCue {
            cue_id: cue_id.to_string(),
            start_time_ms,
            end_time_ms,
            cache_key: format!("cache-{cue_id}"),
            boxes: Vec::new(),
            text: text.to_string(),
            confidence: if text.is_empty() { 0.0 } else { 0.8 },
        }
    }

    fn final_cue(cue_id: &str, text: &str) -> SubtitleOcrCue {
        SubtitleOcrCue {
            id: cue_id.to_string(),
            source_cue_ids: vec![cue_id.to_string()],
            start_time_ms: 1_000,
            end_time_ms: 2_500,
            text: text.to_string(),
            confidence: 0.8,
        }
    }

    #[test]
    #[ignore]
    fn diagnose_required_vobsub_pipeline() {
        let Ok(idx_path) =
            std::env::var("MEDIAFLOW_SUBTITLE_OCR_DIAGNOSTIC_IDX").map(PathBuf::from)
        else {
            eprintln!("Set MEDIAFLOW_SUBTITLE_OCR_DIAGNOSTIC_IDX to run this diagnostic");
            return;
        };
        let Ok(sub_path) =
            std::env::var("MEDIAFLOW_SUBTITLE_OCR_DIAGNOSTIC_SUB").map(PathBuf::from)
        else {
            eprintln!("Set MEDIAFLOW_SUBTITLE_OCR_DIAGNOSTIC_SUB to run this diagnostic");
            return;
        };
        let models_dir = std::env::var("MEDIAFLOW_SUBTITLE_OCR_DIAGNOSTIC_MODELS")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("ocr-models"));
        let output_dir = std::env::var("MEDIAFLOW_SUBTITLE_OCR_DIAGNOSTIC_OUT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from("target")
                    .join("subtitle-ocr-diagnostics")
                    .join("env-vobsub-current")
            });
        let limit = std::env::var("MEDIAFLOW_SUBTITLE_OCR_DIAGNOSTIC_LIMIT")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        let language = std::env::var("MEDIAFLOW_SUBTITLE_OCR_DIAGNOSTIC_LANGUAGE")
            .unwrap_or_else(|_| "multi".to_string());
        let use_gpu = std::env::var("MEDIAFLOW_SUBTITLE_OCR_DIAGNOSTIC_GPU")
            .map(|value| value != "0")
            .unwrap_or(true);

        std::fs::create_dir_all(output_dir.join("decoded"))
            .expect("failed to create decoded output directory");
        std::fs::create_dir_all(output_dir.join("ocr-input"))
            .expect("failed to create ocr input output directory");
        std::fs::create_dir_all(output_dir.join("overlays"))
            .expect("failed to create overlay output directory");
        std::fs::create_dir_all(output_dir.join("line-overlays"))
            .expect("failed to create line overlay output directory");

        let source = BitmapSubtitleSource::VobSub { idx_path, sub_path };
        let engine_threads = resolve_ocr_engine_threads(1);
        let engine = create_ocr_engine(&models_dir, &language, use_gpu, engine_threads, true)
            .expect("failed to create OCR engine");
        let mut decoded_cues = Vec::new();
        let mut raw_ocr_cues = Vec::new();
        let mut final_candidates = Vec::new();
        let decoded_count = Cell::new(0usize);

        let decode_result = decode_bitmap_subtitle_source_with_handler_and_stop(
            &source,
            "diagnostic-vobsub",
            "diagnostic-run",
            |decoded| {
                decoded_count.set(decoded_count.get().saturating_add(1));
                let sequence = decoded_count.get();
                let decoded_path = output_dir
                    .join("decoded")
                    .join(format!("{sequence:04}-decoded.png"));
                let ocr_input_path = output_dir
                    .join("ocr-input")
                    .join(format!("{sequence:04}-ocr-input.png"));
                write_rgba_png(
                    &decoded_path,
                    decoded.metadata.width,
                    decoded.metadata.height,
                    &decoded.rgba,
                );
                let decoded_image = RgbaImage::from_raw(
                    decoded.metadata.width,
                    decoded.metadata.height,
                    decoded.rgba.clone(),
                )
                .map(DynamicImage::ImageRgba8)
                .expect("decoded RGBA dimensions should match data");
                decoded_image
                    .save(&ocr_input_path)
                    .expect("failed to write diagnostic OCR input PNG");

                let metadata = decoded.metadata.clone();
                let raw_cue = ocr_decoded_bitmap(&engine, decoded)
                    .expect("failed to OCR decoded VobSub bitmap");
                write_detection_overlay(
                    &output_dir
                        .join("overlays")
                        .join(format!("{sequence:04}-boxes.png")),
                    &ocr_input_path,
                    &raw_cue.boxes,
                    Rgba([255, 0, 0, 255]),
                );
                write_line_overlay(
                    &output_dir
                        .join("line-overlays")
                        .join(format!("{sequence:04}-lines.png")),
                    &ocr_input_path,
                    &raw_cue.boxes,
                );

                if !raw_cue.text.trim().is_empty() {
                    final_candidates.push(SubtitleOcrCue {
                        id: raw_cue.cue_id.clone(),
                        source_cue_ids: vec![raw_cue.cue_id.clone()],
                        start_time_ms: raw_cue.start_time_ms,
                        end_time_ms: raw_cue.end_time_ms,
                        text: raw_cue.text.clone(),
                        confidence: raw_cue.confidence,
                    });
                }

                decoded_cues.push(metadata);
                raw_ocr_cues.push(raw_cue);
                Ok(())
            },
            || limit > 0 && decoded_count.get() >= limit,
        );
        if limit > 0 {
            let error = decode_result.expect_err("diagnostic decode limit should stop the stream");
            assert!(
                error.contains("stopped"),
                "unexpected diagnostic decode error: {error}"
            );
        } else {
            decode_result.expect("failed to decode and OCR VobSub diagnostic source");
        }

        let stabilized_cues =
            crate::tools::subtitle_ocr::stabilize::stabilize_cues(&final_candidates);
        let final_cues = build_final_subtitle_ocr_cues(&raw_ocr_cues, stabilized_cues.clone());
        let result = SubtitleOcrPipelineResult {
            decoded_cues,
            raw_ocr_cues,
            stabilized_cues,
            final_cues,
        };

        std::fs::write(
            output_dir.join("pipeline-result.json"),
            serde_json::to_string_pretty(&result).expect("failed to serialize diagnostic result"),
        )
        .expect("failed to write diagnostic JSON");
        std::fs::write(
            output_dir.join("final.srt"),
            format_diagnostic_srt(&result.final_cues),
        )
        .expect("failed to write diagnostic SRT");

        println!(
            "SUBTITLE_OCR_DIAGNOSTIC output={} decoded={} raw={} final={}",
            output_dir.display(),
            result.decoded_cues.len(),
            result.raw_ocr_cues.len(),
            result.final_cues.len()
        );
    }

    fn write_rgba_png(path: &Path, width: u32, height: u32, rgba: &[u8]) {
        let image = RgbaImage::from_raw(width, height, rgba.to_vec())
            .expect("decoded RGBA dimensions should match data");
        image.save(path).expect("failed to write RGBA PNG");
    }

    fn write_detection_overlay(
        output_path: &Path,
        source_path: &Path,
        boxes: &[SubtitleOcrBox],
        color: Rgba<u8>,
    ) {
        let mut image = image::open(source_path)
            .expect("failed to open source image for overlay")
            .to_rgba8();
        for ocr_box in boxes {
            draw_rect(&mut image, ocr_box, color);
        }
        image
            .save(output_path)
            .expect("failed to write detection overlay");
    }

    fn write_line_overlay(output_path: &Path, source_path: &Path, boxes: &[SubtitleOcrBox]) {
        let mut image = image::open(source_path)
            .expect("failed to open source image for line overlay")
            .to_rgba8();
        for (line_index, line) in diagnostic_lines(boxes).iter().enumerate() {
            let color = if line_index % 2 == 0 {
                Rgba([0, 192, 255, 255])
            } else {
                Rgba([255, 160, 0, 255])
            };
            draw_rect(&mut image, line, color);
        }
        image
            .save(output_path)
            .expect("failed to write line overlay");
    }

    fn diagnostic_lines(boxes: &[SubtitleOcrBox]) -> Vec<SubtitleOcrBox> {
        let mut boxes = boxes
            .iter()
            .filter(|ocr_box| !ocr_box.text.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>();
        boxes.sort_by(|a, b| a.y.total_cmp(&b.y).then_with(|| a.x.total_cmp(&b.x)));

        let mut lines: Vec<SubtitleOcrBox> = Vec::new();
        for ocr_box in boxes {
            let ocr_box_center_y = diagnostic_box_center_y(&ocr_box);
            if let Some(line) = lines.last_mut().filter(|line| {
                diagnostic_is_same_line(
                    diagnostic_box_center_y(line),
                    line.height,
                    ocr_box_center_y,
                    ocr_box.height,
                )
            }) {
                let right = (line.x + line.width).max(ocr_box.x + ocr_box.width);
                let bottom = (line.y + line.height).max(ocr_box.y + ocr_box.height);
                line.x = line.x.min(ocr_box.x);
                line.y = line.y.min(ocr_box.y);
                line.width = (right - line.x).max(1.0);
                line.height = (bottom - line.y).max(1.0);
                line.text = format!("{} {}", line.text, ocr_box.text);
            } else {
                lines.push(ocr_box);
            }
        }

        lines
    }

    fn diagnostic_box_center_y(ocr_box: &SubtitleOcrBox) -> f64 {
        ocr_box.y + (ocr_box.height / 2.0)
    }

    fn diagnostic_is_same_line(
        line_center_y: f64,
        line_height: f64,
        box_center_y: f64,
        box_height: f64,
    ) -> bool {
        let height = line_height.max(box_height);
        let threshold = if height > 0.0 {
            (height * 0.45).max(8.0)
        } else {
            0.01
        };

        (line_center_y - box_center_y).abs() <= threshold
    }

    fn draw_rect(image: &mut RgbaImage, rect: &SubtitleOcrBox, color: Rgba<u8>) {
        if image.width() == 0 || image.height() == 0 {
            return;
        }

        let left = rect.x.max(0.0).floor() as u32;
        let top = rect.y.max(0.0).floor() as u32;
        let right = (rect.x + rect.width)
            .max(0.0)
            .ceil()
            .min(f64::from(image.width().saturating_sub(1))) as u32;
        let bottom = (rect.y + rect.height)
            .max(0.0)
            .ceil()
            .min(f64::from(image.height().saturating_sub(1))) as u32;

        if right < left || bottom < top {
            return;
        }

        for x in left..=right {
            image.put_pixel(x, top, color);
            image.put_pixel(x, bottom, color);
        }
        for y in top..=bottom {
            image.put_pixel(left, y, color);
            image.put_pixel(right, y, color);
        }
    }

    fn format_diagnostic_srt(cues: &[SubtitleOcrCue]) -> String {
        cues.iter()
            .filter(|cue| !cue.text.trim().is_empty())
            .enumerate()
            .map(|(index, cue)| {
                format!(
                    "{}\n{} --> {}\n{}\n",
                    index + 1,
                    format_diagnostic_srt_time(cue.start_time_ms),
                    format_diagnostic_srt_time(cue.end_time_ms),
                    cue.text
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn format_diagnostic_srt_time(ms: u64) -> String {
        let hours = ms / 3_600_000;
        let minutes = (ms % 3_600_000) / 60_000;
        let seconds = (ms % 60_000) / 1_000;
        let millis = ms % 1_000;

        format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
    }

    #[test]
    fn build_final_subtitle_ocr_cues_creates_blank_review_cues_for_empty_ocr() {
        let raw = vec![raw_cue("cue-1", ""), raw_cue("cue-2", "   ")];

        let final_cues = build_final_subtitle_ocr_cues(&raw, Vec::new());

        assert_eq!(final_cues.len(), 2);
        assert_eq!(final_cues[0].id, "cue-1");
        assert_eq!(final_cues[0].source_cue_ids, vec!["cue-1"]);
        assert_eq!(final_cues[0].start_time_ms, 1_000);
        assert_eq!(final_cues[0].end_time_ms, 2_500);
        assert!(final_cues.iter().all(|cue| cue.text.is_empty()));
    }

    #[test]
    fn build_final_subtitle_ocr_cues_preserves_blank_cues_in_mixed_results() {
        let raw = vec![raw_cue("cue-1", ""), raw_cue("cue-2", "Hello")];
        let stabilized = vec![final_cue("cue-2", "Hello")];

        let final_cues = build_final_subtitle_ocr_cues(&raw, stabilized);

        assert_eq!(final_cues.len(), 2);
        assert_eq!(final_cues[0].id, "cue-1");
        assert!(final_cues[0].text.is_empty());
        assert_eq!(final_cues[1], final_cue("cue-2", "Hello"));
    }

    #[test]
    fn build_final_subtitle_ocr_cues_emits_merged_stabilized_cues_once() {
        let raw = vec![
            raw_cue_at("cue-1", 1_000, 2_000, "Hello"),
            raw_cue_at("cue-2", 2_100, 2_500, "Hello"),
            raw_cue_at("cue-3", 2_600, 3_000, ""),
        ];
        let mut stabilized = final_cue("cue-1", "Hello");
        stabilized.end_time_ms = 2_500;
        stabilized.source_cue_ids = vec!["cue-1".to_string(), "cue-2".to_string()];

        let final_cues = build_final_subtitle_ocr_cues(&raw, vec![stabilized.clone()]);

        assert_eq!(final_cues.len(), 2);
        assert_eq!(final_cues[0], stabilized);
        assert_eq!(final_cues[1].id, "cue-3");
        assert!(final_cues[1].text.is_empty());
    }
}
