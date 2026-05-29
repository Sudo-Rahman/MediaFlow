use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU32, Ordering},
};
use std::thread::{self, JoinHandle};

use image::{DynamicImage, RgbaImage, imageops::FilterType};

use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::tools::ocr::{create_ocr_engine, get_ocr_models_dir, resolve_ocr_engine_threads};
use crate::tools::subtitle_ocr::decode::{
    BitmapSubtitleSource, DecodedBitmapCue, count_bitmap_subtitle_source_with_stop,
    decode_bitmap_subtitle_source_with_handler, validate_bitmap_subtitle_source,
};
use crate::tools::subtitle_ocr::progress::{ProgressTotal, SubtitleOcrProgressEmitter};
use crate::tools::subtitle_ocr::stabilize::stabilize_cues;
use crate::tools::subtitle_ocr::text::reconstruct_text_from_boxes;
use crate::tools::subtitle_ocr::{
    SubtitleOcrBox, SubtitleOcrCue, SubtitleOcrDecodedCue, SubtitleOcrPipelineResult,
    SubtitleOcrRawCue,
};

const THUMBNAIL_MAX_WIDTH: u32 = 360;
const THUMBNAIL_MAX_HEIGHT: u32 = 180;
const PREVIEW_MAX_WIDTH: u32 = 1920;
const PREVIEW_MAX_HEIGHT: u32 = 1080;

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
        decoded.metadata.thumbnail_path = Some(bitmap_assets.thumbnail_path);
        decoded.metadata.preview_path = Some(bitmap_assets.preview_path);
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
    progress.ai_cleaning.emit_force(1);

    Ok(SubtitleOcrPipelineResult {
        decoded_cues: decoded_metadata,
        raw_ocr_cues,
        final_cues: stabilized_cues.clone(),
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

fn ensure_not_cancelled(item_id: &str, run_id: &str) -> Result<(), String> {
    if super::state::is_operation_cancelled(item_id, run_id) {
        Err("Subtitle OCR operation cancelled".to_string())
    } else {
        Ok(())
    }
}

struct DecodedBitmapAssetPaths {
    thumbnail_path: String,
    preview_path: String,
}

fn write_decoded_bitmap_assets(
    item_id: &str,
    run_id: &str,
    metadata: &SubtitleOcrDecodedCue,
    rgba: &[u8],
) -> Result<DecodedBitmapAssetPaths, String> {
    let image =
        RgbaImage::from_raw(metadata.width, metadata.height, rgba.to_vec()).ok_or_else(|| {
            "Decoded Subtitle OCR bitmap dimensions did not match RGBA data".to_string()
        })?;
    let image = DynamicImage::ImageRgba8(image);

    let thumbnail_path = write_resized_bitmap_asset(
        item_id,
        run_id,
        metadata,
        &image,
        THUMBNAIL_MAX_WIDTH,
        THUMBNAIL_MAX_HEIGHT,
        "thumbnails",
    )?;
    let preview_path = write_resized_bitmap_asset(
        item_id,
        run_id,
        metadata,
        &image,
        PREVIEW_MAX_WIDTH,
        PREVIEW_MAX_HEIGHT,
        "previews",
    )?;

    Ok(DecodedBitmapAssetPaths {
        thumbnail_path,
        preview_path,
    })
}

fn write_resized_bitmap_asset(
    item_id: &str,
    run_id: &str,
    metadata: &SubtitleOcrDecodedCue,
    image: &DynamicImage,
    max_width: u32,
    max_height: u32,
    variant: &str,
) -> Result<String, String> {
    let resized = if image.width() > max_width || image.height() > max_height {
        image.resize(max_width, max_height, FilterType::Triangle)
    } else {
        image.clone()
    };
    let output_dir = subtitle_ocr_bitmap_asset_dir(item_id, run_id, variant);
    std::fs::create_dir_all(&output_dir).map_err(|e| {
        format!(
            "Failed to create Subtitle OCR bitmap asset directory: {}",
            e
        )
    })?;
    let output_path = output_dir.join(format!(
        "{}.png",
        safe_thumbnail_path_component(&metadata.cache_key)
    ));
    resized
        .save(&output_path)
        .map_err(|e| format!("Failed to write Subtitle OCR bitmap asset: {}", e))?;

    Ok(output_path.to_string_lossy().to_string())
}

fn subtitle_ocr_bitmap_asset_dir(item_id: &str, run_id: &str, variant: &str) -> PathBuf {
    std::env::temp_dir()
        .join("MediaFlow")
        .join("subtitle-ocr")
        .join(safe_thumbnail_path_component(item_id))
        .join(safe_thumbnail_path_component(run_id))
        .join(safe_thumbnail_path_component(variant))
}

fn safe_thumbnail_path_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() {
        "subtitle-ocr".to_string()
    } else {
        sanitized
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
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    use std::thread;
    use std::time::Duration;

    use super::{
        BackgroundBitmapCountTask, THUMBNAIL_MAX_HEIGHT, THUMBNAIL_MAX_WIDTH,
        empty_subtitle_ocr_pipeline_result, initial_bitmap_total, safe_thumbnail_path_component,
        should_start_background_count, subtitle_ocr_bitmap_asset_dir, write_decoded_bitmap_assets,
    };
    use crate::tools::subtitle_ocr::SubtitleOcrDecodedCue;
    use crate::tools::subtitle_ocr::progress::ProgressTotal;

    #[test]
    fn safe_thumbnail_path_component_removes_path_separators_and_empty_segments() {
        assert_eq!(
            safe_thumbnail_path_component("subtitle-ocr:item/../cache:key"),
            "subtitle-ocr_item____cache_key"
        );
        assert_eq!(safe_thumbnail_path_component(":::"), "subtitle-ocr");
    }

    #[test]
    fn subtitle_ocr_bitmap_asset_dir_stays_under_mediaflow_temp_namespace() {
        let dir = subtitle_ocr_bitmap_asset_dir("../item", "run/id", "previews");
        let path = dir.to_string_lossy();

        assert!(path.contains("MediaFlow"));
        assert!(path.contains("subtitle-ocr"));
        assert!(path.contains("item"));
        assert!(path.contains("run_id"));
        assert!(path.contains("previews"));
        assert!(!path.contains("../"));
    }

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

    #[test]
    fn write_decoded_bitmap_assets_populates_timeline_and_preview_pngs_under_temp_dir() {
        let metadata = SubtitleOcrDecodedCue {
            cue_id: "cue-1".to_string(),
            start_time_ms: 0,
            end_time_ms: 1_000,
            width: 720,
            height: 360,
            cache_key: "subtitle-ocr:test/cache".to_string(),
            thumbnail_path: None,
            preview_path: None,
        };
        let rgba = vec![255; (metadata.width * metadata.height * 4) as usize];

        let assets = write_decoded_bitmap_assets("item/1", "run:1", &metadata, &rgba)
            .expect("bitmap assets should be written");
        let path = assets.thumbnail_path;
        let thumbnail = image::open(&path).expect("thumbnail should be readable");
        let preview = image::open(&assets.preview_path).expect("preview should be readable");

        assert!(path.contains("MediaFlow"));
        assert!(path.contains("subtitle-ocr"));
        assert!(std::path::Path::new(&path).is_file());
        assert!(std::path::Path::new(&assets.preview_path).is_file());
        assert!(thumbnail.width() <= THUMBNAIL_MAX_WIDTH);
        assert!(thumbnail.height() <= THUMBNAIL_MAX_HEIGHT);
        assert_eq!(preview.width(), metadata.width);
        assert_eq!(preview.height(), metadata.height);

        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(assets.preview_path);
    }
}
