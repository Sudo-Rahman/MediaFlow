use std::path::PathBuf;

use image::{DynamicImage, RgbaImage};

use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::tools::ocr::{create_ocr_engine, get_ocr_models_dir, resolve_ocr_engine_threads};
use crate::tools::subtitle_ocr::decode::{
    DecodedBitmapCue, decode_bitmap_subtitle_source_with_handler, validate_bitmap_subtitle_source,
};
use crate::tools::subtitle_ocr::progress::SubtitleOcrProgressEmitter;
use crate::tools::subtitle_ocr::stabilize::stabilize_cues;
use crate::tools::subtitle_ocr::text::reconstruct_text_from_boxes;
use crate::tools::subtitle_ocr::{
    SubtitleOcrBox, SubtitleOcrCue, SubtitleOcrPipelineResult, SubtitleOcrRawCue,
};

#[derive(Clone)]
struct PipelineProgress {
    decoding: SubtitleOcrProgressEmitter,
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

    let progress = PipelineProgress {
        decoding: SubtitleOcrProgressEmitter::new(
            app.clone(),
            item_id.clone(),
            run_id.clone(),
            "decoding",
            1,
        ),
        ocr: SubtitleOcrProgressEmitter::new(
            app.clone(),
            item_id.clone(),
            run_id.clone(),
            "ocr",
            1,
        ),
        ai_cleaning: SubtitleOcrProgressEmitter::new(
            app,
            item_id.clone(),
            run_id.clone(),
            "ai_cleaning",
            1,
        ),
    };

    let item_id_for_task = item_id.clone();
    let run_id_for_task = run_id.clone();
    let task = tokio::task::spawn_blocking(move || {
        run_subtitle_ocr_pipeline_blocking(
            &item_id_for_task,
            &run_id_for_task,
            &source,
            models_dir,
            &language,
            use_gpu,
            progress,
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
    models_dir: PathBuf,
    language: &str,
    use_gpu: bool,
    progress: PipelineProgress,
) -> Result<SubtitleOcrPipelineResult, String> {
    ensure_not_cancelled(item_id, run_id)?;
    progress
        .decoding
        .emit_force(0, "Decoding bitmap subtitles...");

    ensure_not_cancelled(item_id, run_id)?;
    let engine_threads = resolve_ocr_engine_threads(1);
    let engine = create_ocr_engine(&models_dir, language, use_gpu, engine_threads, true)?;
    progress
        .ocr
        .emit_force(0, "Running OCR on subtitle bitmaps...");

    let mut decoded_metadata = Vec::new();
    let mut raw_ocr_cues = Vec::new();
    let mut final_candidates = Vec::new();
    let mut decoded_count = 0u32;
    decode_bitmap_subtitle_source_with_handler(source, item_id, run_id, |decoded| {
        ensure_not_cancelled(item_id, run_id)?;
        decoded_count = decoded_count.saturating_add(1);
        let metadata = decoded.metadata.clone();
        let raw_cue = ocr_decoded_bitmap(&engine, decoded)?;
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
        decoded_metadata.push(metadata);
        raw_ocr_cues.push(raw_cue);
        progress.ocr.emit(
            0,
            format!("Processed {} subtitle bitmaps...", decoded_count),
        );
        Ok(())
    })?;

    progress.decoding.emit_force(
        1,
        format!("Decoded {} subtitle bitmaps", decoded_metadata.len()),
    );
    progress.ocr.emit_force(1, "Subtitle bitmap OCR complete");

    ensure_not_cancelled(item_id, run_id)?;
    progress
        .ai_cleaning
        .emit_force(0, "Stabilizing subtitle OCR cues...");
    let stabilized_cues = stabilize_cues(&final_candidates);
    progress.ai_cleaning.emit_force(
        1,
        format!("Stabilized {} subtitle cues", stabilized_cues.len()),
    );

    Ok(SubtitleOcrPipelineResult {
        decoded_cues: decoded_metadata,
        raw_ocr_cues,
        final_cues: stabilized_cues.clone(),
        stabilized_cues,
    })
}

fn ensure_not_cancelled(item_id: &str, run_id: &str) -> Result<(), String> {
    if super::state::is_operation_cancelled(item_id, run_id) {
        Err("Subtitle OCR operation cancelled".to_string())
    } else {
        Ok(())
    }
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
    let ocr_results = engine
        .recognize(&image)
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
        cue_id: metadata.cue_id,
        start_time_ms: metadata.start_time_ms,
        end_time_ms: metadata.end_time_ms,
        cache_key: metadata.cache_key,
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
mod tests {}
