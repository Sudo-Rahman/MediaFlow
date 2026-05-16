use std::collections::HashMap;
use std::mem;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use image::{DynamicImage, RgbImage, imageops::FilterType};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::time::timeout;

use crate::shared::ffmpeg_progress::FfmpegProgressTracker;
use crate::shared::process::terminate_process;
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::store::{resolve_ffmpeg_path, resolve_ffprobe_path};
use crate::shared::validation::validate_media_path;
use crate::tools::ffprobe::{
    get_media_duration_us, probe::get_primary_video_dimensions_with_ffprobe,
};
use crate::tools::ocr::engine::{
    create_ocr_engine, get_ocr_models_dir, resolve_ocr_engine_threads,
    resolve_ocr_worker_count_for_backend,
};
use crate::tools::ocr::progress::OcrProgressEmitter;
use crate::tools::ocr::subtitles::generate_subtitles_core;
use crate::tools::ocr::{
    OcrFrameResult, OcrLiveDetectionEvent, OcrPipelineResult, OcrPipelineTelemetry,
    OcrPipelineTimings, OcrRegion, OcrSelection, OcrSubtitleCleanupOptions, OcrZone,
    validate_ocr_selection,
};

const OCR_PIPELINE_TIMEOUT: Duration = Duration::from_secs(1800);
const FRAME_CHANNEL_CAPACITY: usize = 8;
const WORKER_DISPATCH_CHUNK_SIZE: usize = 4;
const WORKER_QUEUE_CAPACITY: usize = WORKER_DISPATCH_CHUNK_SIZE;
const REGION_OCR_FRAME_WIDTH: u32 = 960;
const REGION_OCR_FRAME_HEIGHT: u32 = 180;
const FULL_OCR_FRAME_WIDTH: u32 = 960;
const FULL_OCR_FRAME_HEIGHT: u32 = 540;
const FRAME_FINGERPRINT_WIDTH: u32 = 32;
const FRAME_FINGERPRINT_HEIGHT: u32 = 18;
const DETAIL_FINGERPRINT_WIDTH: u32 = 128;
const DETAIL_FINGERPRINT_HEIGHT: u32 = 72;
const UNCHANGED_MEAN_ABS_DIFF_THRESHOLD: f32 = 1.25;
const UNCHANGED_MAX_ABS_DIFF_THRESHOLD: u8 = 32;
const UNCHANGED_CHANGED_CELL_DIFF_THRESHOLD: u8 = 8;
const UNCHANGED_CHANGED_CELL_RATIO_THRESHOLD: f32 = 0.02;
const UNCHANGED_DETAIL_MEAN_ABS_DIFF_THRESHOLD: f32 = 1.25;
const UNCHANGED_DETAIL_MAX_ABS_DIFF_THRESHOLD: u8 = 18;
const UNCHANGED_DETAIL_CHANGED_SAMPLE_DIFF_THRESHOLD: u8 = 8;
const UNCHANGED_DETAIL_CHANGED_SAMPLE_RATIO_THRESHOLD: f32 = 0.004;
const LOW_DETAIL_VARIANCE_THRESHOLD: f32 = 12.0;
const LOW_DETAIL_EDGE_DENSITY_THRESHOLD: f32 = 0.015;

#[derive(Clone, Debug)]
struct FrameFingerprint {
    cells: Vec<u8>,
    detail_samples: Vec<u8>,
    variance: f32,
    edge_density: f32,
}

struct FrameFingerprintDelta {
    mean_abs_diff: f32,
    max_abs_diff: u8,
    changed_cell_ratio: f32,
}

struct DetailFingerprintDelta {
    mean_abs_diff: f32,
    max_abs_diff: u8,
    changed_sample_ratio: f32,
}

#[derive(Clone, Copy)]
struct OcrFrameOutputSpec {
    width: u32,
    height: u32,
}

impl OcrFrameOutputSpec {
    fn byte_len(self) -> usize {
        (self.width as usize)
            .saturating_mul(self.height as usize)
            .saturating_mul(3)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SourceVideoDimensions {
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ContentRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

struct OcrTelemetryCounters {
    ocr_attempted_frames: AtomicU32,
    text_frames: AtomicU32,
    unchanged_skipped_frames: AtomicU32,
    no_text_skipped_frames: AtomicU32,
    effective_workers: u32,
    engine_threads: i32,
}

impl OcrTelemetryCounters {
    fn new(effective_workers: usize, engine_threads: i32) -> Self {
        Self {
            ocr_attempted_frames: AtomicU32::new(0),
            text_frames: AtomicU32::new(0),
            unchanged_skipped_frames: AtomicU32::new(0),
            no_text_skipped_frames: AtomicU32::new(0),
            effective_workers: effective_workers as u32,
            engine_threads,
        }
    }

    fn snapshot(&self, extracted_frames: u32) -> OcrPipelineTelemetry {
        OcrPipelineTelemetry {
            extracted_frames,
            ocr_attempted_frames: self.ocr_attempted_frames.load(Ordering::Relaxed),
            text_frames: self.text_frames.load(Ordering::Relaxed),
            unchanged_skipped_frames: self.unchanged_skipped_frames.load(Ordering::Relaxed),
            no_text_skipped_frames: self.no_text_skipped_frames.load(Ordering::Relaxed),
            effective_workers: self.effective_workers,
            engine_threads: self.engine_threads,
        }
    }
}

fn create_frame_fingerprint(image: &DynamicImage) -> FrameFingerprint {
    let grayscale = image.to_luma8();
    let (width, height) = grayscale.dimensions();
    if width == 0 || height == 0 {
        return FrameFingerprint {
            cells: vec![0; (FRAME_FINGERPRINT_WIDTH * FRAME_FINGERPRINT_HEIGHT) as usize],
            detail_samples: vec![
                0;
                (DETAIL_FINGERPRINT_WIDTH * DETAIL_FINGERPRINT_HEIGHT) as usize
            ],
            variance: 0.0,
            edge_density: 0.0,
        };
    }

    let mut cells =
        Vec::with_capacity((FRAME_FINGERPRINT_WIDTH * FRAME_FINGERPRINT_HEIGHT) as usize);
    for cell_y in 0..FRAME_FINGERPRINT_HEIGHT {
        let y_start = cell_y * height / FRAME_FINGERPRINT_HEIGHT;
        let y_end = ((cell_y + 1) * height / FRAME_FINGERPRINT_HEIGHT)
            .max(y_start + 1)
            .min(height);

        for cell_x in 0..FRAME_FINGERPRINT_WIDTH {
            let x_start = cell_x * width / FRAME_FINGERPRINT_WIDTH;
            let x_end = ((cell_x + 1) * width / FRAME_FINGERPRINT_WIDTH)
                .max(x_start + 1)
                .min(width);

            let mut sum = 0_u64;
            let mut count = 0_u64;
            for y in y_start..y_end {
                for x in x_start..x_end {
                    sum += grayscale.get_pixel(x, y)[0] as u64;
                    count += 1;
                }
            }

            cells.push((sum / count.max(1)) as u8);
        }
    }

    let mut detail_samples =
        Vec::with_capacity((DETAIL_FINGERPRINT_WIDTH * DETAIL_FINGERPRINT_HEIGHT) as usize);
    for sample_y in 0..DETAIL_FINGERPRINT_HEIGHT {
        let y = ((sample_y * height) / DETAIL_FINGERPRINT_HEIGHT).min(height - 1);
        for sample_x in 0..DETAIL_FINGERPRINT_WIDTH {
            let x = ((sample_x * width) / DETAIL_FINGERPRINT_WIDTH).min(width - 1);
            detail_samples.push(grayscale.get_pixel(x, y)[0]);
        }
    }

    let mean = cells.iter().map(|value| *value as f32).sum::<f32>() / cells.len() as f32;
    let variance = cells
        .iter()
        .map(|value| {
            let delta = *value as f32 - mean;
            delta * delta
        })
        .sum::<f32>()
        / cells.len() as f32;

    let mut edge_count = 0_u32;
    let mut edge_total = 0_u32;
    for y in 0..FRAME_FINGERPRINT_HEIGHT {
        for x in 0..FRAME_FINGERPRINT_WIDTH {
            let index = (y * FRAME_FINGERPRINT_WIDTH + x) as usize;
            let value = cells[index] as i16;
            if x + 1 < FRAME_FINGERPRINT_WIDTH {
                let right = cells[(y * FRAME_FINGERPRINT_WIDTH + x + 1) as usize] as i16;
                if (value - right).abs() > 24 {
                    edge_count += 1;
                }
                edge_total += 1;
            }
            if y + 1 < FRAME_FINGERPRINT_HEIGHT {
                let bottom = cells[((y + 1) * FRAME_FINGERPRINT_WIDTH + x) as usize] as i16;
                if (value - bottom).abs() > 24 {
                    edge_count += 1;
                }
                edge_total += 1;
            }
        }
    }

    FrameFingerprint {
        cells,
        detail_samples,
        variance,
        edge_density: edge_count as f32 / edge_total.max(1) as f32,
    }
}

fn fingerprint_delta(
    current: &FrameFingerprint,
    previous: &FrameFingerprint,
) -> FrameFingerprintDelta {
    let len = current.cells.len().min(previous.cells.len());
    if len == 0 {
        return FrameFingerprintDelta {
            mean_abs_diff: f32::MAX,
            max_abs_diff: u8::MAX,
            changed_cell_ratio: 1.0,
        };
    }

    let mut diff_sum = 0_u32;
    let mut max_abs_diff = 0_u8;
    let mut changed_cells = 0_u32;
    for (current, previous) in current.cells.iter().zip(previous.cells.iter()).take(len) {
        let abs_diff = current.abs_diff(*previous);
        diff_sum += abs_diff as u32;
        max_abs_diff = max_abs_diff.max(abs_diff);
        if abs_diff >= UNCHANGED_CHANGED_CELL_DIFF_THRESHOLD {
            changed_cells += 1;
        }
    }

    FrameFingerprintDelta {
        mean_abs_diff: diff_sum as f32 / len as f32,
        max_abs_diff,
        changed_cell_ratio: changed_cells as f32 / len as f32,
    }
}

fn detail_fingerprint_delta(
    current: &FrameFingerprint,
    previous: &FrameFingerprint,
) -> DetailFingerprintDelta {
    let len = current
        .detail_samples
        .len()
        .min(previous.detail_samples.len());
    if len == 0 {
        return DetailFingerprintDelta {
            mean_abs_diff: f32::MAX,
            max_abs_diff: u8::MAX,
            changed_sample_ratio: 1.0,
        };
    }

    let mut diff_sum = 0_u32;
    let mut max_abs_diff = 0_u8;
    let mut changed_samples = 0_u32;
    for (current, previous) in current
        .detail_samples
        .iter()
        .zip(previous.detail_samples.iter())
        .take(len)
    {
        let abs_diff = current.abs_diff(*previous);
        diff_sum += abs_diff as u32;
        max_abs_diff = max_abs_diff.max(abs_diff);
        if abs_diff >= UNCHANGED_DETAIL_CHANGED_SAMPLE_DIFF_THRESHOLD {
            changed_samples += 1;
        }
    }

    DetailFingerprintDelta {
        mean_abs_diff: diff_sum as f32 / len as f32,
        max_abs_diff,
        changed_sample_ratio: changed_samples as f32 / len as f32,
    }
}

fn is_visually_unchanged(current: &FrameFingerprint, previous: &FrameFingerprint) -> bool {
    let delta = fingerprint_delta(current, previous);
    let detail_delta = detail_fingerprint_delta(current, previous);
    delta.mean_abs_diff <= UNCHANGED_MEAN_ABS_DIFF_THRESHOLD
        && delta.max_abs_diff <= UNCHANGED_MAX_ABS_DIFF_THRESHOLD
        && delta.changed_cell_ratio <= UNCHANGED_CHANGED_CELL_RATIO_THRESHOLD
        && detail_delta.mean_abs_diff <= UNCHANGED_DETAIL_MEAN_ABS_DIFF_THRESHOLD
        && detail_delta.max_abs_diff <= UNCHANGED_DETAIL_MAX_ABS_DIFF_THRESHOLD
        && detail_delta.changed_sample_ratio <= UNCHANGED_DETAIL_CHANGED_SAMPLE_RATIO_THRESHOLD
}

fn is_low_detail_no_text(fingerprint: &FrameFingerprint) -> bool {
    fingerprint.variance <= LOW_DETAIL_VARIANCE_THRESHOLD
        && fingerprint.edge_density <= LOW_DETAIL_EDGE_DENSITY_THRESHOLD
}

fn can_clone_previous_frame_result(
    frame: &StreamedFrame,
    fingerprint: &FrameFingerprint,
    previous_result: &OcrFrameResult,
    previous_fingerprint: &FrameFingerprint,
) -> bool {
    previous_result.frame_index.saturating_add(1) == frame.frame_index
        && is_visually_unchanged(fingerprint, previous_fingerprint)
}

fn empty_frame_result(frame: &StreamedFrame) -> OcrFrameResult {
    OcrFrameResult {
        frame_index: frame.frame_index,
        time_ms: frame.time_ms,
        text: String::new(),
        confidence: 0.0,
        segment_id: None,
        zone_id: None,
        role: None,
        region: None,
    }
}

fn clone_frame_result_for_frame(
    previous: &OcrFrameResult,
    frame: &StreamedFrame,
) -> OcrFrameResult {
    OcrFrameResult {
        frame_index: frame.frame_index,
        time_ms: frame.time_ms,
        text: previous.text.clone(),
        confidence: previous.confidence,
        segment_id: previous.segment_id.clone(),
        zone_id: previous.zone_id.clone(),
        role: previous.role.clone(),
        region: previous.region.clone(),
    }
}

fn push_ocr_result(
    results: &Arc<Mutex<Vec<OcrFrameResult>>>,
    frame_result: OcrFrameResult,
) -> Result<(), String> {
    let mut guard = results
        .lock()
        .map_err(|_| "Failed to collect OCR result".to_string())?;
    guard.push(frame_result);
    Ok(())
}

fn emit_processed_frame_progress(
    processed_frames: &AtomicU32,
    progress: Option<&OcrProgressEmitter>,
    total_frames_hint: u32,
) {
    let current = processed_frames.fetch_add(1, Ordering::Relaxed) + 1;
    if let Some(progress) = progress {
        progress.emit(
            current,
            format!("Processing frame {}/{}...", current, total_frames_hint),
        );
    }
}

fn summarize_ocr_results(
    frame_index: u32,
    time_ms: u64,
    ocr_results: &[ocr_rs::OcrResult_],
) -> OcrFrameResult {
    let mut sorted_results: Vec<_> = ocr_results.iter().collect();
    sorted_results.sort_by(|a, b| {
        let a_top = a.bbox.rect.top();
        let b_top = b.bbox.rect.top();
        a_top
            .partial_cmp(&b_top)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let combined_text = sorted_results
        .iter()
        .map(|result| result.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    let avg_confidence = if sorted_results.is_empty() {
        0.0
    } else {
        sorted_results
            .iter()
            .map(|result| result.confidence)
            .sum::<f32>() as f64
            / sorted_results.len() as f64
    };

    OcrFrameResult {
        frame_index,
        time_ms,
        text: combined_text,
        confidence: avg_confidence,
        segment_id: None,
        zone_id: None,
        role: None,
        region: None,
    }
}

struct ActiveZone<'a> {
    segment_id: &'a str,
    zone: &'a OcrZone,
}

#[derive(Clone)]
struct LiveDetectionContext {
    app: tauri::AppHandle,
    file_id: String,
    operation_id: String,
}

fn active_zones_for_time(selection: &OcrSelection, time_ms: u64) -> Vec<ActiveZone<'_>> {
    selection
        .segments
        .iter()
        .filter(|segment| time_ms >= segment.start_time_ms && time_ms < segment.end_time_ms)
        .flat_map(|segment| {
            segment.zones.iter().map(move |zone| ActiveZone {
                segment_id: &segment.id,
                zone,
            })
        })
        .collect()
}

fn crop_rect_for_region(region: &OcrRegion, width: u32, height: u32) -> (u32, u32, u32, u32) {
    let x = (region.x * width as f64).round() as u32;
    let y = (region.y * height as f64).round() as u32;
    let w = (region.width * width as f64).round().max(1.0) as u32;
    let h = (region.height * height as f64).round().max(1.0) as u32;
    (
        x,
        y,
        w.min(width.saturating_sub(x)),
        h.min(height.saturating_sub(y)),
    )
}

fn content_rect_for_source_dimensions(
    source: SourceVideoDimensions,
    output_spec: OcrFrameOutputSpec,
) -> ContentRect {
    let source_width = source.width as f64;
    let source_height = source.height as f64;
    let output_width = output_spec.width as f64;
    let output_height = output_spec.height as f64;
    let scale = (output_width / source_width).min(output_height / source_height);
    let content_width = (source_width * scale).round().clamp(1.0, output_width) as u32;
    let content_height = (source_height * scale).round().clamp(1.0, output_height) as u32;

    ContentRect {
        x: output_spec.width.saturating_sub(content_width) / 2,
        y: output_spec.height.saturating_sub(content_height) / 2,
        width: content_width,
        height: content_height,
    }
}

fn crop_rect_for_region_in_content_rect(
    region: &OcrRegion,
    content_rect: ContentRect,
) -> (u32, u32, u32, u32) {
    let (relative_x, relative_y, width, height) =
        crop_rect_for_region(region, content_rect.width, content_rect.height);
    (
        content_rect.x.saturating_add(relative_x),
        content_rect.y.saturating_add(relative_y),
        width,
        height,
    )
}

fn target_spec_for_zone(region: &OcrRegion) -> OcrFrameOutputSpec {
    if region.width >= 0.95 && region.height >= 0.95 {
        OcrFrameOutputSpec {
            width: FULL_OCR_FRAME_WIDTH,
            height: FULL_OCR_FRAME_HEIGHT,
        }
    } else {
        OcrFrameOutputSpec {
            width: REGION_OCR_FRAME_WIDTH,
            height: REGION_OCR_FRAME_HEIGHT,
        }
    }
}

fn zone_result_key(segment_id: &str, zone_id: &str) -> String {
    format!("{}::{}", segment_id, zone_id)
}

fn summarize_zone_ocr_results(
    frame: &StreamedFrame,
    active_zone: &ActiveZone<'_>,
    ocr_results: &[ocr_rs::OcrResult_],
) -> OcrFrameResult {
    let mut frame_result = summarize_ocr_results(frame.frame_index, frame.time_ms, ocr_results);
    frame_result.segment_id = Some(active_zone.segment_id.to_string());
    frame_result.zone_id = Some(active_zone.zone.id.clone());
    frame_result.role = Some(active_zone.zone.role.clone());
    frame_result.region = Some(active_zone.zone.region.clone());
    frame_result
}

fn empty_zone_frame_result(frame: &StreamedFrame, active_zone: &ActiveZone<'_>) -> OcrFrameResult {
    OcrFrameResult {
        frame_index: frame.frame_index,
        time_ms: frame.time_ms,
        text: String::new(),
        confidence: 0.0,
        segment_id: Some(active_zone.segment_id.to_string()),
        zone_id: Some(active_zone.zone.id.clone()),
        role: Some(active_zone.zone.role.clone()),
        region: Some(active_zone.zone.region.clone()),
    }
}

fn emit_live_detection(ctx: Option<&LiveDetectionContext>, detection: &OcrFrameResult) {
    if detection.text.trim().is_empty() {
        return;
    }

    if let Some(ctx) = ctx {
        let _ = ctx.app.emit(
            "ocr-live-detection",
            OcrLiveDetectionEvent {
                file_id: ctx.file_id.clone(),
                operation_id: Some(ctx.operation_id.clone()),
                detection: detection.clone(),
            },
        );
    }
}

#[derive(Clone)]
struct PipelineProgressContext {
    app: tauri::AppHandle,
    file_id: String,
    operation_id: String,
    extraction: OcrProgressEmitter,
    ocr: OcrProgressEmitter,
}

impl PipelineProgressContext {
    fn new(
        app: tauri::AppHandle,
        file_id: String,
        operation_id: String,
        estimated_frames: u32,
    ) -> Self {
        Self {
            extraction: OcrProgressEmitter::new(
                app.clone(),
                file_id.clone(),
                Some(operation_id.clone()),
                "extracting",
                estimated_frames,
            ),
            ocr: OcrProgressEmitter::new(
                app.clone(),
                file_id.clone(),
                Some(operation_id.clone()),
                "ocr",
                estimated_frames,
            ),
            app,
            file_id,
            operation_id,
        }
    }

    fn emit_extraction_complete(&self, frame_count: u32) {
        OcrProgressEmitter::new(
            self.app.clone(),
            self.file_id.clone(),
            Some(self.operation_id.clone()),
            "extracting",
            frame_count,
        )
        .emit_force(frame_count, format!("Extracted {} frames", frame_count));
    }

    fn emit_ocr_complete(&self, frame_count: u32) {
        OcrProgressEmitter::new(
            self.app.clone(),
            self.file_id.clone(),
            Some(self.operation_id.clone()),
            "ocr",
            frame_count,
        )
        .emit_force(frame_count, "OCR processing complete".to_string());
    }

    fn new_generating_emitter(&self, total: u32) -> OcrProgressEmitter {
        OcrProgressEmitter::new(
            self.app.clone(),
            self.file_id.clone(),
            Some(self.operation_id.clone()),
            "generating",
            total,
        )
    }
}

struct StreamedFrame {
    frame_index: u32,
    time_ms: u64,
    rgb_bytes: Vec<u8>,
}

enum WorkerMessage {
    Frame(StreamedFrame),
    Shutdown,
}

fn is_operation_cancelled(file_id: &str) -> bool {
    super::state::OCR_PROCESS_IDS
        .lock()
        .map(|guard| !guard.contains_key(file_id))
        .unwrap_or(false)
}

fn set_operation_pid(file_id: &str, pid: u32) {
    if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
        guard.insert(file_id.to_string(), pid);
    }
}

fn clear_operation_pid(file_id: &str) -> Option<u32> {
    super::state::OCR_PROCESS_IDS
        .lock()
        .ok()
        .and_then(|mut guard| guard.remove(file_id))
}

fn full_frame_output_spec() -> OcrFrameOutputSpec {
    OcrFrameOutputSpec {
        width: FULL_OCR_FRAME_WIDTH,
        height: FULL_OCR_FRAME_HEIGHT,
    }
}

fn build_ocr_filter_string(fps: f64, spec: OcrFrameOutputSpec) -> String {
    let mut filters = vec![format!("fps={}", fps)];
    filters.push(format!(
        "scale={}:{}:force_original_aspect_ratio=decrease",
        spec.width, spec.height
    ));
    filters.push(format!(
        "pad={}:{}:(ow-iw)/2:(oh-ih)/2",
        spec.width, spec.height
    ));
    filters.push("format=rgb24".to_string());
    filters.join(",")
}

fn selection_time_bounds_ms(selection: &OcrSelection) -> Option<(u64, u64)> {
    let start_time_ms = selection
        .segments
        .iter()
        .map(|segment| segment.start_time_ms)
        .min()?;
    let end_time_ms = selection
        .segments
        .iter()
        .map(|segment| segment.end_time_ms)
        .max()?;

    if start_time_ms >= end_time_ms {
        None
    } else {
        Some((start_time_ms, end_time_ms))
    }
}

fn format_ffmpeg_seconds(time_ms: u64) -> String {
    format!("{:.3}", time_ms as f64 / 1000.0)
}

fn set_fatal_error(target: &Arc<Mutex<Option<String>>>, message: String) {
    if let Ok(mut guard) = target.lock() {
        if guard.is_none() {
            *guard = Some(message);
        }
    }
}

fn take_fatal_error(target: &Arc<Mutex<Option<String>>>) -> Option<String> {
    target.lock().ok().and_then(|mut guard| guard.take())
}

fn has_fatal_error(target: &Arc<Mutex<Option<String>>>) -> bool {
    target.lock().map(|guard| guard.is_some()).unwrap_or(false)
}

fn take_next_raw_frame(buffer: &mut Vec<u8>, frame_byte_len: usize) -> Option<Vec<u8>> {
    if buffer.len() < frame_byte_len {
        return None;
    }

    Some(buffer.drain(..frame_byte_len).collect())
}

async fn read_ffmpeg_rgb_stream(
    stdout: tokio::process::ChildStdout,
    fps: f64,
    output_spec: OcrFrameOutputSpec,
    start_time_ms: u64,
    frame_tx: tokio::sync::mpsc::Sender<StreamedFrame>,
) -> Result<u32, String> {
    let mut stdout = stdout;
    let mut read_buffer = vec![0_u8; 64 * 1024];
    let mut raw_buffer = Vec::with_capacity(output_spec.byte_len() * 2);
    let mut frame_index = 0_u32;
    let frame_duration_ms = 1000.0 / fps;
    let frame_byte_len = output_spec.byte_len();

    loop {
        let read_bytes = stdout
            .read(&mut read_buffer)
            .await
            .map_err(|error| format!("Failed to read streamed OCR frames: {}", error))?;
        if read_bytes == 0 {
            break;
        }

        raw_buffer.extend_from_slice(&read_buffer[..read_bytes]);
        while let Some(frame_bytes) = take_next_raw_frame(&mut raw_buffer, frame_byte_len) {
            let time_ms = start_time_ms
                .saturating_add(((frame_index as f64) * frame_duration_ms).round() as u64);
            frame_tx
                .send(StreamedFrame {
                    frame_index,
                    time_ms,
                    rgb_bytes: frame_bytes,
                })
                .await
                .map_err(|_| "OCR frame channel closed unexpectedly".to_string())?;
            frame_index = frame_index.saturating_add(1);
        }
    }

    drop(frame_tx);

    if !raw_buffer.is_empty() {
        return Err("Incomplete raw OCR frame received from ffmpeg".to_string());
    }

    Ok(frame_index)
}

async fn read_ffmpeg_progress(
    stderr: tokio::process::ChildStderr,
    duration_us: Option<u64>,
    estimated_frames: u32,
    progress: Option<PipelineProgressContext>,
) -> Result<String, String> {
    let mut tracker = FfmpegProgressTracker::new(duration_us);
    let stderr_reader = BufReader::new(stderr);
    let mut lines = stderr_reader.lines();
    let mut error_lines: Vec<String> = Vec::new();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| format!("Failed to read ffmpeg progress: {}", error))?
    {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(update) = tracker.handle_line(trimmed) {
            if let (Some(progress_ctx), Some(percent)) = (progress.as_ref(), update.progress) {
                let current = if estimated_frames > 0 {
                    (((percent as f64) / 100.0) * estimated_frames as f64).round() as u32
                } else {
                    0
                };
                let message = if update.is_end {
                    "Finishing frame extraction...".to_string()
                } else {
                    format!("Extracting frame {}...", current.max(1))
                };
                progress_ctx.extraction.emit(current, message);
            }
            continue;
        }

        if trimmed.contains('=') {
            continue;
        }

        error_lines.push(trimmed.to_string());
    }

    Ok(error_lines.join("\n"))
}

fn process_streamed_frames(
    frame_rx: tokio::sync::mpsc::Receiver<StreamedFrame>,
    models_dir: &Path,
    language: &str,
    use_gpu: bool,
    output_spec: OcrFrameOutputSpec,
    content_rect: ContentRect,
    selection: OcrSelection,
    requested_workers: u32,
    progress: Option<OcrProgressEmitter>,
    total_frames_hint: u32,
    file_id: &str,
    live_detection: Option<LiveDetectionContext>,
) -> Result<(Vec<OcrFrameResult>, OcrPipelineTelemetry), String> {
    let worker_count = resolve_ocr_worker_count_for_backend(requested_workers, use_gpu);
    let engine_threads = resolve_ocr_engine_threads(worker_count);
    let enable_engine_parallel = worker_count == 1;
    let processed_frames = Arc::new(AtomicU32::new(0));
    let telemetry = Arc::new(OcrTelemetryCounters::new(worker_count, engine_threads));
    let fatal_error = Arc::new(Mutex::new(None));
    let results = Arc::new(Mutex::new(Vec::new()));

    let mut worker_senders = Vec::with_capacity(worker_count);
    let mut worker_handles = Vec::with_capacity(worker_count);

    for _worker_index in 0..worker_count {
        let (worker_tx, worker_rx) =
            std::sync::mpsc::sync_channel::<WorkerMessage>(WORKER_QUEUE_CAPACITY);
        worker_senders.push(worker_tx);

        let models_dir = models_dir.to_path_buf();
        let language = language.to_string();
        let file_id = file_id.to_string();
        let selection = selection.clone();
        let processed_frames = Arc::clone(&processed_frames);
        let telemetry = Arc::clone(&telemetry);
        let fatal_error = Arc::clone(&fatal_error);
        let results = Arc::clone(&results);
        let progress = progress.clone();
        let live_detection = live_detection.clone();

        worker_handles.push(std::thread::spawn(move || {
            let engine = match create_ocr_engine(
                &models_dir,
                &language,
                use_gpu,
                engine_threads,
                enable_engine_parallel,
            ) {
                Ok(engine) => engine,
                Err(error) => {
                    set_fatal_error(&fatal_error, error);
                    return;
                }
            };
            let mut previous_by_zone: HashMap<String, (FrameFingerprint, OcrFrameResult)> =
                HashMap::new();

            while let Ok(message) = worker_rx.recv() {
                match message {
                    WorkerMessage::Shutdown => break,
                    WorkerMessage::Frame(mut frame) => {
                        if is_operation_cancelled(&file_id) {
                            set_fatal_error(&fatal_error, "OCR cancelled".to_string());
                            break;
                        }

                        let image = match RgbImage::from_raw(
                            output_spec.width,
                            output_spec.height,
                            mem::take(&mut frame.rgb_bytes),
                        ) {
                            Some(image) => DynamicImage::ImageRgb8(image),
                            None => {
                                emit_processed_frame_progress(
                                    &processed_frames,
                                    progress.as_ref(),
                                    total_frames_hint,
                                );
                                continue;
                            }
                        };

                        let active_zones = active_zones_for_time(&selection, frame.time_ms);
                        if active_zones.is_empty() {
                            emit_processed_frame_progress(
                                &processed_frames,
                                progress.as_ref(),
                                total_frames_hint,
                            );
                            continue;
                        }

                        for active_zone in active_zones {
                            let zone_key =
                                zone_result_key(active_zone.segment_id, &active_zone.zone.id);
                            let (x, y, width, height) = crop_rect_for_region_in_content_rect(
                                &active_zone.zone.region,
                                content_rect,
                            );
                            if width == 0 || height == 0 {
                                continue;
                            }

                            let target_spec = target_spec_for_zone(&active_zone.zone.region);
                            let crop = image.crop_imm(x, y, width, height).resize_exact(
                                target_spec.width,
                                target_spec.height,
                                FilterType::Triangle,
                            );
                            let fingerprint = create_frame_fingerprint(&crop);
                            if is_low_detail_no_text(&fingerprint) {
                                let frame_result = empty_zone_frame_result(&frame, &active_zone);
                                if let Err(error) = push_ocr_result(&results, frame_result.clone())
                                {
                                    set_fatal_error(&fatal_error, error);
                                    break;
                                }
                                previous_by_zone.insert(zone_key, (fingerprint, frame_result));
                                telemetry
                                    .no_text_skipped_frames
                                    .fetch_add(1, Ordering::Relaxed);
                                continue;
                            }

                            if let Some((prev_fingerprint, prev_result)) =
                                previous_by_zone.get(&zone_key)
                            {
                                if can_clone_previous_frame_result(
                                    &frame,
                                    &fingerprint,
                                    prev_result,
                                    prev_fingerprint,
                                ) {
                                    let frame_result =
                                        clone_frame_result_for_frame(prev_result, &frame);
                                    emit_live_detection(live_detection.as_ref(), &frame_result);
                                    if let Err(error) =
                                        push_ocr_result(&results, frame_result.clone())
                                    {
                                        set_fatal_error(&fatal_error, error);
                                        break;
                                    }
                                    previous_by_zone.insert(zone_key, (fingerprint, frame_result));
                                    telemetry
                                        .unchanged_skipped_frames
                                        .fetch_add(1, Ordering::Relaxed);
                                    continue;
                                }
                            }

                            telemetry
                                .ocr_attempted_frames
                                .fetch_add(1, Ordering::Relaxed);
                            if let Ok(ocr_results) = engine.recognize(&crop) {
                                let frame_result =
                                    summarize_zone_ocr_results(&frame, &active_zone, &ocr_results);
                                if !frame_result.text.trim().is_empty() {
                                    telemetry.text_frames.fetch_add(1, Ordering::Relaxed);
                                }
                                previous_by_zone
                                    .insert(zone_key, (fingerprint, frame_result.clone()));
                                emit_live_detection(live_detection.as_ref(), &frame_result);
                                if let Err(error) = push_ocr_result(&results, frame_result) {
                                    set_fatal_error(&fatal_error, error);
                                    break;
                                }
                            }
                        }

                        emit_processed_frame_progress(
                            &processed_frames,
                            progress.as_ref(),
                            total_frames_hint,
                        );
                    }
                }

                if has_fatal_error(&fatal_error) {
                    break;
                }
            }
        }));
    }

    let dispatch_result = (|| -> Result<(), String> {
        let mut frame_rx = frame_rx;
        let mut next_worker = 0_usize;
        let mut frames_sent_to_worker = 0_usize;

        while let Some(frame) = frame_rx.blocking_recv() {
            if has_fatal_error(&fatal_error) {
                return Err(take_fatal_error(&fatal_error)
                    .unwrap_or_else(|| "OCR processing failed".to_string()));
            }

            if is_operation_cancelled(file_id) {
                return Err("OCR cancelled".to_string());
            }

            worker_senders[next_worker]
                .send(WorkerMessage::Frame(frame))
                .map_err(|_| "Failed to dispatch OCR frame to worker".to_string())?;
            frames_sent_to_worker += 1;
            if frames_sent_to_worker >= WORKER_DISPATCH_CHUNK_SIZE {
                next_worker = (next_worker + 1) % worker_count;
                frames_sent_to_worker = 0;
            }
        }

        Ok(())
    })();

    for worker_sender in worker_senders {
        let _ = worker_sender.send(WorkerMessage::Shutdown);
    }

    for worker_handle in worker_handles {
        if worker_handle.join().is_err() {
            return Err("OCR worker thread panicked".to_string());
        }
    }

    dispatch_result?;

    if let Some(error) = take_fatal_error(&fatal_error) {
        return Err(error);
    }

    let mut guard = results
        .lock()
        .map_err(|_| "Failed to collect OCR results".to_string())?;
    let mut collected = mem::take(&mut *guard);
    drop(guard);
    collected.sort_by_key(|result| result.frame_index);
    Ok((collected, telemetry.snapshot(0)))
}

async fn run_ocr_pipeline_with_bins(
    ffmpeg_path: &str,
    video_path: &str,
    file_id: &str,
    models_dir: &Path,
    source_dimensions: SourceVideoDimensions,
    language: &str,
    fps: f64,
    use_gpu: bool,
    requested_workers: u32,
    min_confidence: f64,
    cleanup: OcrSubtitleCleanupOptions,
    selection: OcrSelection,
    duration_us: Option<u64>,
    _estimated_frames: u32,
    progress: Option<PipelineProgressContext>,
) -> Result<OcrPipelineResult, String> {
    validate_media_path(video_path)?;

    if fps <= 0.0 {
        return Err("FPS must be greater than 0".to_string());
    }

    let result = async {
        let total_timer = Instant::now();
        let output_spec = full_frame_output_spec();
        let content_rect = content_rect_for_source_dimensions(source_dimensions, output_spec);
        let filter_str = build_ocr_filter_string(fps, output_spec);
        let (selection_start_time_ms, selection_end_time_ms) =
            selection_time_bounds_ms(&selection).unwrap_or((0, duration_us.unwrap_or(0) / 1000));
        let selection_duration_ms = selection_end_time_ms.saturating_sub(selection_start_time_ms);
        let seek_start_seconds = format_ffmpeg_seconds(selection_start_time_ms);
        let seek_duration_seconds = format_ffmpeg_seconds(selection_duration_ms);

        let mut ffmpeg_args = vec![
            "-y".to_string(),
            "-v".to_string(),
            "error".to_string(),
            "-nostats".to_string(),
        ];
        if selection_start_time_ms > 0 {
            ffmpeg_args.push("-ss".to_string());
            ffmpeg_args.push(seek_start_seconds);
        }
        ffmpeg_args.push("-i".to_string());
        ffmpeg_args.push(video_path.to_string());
        if selection_duration_ms > 0 {
            ffmpeg_args.push("-t".to_string());
            ffmpeg_args.push(seek_duration_seconds);
        }
        ffmpeg_args.extend([
            "-vf".to_string(),
            filter_str,
            "-pix_fmt".to_string(),
            "rgb24".to_string(),
            "-f".to_string(),
            "rawvideo".to_string(),
            "-progress".to_string(),
            "pipe:2".to_string(),
            "pipe:1".to_string(),
        ]);

        let selected_duration_us = selection_duration_ms.saturating_mul(1000);
        let selected_frame_estimate =
            (((selection_duration_ms as f64 / 1000.0) * fps).ceil() as u32).saturating_add(1);

        let mut child = tokio::process::Command::new(ffmpeg_path)
            .args(ffmpeg_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start ffmpeg: {}", error))?;

        let child_pid = child.id().unwrap_or(0);
        set_operation_pid(file_id, child_pid);

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture ffmpeg stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture ffmpeg stderr".to_string())?;

        let extraction_start = Instant::now();
        let (frame_tx, frame_rx) = tokio::sync::mpsc::channel(FRAME_CHANNEL_CAPACITY);
        let stderr_progress = progress.clone();
        let stderr_task = tokio::spawn(read_ffmpeg_progress(
            stderr,
            Some(selected_duration_us),
            selected_frame_estimate,
            stderr_progress,
        ));
        let stream_reader_task = tokio::spawn(read_ffmpeg_rgb_stream(
            stdout,
            fps,
            output_spec,
            selection_start_time_ms,
            frame_tx,
        ));

        let ocr_start = Instant::now();
        let ocr_progress = progress.as_ref().map(|progress| progress.ocr.clone());
        let live_detection = progress.as_ref().map(|progress| LiveDetectionContext {
            app: progress.app.clone(),
            file_id: progress.file_id.clone(),
            operation_id: progress.operation_id.clone(),
        });
        let models_dir = models_dir.to_path_buf();
        let language = language.to_string();
        let file_id_owned = file_id.to_string();
        let ocr_task = tokio::task::spawn_blocking(move || {
            process_streamed_frames(
                frame_rx,
                &models_dir,
                &language,
                use_gpu,
                output_spec,
                content_rect,
                selection,
                requested_workers,
                ocr_progress,
                selected_frame_estimate,
                &file_id_owned,
                live_detection,
            )
        });

        let wait_status = timeout(OCR_PIPELINE_TIMEOUT, child.wait())
            .await
            .map_err(|_| {
                terminate_process(child_pid);
                format!(
                    "OCR pipeline timeout after {} seconds",
                    OCR_PIPELINE_TIMEOUT.as_secs()
                )
            })?
            .map_err(|error| format!("Failed to wait for ffmpeg: {}", error))?;

        if !is_operation_cancelled(file_id) {
            set_operation_pid(file_id, 0);
        }

        let was_cancelled = is_operation_cancelled(file_id);

        let stderr_output = match stderr_task.await {
            Ok(Ok(output)) => output,
            Ok(Err(_)) | Err(_) if was_cancelled => String::new(),
            Ok(Err(error)) => return Err(error),
            Err(error) => return Err(format!("FFmpeg progress task failed: {}", error)),
        };
        let frame_count = match stream_reader_task.await {
            Ok(Ok(frame_count)) => frame_count,
            Ok(Err(_)) | Err(_) if was_cancelled => 0,
            Ok(Err(error)) => return Err(error),
            Err(error) => return Err(format!("Stream reader task failed: {}", error)),
        };
        let extract_ms = extraction_start.elapsed().as_millis() as u64;

        if let Some(progress) = progress.as_ref() {
            progress.emit_extraction_complete(frame_count);
        }

        if was_cancelled {
            let _ = ocr_task.await;
            return Err("OCR cancelled".to_string());
        }

        if !wait_status.success() {
            if stderr_output.trim().is_empty() {
                return Err(format!(
                    "Frame extraction failed with status {}",
                    wait_status
                ));
            }
            return Err(format!("Frame extraction failed: {}", stderr_output));
        }

        let (raw_ocr, mut telemetry) = ocr_task
            .await
            .map_err(|error| format!("OCR processing task failed: {}", error))??;
        telemetry.extracted_frames = frame_count;
        let ocr_ms = ocr_start.elapsed().as_millis() as u64;

        if is_operation_cancelled(file_id) {
            return Err("OCR cancelled".to_string());
        }

        if let Some(progress) = progress.as_ref() {
            progress.emit_ocr_complete(frame_count);
        }

        let subtitle_start = Instant::now();
        let generating_progress = progress
            .as_ref()
            .map(|progress| progress.new_generating_emitter(raw_ocr.len() as u32));
        if let Some(progress) = generating_progress.as_ref() {
            progress.emit_force(0, "Generating subtitles...".to_string());
        }

        let subtitles =
            generate_subtitles_core(&raw_ocr, fps, min_confidence, cleanup, |current, total| {
                if let Some(progress) = generating_progress.as_ref() {
                    progress.emit(
                        current as u32,
                        format!("Processing frame {}/{}...", current, total),
                    );
                }
            })?;
        let subtitle_ms = subtitle_start.elapsed().as_millis() as u64;

        if let Some(progress) = generating_progress.as_ref() {
            progress.emit_force(
                raw_ocr.len() as u32,
                format!("Generated {} subtitles", subtitles.len()),
            );
        }

        Ok(OcrPipelineResult {
            frame_count,
            raw_ocr,
            subtitles,
            timings: OcrPipelineTimings {
                extract_ms,
                ocr_ms,
                subtitle_ms,
                total_ms: total_timer.elapsed().as_millis() as u64,
            },
            telemetry,
        })
    }
    .await;

    if result.is_err() {
        if let Some(pid) = clear_operation_pid(file_id) {
            terminate_process(pid);
        }
    } else {
        clear_operation_pid(file_id);
    }

    result
}

#[tauri::command]
pub(crate) async fn run_ocr_pipeline(
    app: tauri::AppHandle,
    video_path: String,
    file_id: String,
    operation_id: String,
    language: String,
    fps: f64,
    use_gpu: bool,
    num_workers: u32,
    min_confidence: f64,
    cleanup: Option<OcrSubtitleCleanupOptions>,
    selection: OcrSelection,
) -> Result<OcrPipelineResult, String> {
    validate_media_path(&video_path)?;

    if fps <= 0.0 {
        return Err("FPS must be greater than 0".to_string());
    }

    let _sleep_guard = SleepInhibitGuard::try_acquire("Running OCR pipeline").ok();
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let ffprobe_path = resolve_ffprobe_path(&app)?;
    let models_dir = get_ocr_models_dir(&app)?;
    let source_dimensions = get_primary_video_dimensions_with_ffprobe(&ffprobe_path, &video_path)
        .await
        .map(|dimensions| SourceVideoDimensions {
            width: dimensions.width,
            height: dimensions.height,
        })
        .map_err(|error| format!("Failed to get source video dimensions for OCR: {}", error))?;
    let duration_us = get_media_duration_us(&app, &video_path).await.ok();
    let duration_ms = duration_us
        .map(|duration_us| duration_us / 1000)
        .unwrap_or_else(|| {
            selection
                .segments
                .iter()
                .map(|segment| segment.end_time_ms)
                .max()
                .unwrap_or(1)
        });
    validate_ocr_selection(&selection, duration_ms)?;
    let selected_duration_ms = selection_time_bounds_ms(&selection)
        .map(|(start_time_ms, end_time_ms)| end_time_ms.saturating_sub(start_time_ms))
        .unwrap_or(duration_ms);
    let estimated_frames =
        (((selected_duration_ms as f64 / 1000.0) * fps).ceil() as u32).saturating_add(1);

    let progress =
        PipelineProgressContext::new(app, file_id.clone(), operation_id, estimated_frames);
    progress
        .extraction
        .emit_force(0, "Starting frame extraction...".to_string());

    run_ocr_pipeline_with_bins(
        &ffmpeg_path,
        &video_path,
        &file_id,
        &models_dir,
        source_dimensions,
        &language,
        fps,
        use_gpu,
        num_workers,
        min_confidence,
        cleanup.unwrap_or_default(),
        selection,
        duration_us,
        estimated_frames,
        Some(progress),
    )
    .await
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::time::Duration;

    use serial_test::serial;

    use image::{DynamicImage, ImageBuffer, Rgba};

    use crate::tools::ocr::{
        OcrFrameResult, OcrRegion, OcrSegment, OcrSelection, OcrSubtitleCleanupOptions, OcrZone,
        OcrZoneRole,
    };

    use super::{
        SourceVideoDimensions, build_ocr_filter_string, can_clone_previous_frame_result,
        clone_frame_result_for_frame, create_frame_fingerprint, empty_frame_result,
        full_frame_output_spec, get_primary_video_dimensions_with_ffprobe, is_low_detail_no_text,
        is_visually_unchanged, run_ocr_pipeline_with_bins, take_next_raw_frame,
    };

    async fn ensure_models_dir() -> Result<std::path::PathBuf, String> {
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

    fn default_cleanup() -> OcrSubtitleCleanupOptions {
        OcrSubtitleCleanupOptions::default()
    }

    fn default_source_dimensions() -> SourceVideoDimensions {
        SourceVideoDimensions {
            width: 160,
            height: 90,
        }
    }

    fn default_selection() -> OcrSelection {
        OcrSelection {
            segments: vec![OcrSegment {
                id: "default-segment".to_string(),
                start_time_ms: 0,
                end_time_ms: 60_000,
                zones: vec![OcrZone {
                    id: "default-zone".to_string(),
                    role: OcrZoneRole::MainSubtitle,
                    region: OcrRegion {
                        x: 0.0,
                        y: 0.75,
                        width: 1.0,
                        height: 0.25,
                    },
                    label: None,
                }],
            }],
        }
    }

    fn full_frame_selection() -> OcrSelection {
        OcrSelection {
            segments: vec![OcrSegment {
                id: "full-frame-segment".to_string(),
                start_time_ms: 0,
                end_time_ms: 60_000,
                zones: vec![OcrZone {
                    id: "full-frame-zone".to_string(),
                    role: OcrZoneRole::MainSubtitle,
                    region: OcrRegion {
                        x: 0.0,
                        y: 0.0,
                        width: 1.0,
                        height: 1.0,
                    },
                    label: None,
                }],
            }],
        }
    }

    fn selection_with_overlap() -> OcrSelection {
        OcrSelection {
            segments: vec![
                OcrSegment {
                    id: "dialogue-segment".to_string(),
                    start_time_ms: 0,
                    end_time_ms: 5_000,
                    zones: vec![OcrZone {
                        id: "dialogue-zone".to_string(),
                        role: OcrZoneRole::MainSubtitle,
                        region: OcrRegion {
                            x: 0.0,
                            y: 0.75,
                            width: 1.0,
                            height: 0.25,
                        },
                        label: None,
                    }],
                },
                OcrSegment {
                    id: "sign-segment".to_string(),
                    start_time_ms: 1_000,
                    end_time_ms: 4_000,
                    zones: vec![OcrZone {
                        id: "sign-zone".to_string(),
                        role: OcrZoneRole::OnScreenText,
                        region: OcrRegion {
                            x: 0.25,
                            y: 0.2,
                            width: 0.3,
                            height: 0.2,
                        },
                        label: Some("Sign".to_string()),
                    }],
                },
            ],
        }
    }

    fn normalized_words(text: &str) -> Vec<String> {
        text.chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() {
                    character.to_ascii_uppercase()
                } else {
                    ' '
                }
            })
            .collect::<String>()
            .split_whitespace()
            .map(|word| word.to_string())
            .collect()
    }

    fn assert_contains_expected_ocr_words(
        results: &[crate::tools::ocr::OcrFrameResult],
        expected: &str,
    ) {
        let mut observed = HashSet::new();
        for result in results {
            for word in normalized_words(&result.text) {
                observed.insert(word);
            }
        }

        for word in normalized_words(expected) {
            assert!(
                observed.contains(&word),
                "expected OCR output to contain word '{}', observed words: {:?}",
                word,
                observed
            );
        }
    }

    fn solid_image(width: u32, height: u32, value: u8) -> DynamicImage {
        DynamicImage::ImageRgba8(ImageBuffer::from_pixel(
            width,
            height,
            Rgba([value, value, value, 255]),
        ))
    }

    fn text_like_image() -> DynamicImage {
        let mut image = ImageBuffer::from_pixel(320, 96, Rgba([12, 12, 12, 255]));
        for y in 34..62 {
            for x in 48..272 {
                if (x / 8 + y / 6) % 2 == 0 {
                    image.put_pixel(x, y, Rgba([245, 245, 245, 255]));
                }
            }
        }
        DynamicImage::ImageRgba8(image)
    }

    fn text_variant_image(variant: u8) -> DynamicImage {
        let mut image = ImageBuffer::from_pixel(320, 96, Rgba([12, 12, 12, 255]));
        let bars = match variant {
            0 => [(72, 38, 88, 62), (112, 38, 128, 62), (152, 38, 168, 62)],
            _ => [(92, 38, 108, 62), (132, 38, 148, 62), (172, 38, 188, 62)],
        };

        for (x_start, y_start, x_end, y_end) in bars {
            for y in y_start..y_end {
                for x in x_start..x_end {
                    image.put_pixel(x, y, Rgba([245, 245, 245, 255]));
                }
            }
        }

        DynamicImage::ImageRgba8(image)
    }

    fn same_density_text_variant_image(variant: u8) -> DynamicImage {
        let mut image = ImageBuffer::from_pixel(320, 96, Rgba([12, 12, 12, 255]));
        let boxes = [(72, 36, 104, 64), (124, 36, 156, 64), (176, 36, 208, 64)];
        for (x_start, y_start, x_end, y_end) in boxes {
            match variant {
                0 => {
                    for x in [x_start + 8, x_start + 20] {
                        for y in y_start..y_end {
                            image.put_pixel(x, y, Rgba([245, 245, 245, 255]));
                            image.put_pixel(x + 1, y, Rgba([245, 245, 245, 255]));
                        }
                    }
                }
                _ => {
                    for y in [y_start + 8, y_start + 20] {
                        for x in x_start..x_end {
                            image.put_pixel(x, y, Rgba([245, 245, 245, 255]));
                            image.put_pixel(x, y + 1, Rgba([245, 245, 245, 255]));
                        }
                    }
                }
            }
        }

        DynamicImage::ImageRgba8(image)
    }

    #[test]
    fn frame_fingerprint_marks_identical_frames_as_unchanged() {
        let previous = create_frame_fingerprint(&solid_image(320, 96, 24));
        let current = create_frame_fingerprint(&solid_image(320, 96, 25));

        assert!(is_visually_unchanged(&current, &previous));
    }

    #[test]
    fn frame_fingerprint_rejects_subtitle_text_changes() {
        let previous = create_frame_fingerprint(&text_variant_image(0));
        let current = create_frame_fingerprint(&text_variant_image(1));

        assert!(!is_visually_unchanged(&current, &previous));
    }

    #[test]
    fn frame_fingerprint_rejects_same_density_glyph_changes() {
        let previous = create_frame_fingerprint(&same_density_text_variant_image(0));
        let current = create_frame_fingerprint(&same_density_text_variant_image(1));

        assert!(!is_visually_unchanged(&current, &previous));
    }

    #[test]
    fn low_detail_detector_skips_blank_regions_but_not_text_like_regions() {
        let blank = create_frame_fingerprint(&solid_image(320, 96, 8));
        let text_like = create_frame_fingerprint(&text_like_image());

        assert!(is_low_detail_no_text(&blank));
        assert!(!is_low_detail_no_text(&text_like));
    }

    #[test]
    fn cloned_frame_result_preserves_text_with_new_timing() {
        let previous = OcrFrameResult {
            frame_index: 7,
            time_ms: 1400,
            text: "hello".to_string(),
            confidence: 0.82,
            segment_id: None,
            zone_id: None,
            role: None,
            region: None,
        };
        let frame = super::StreamedFrame {
            frame_index: 8,
            time_ms: 1600,
            rgb_bytes: Vec::new(),
        };

        let cloned = clone_frame_result_for_frame(&previous, &frame);

        assert_eq!(cloned.frame_index, 8);
        assert_eq!(cloned.time_ms, 1600);
        assert_eq!(cloned.text, "hello");
        assert_eq!(cloned.confidence, 0.82);
    }

    #[test]
    fn empty_frame_result_keeps_frame_timing() {
        let frame = super::StreamedFrame {
            frame_index: 12,
            time_ms: 2400,
            rgb_bytes: Vec::new(),
        };

        let result = empty_frame_result(&frame);

        assert_eq!(result.frame_index, 12);
        assert_eq!(result.time_ms, 2400);
        assert!(result.text.is_empty());
        assert_eq!(result.confidence, 0.0);
    }

    #[test]
    fn duplicate_skip_only_reuses_consecutive_frames() {
        let previous_fingerprint = create_frame_fingerprint(&solid_image(320, 96, 24));
        let current_fingerprint = create_frame_fingerprint(&solid_image(320, 96, 24));
        let previous = OcrFrameResult {
            frame_index: 3,
            time_ms: 600,
            text: "old text".to_string(),
            confidence: 0.9,
            segment_id: None,
            zone_id: None,
            role: None,
            region: None,
        };
        let consecutive = super::StreamedFrame {
            frame_index: 4,
            time_ms: 800,
            rgb_bytes: Vec::new(),
        };
        let non_consecutive = super::StreamedFrame {
            frame_index: 8,
            time_ms: 1600,
            rgb_bytes: Vec::new(),
        };

        assert!(can_clone_previous_frame_result(
            &consecutive,
            &current_fingerprint,
            &previous,
            &previous_fingerprint,
        ));
        assert!(!can_clone_previous_frame_result(
            &non_consecutive,
            &current_fingerprint,
            &previous,
            &previous_fingerprint,
        ));
    }

    #[test]
    fn duplicate_skip_does_not_reuse_changed_subtitle_text() {
        let previous_fingerprint = create_frame_fingerprint(&text_variant_image(0));
        let current_fingerprint = create_frame_fingerprint(&text_variant_image(1));
        let previous = OcrFrameResult {
            frame_index: 3,
            time_ms: 600,
            text: "old text".to_string(),
            confidence: 0.9,
            segment_id: None,
            zone_id: None,
            role: None,
            region: None,
        };
        let next = super::StreamedFrame {
            frame_index: 4,
            time_ms: 800,
            rgb_bytes: Vec::new(),
        };

        assert!(!can_clone_previous_frame_result(
            &next,
            &current_fingerprint,
            &previous,
            &previous_fingerprint,
        ));
    }

    #[test]
    fn take_next_raw_frame_handles_partial_reads() {
        let raw_frame = vec![42; 12];
        let mut buffer = raw_frame[..6].to_vec();
        assert!(take_next_raw_frame(&mut buffer, raw_frame.len()).is_none());

        buffer.extend_from_slice(&raw_frame[6..]);
        let frame = take_next_raw_frame(&mut buffer, raw_frame.len())
            .expect("complete raw frame should be extracted");
        assert_eq!(frame, raw_frame);
        assert!(buffer.is_empty());
    }

    #[test]
    fn take_next_raw_frame_extracts_multiple_concatenated_frames() {
        let first = vec![1; 6];
        let second = vec![2; 6];
        let mut buffer = first.clone();
        buffer.extend_from_slice(&second);

        let extracted_first =
            take_next_raw_frame(&mut buffer, 6).expect("first frame should exist");
        assert_eq!(extracted_first, first);

        let extracted_second =
            take_next_raw_frame(&mut buffer, 6).expect("second frame should exist");
        assert_eq!(extracted_second, second);
        assert!(buffer.is_empty());
    }

    #[test]
    fn active_zones_for_time_returns_union_from_overlapping_segments() {
        let selection = selection_with_overlap();
        let active = super::active_zones_for_time(&selection, 2500);

        assert_eq!(active.len(), 2);
        assert_eq!(active[0].zone.id, "dialogue-zone");
        assert_eq!(active[1].zone.id, "sign-zone");
    }

    #[test]
    fn selection_time_bounds_cover_active_segment_envelope() {
        let selection = selection_with_overlap();

        assert_eq!(
            super::selection_time_bounds_ms(&selection),
            Some((0, 5_000))
        );
    }

    #[test]
    fn ffmpeg_seconds_are_millisecond_precise() {
        assert_eq!(super::format_ffmpeg_seconds(12_345), "12.345");
    }

    #[test]
    fn crop_region_to_image_bounds_scales_relative_region() {
        let rect = super::crop_rect_for_region(
            &OcrRegion {
                x: 0.25,
                y: 0.5,
                width: 0.5,
                height: 0.25,
            },
            1920,
            1080,
        );

        assert_eq!(rect, (480, 540, 960, 270));
    }

    #[test]
    fn content_rect_for_16_9_source_uses_full_ocr_frame() {
        let rect = super::content_rect_for_source_dimensions(
            super::SourceVideoDimensions {
                width: 1920,
                height: 1080,
            },
            super::full_frame_output_spec(),
        );

        assert_eq!(
            rect,
            super::ContentRect {
                x: 0,
                y: 0,
                width: 960,
                height: 540,
            }
        );
    }

    #[test]
    fn content_rect_for_4_3_source_excludes_pillarbox_bars() {
        let rect = super::content_rect_for_source_dimensions(
            super::SourceVideoDimensions {
                width: 1440,
                height: 1080,
            },
            super::full_frame_output_spec(),
        );

        assert_eq!(
            rect,
            super::ContentRect {
                x: 120,
                y: 0,
                width: 720,
                height: 540,
            }
        );
    }

    #[test]
    fn content_rect_for_portrait_source_excludes_pillarbox_bars() {
        let rect = super::content_rect_for_source_dimensions(
            super::SourceVideoDimensions {
                width: 1080,
                height: 1920,
            },
            super::full_frame_output_spec(),
        );

        assert_eq!(
            rect,
            super::ContentRect {
                x: 328,
                y: 0,
                width: 304,
                height: 540,
            }
        );
    }

    #[test]
    fn crop_region_maps_into_active_content_rect() {
        let content_rect = super::ContentRect {
            x: 120,
            y: 0,
            width: 720,
            height: 540,
        };

        let crop = super::crop_rect_for_region_in_content_rect(
            &OcrRegion {
                x: 0.25,
                y: 0.5,
                width: 0.5,
                height: 0.25,
            },
            content_rect,
        );

        assert_eq!(crop, (300, 270, 360, 135));
    }

    #[test]
    fn full_frame_filter_scales_to_fixed_rgb_frame() {
        let spec = full_frame_output_spec();
        let filter = build_ocr_filter_string(5.0, spec);

        assert!(filter.contains("scale=960:540:force_original_aspect_ratio=decrease"));
        assert!(filter.contains("pad=960:540:(ow-iw)/2:(oh-ih)/2"));
        assert!(filter.ends_with("format=rgb24"));
    }

    #[tokio::test]
    async fn run_ocr_pipeline_returns_results_for_sample_video() {
        let video = crate::test_support::assets::ensure_ocr_video()
            .await
            .expect("failed to prepare ocr video");
        let models_dir = ensure_models_dir().await.expect("models should exist");
        let result = run_ocr_pipeline_with_bins(
            crate::test_support::ffmpeg::ffmpeg_path(),
            video.to_string_lossy().as_ref(),
            "sample-pipeline",
            &models_dir,
            default_source_dimensions(),
            "multi",
            1.0,
            false,
            1,
            0.5,
            default_cleanup(),
            full_frame_selection(),
            None,
            100,
            None,
        )
        .await
        .expect("pipeline should succeed");

        assert!(!result.raw_ocr.is_empty());
        assert!(!result.subtitles.is_empty());
        assert_contains_expected_ocr_words(&result.raw_ocr, "HELLO OCR TEST");
    }

    #[tokio::test]
    #[serial]
    async fn run_ocr_pipeline_cancels_active_ffmpeg_process() {
        let video = crate::test_support::assets::ensure_ocr_video()
            .await
            .expect("failed to prepare ocr video");
        let models_dir = ensure_models_dir().await.expect("models should exist");
        let file_id = "cancel-streamed-ocr".to_string();

        let task = tokio::spawn({
            let video_path = video.to_string_lossy().to_string();
            let file_id = file_id.clone();
            let models_dir = models_dir.clone();
            async move {
                run_ocr_pipeline_with_bins(
                    crate::test_support::ffmpeg::ffmpeg_path(),
                    &video_path,
                    &file_id,
                    &models_dir,
                    default_source_dimensions(),
                    "multi",
                    30.0,
                    false,
                    1,
                    0.5,
                    default_cleanup(),
                    default_selection(),
                    None,
                    1000,
                    None,
                )
                .await
            }
        });

        tokio::time::sleep(Duration::from_millis(100)).await;
        crate::tools::ocr::cancel::cancel_ocr_operation(file_id.clone())
            .await
            .expect("cancel should succeed");

        let result = task.await.expect("pipeline task should resolve");
        let error = result.expect_err("pipeline should be cancelled");
        assert!(error.to_lowercase().contains("cancel"));
        assert!(
            !super::super::state::OCR_PROCESS_IDS
                .lock()
                .expect("ocr pid map should lock")
                .contains_key(&file_id)
        );
    }

    #[tokio::test]
    #[ignore]
    async fn benchmark_ocr_pipeline_from_env() {
        let video_path = std::env::var("MEDIAFLOW_OCR_BENCH_VIDEO")
            .expect("MEDIAFLOW_OCR_BENCH_VIDEO must point to a local benchmark video");
        let fps = std::env::var("MEDIAFLOW_OCR_BENCH_FPS")
            .ok()
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(5.0);
        let workers = std::env::var("MEDIAFLOW_OCR_BENCH_WORKERS")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(8);
        let use_gpu = std::env::var("MEDIAFLOW_OCR_BENCH_GPU")
            .map(|value| value != "0")
            .unwrap_or(true);
        let models_dir = ensure_models_dir().await.expect("models should exist");
        let source_dimensions = get_primary_video_dimensions_with_ffprobe(
            crate::test_support::ffmpeg::ffprobe_path(),
            &video_path,
        )
        .await
        .map(|dimensions| SourceVideoDimensions {
            width: dimensions.width,
            height: dimensions.height,
        })
        .expect("benchmark video dimensions should be available");
        let started_at = std::time::Instant::now();

        let result = run_ocr_pipeline_with_bins(
            crate::test_support::ffmpeg::ffmpeg_path(),
            &video_path,
            "bench-pipeline",
            &models_dir,
            source_dimensions,
            "multi",
            fps,
            use_gpu,
            workers,
            0.5,
            default_cleanup(),
            default_selection(),
            None,
            (60.0 * fps).ceil() as u32,
            None,
        )
        .await
        .expect("benchmark pipeline should succeed");

        println!(
            "OCR_BENCH total_wall_ms={} frame_count={} raw_ocr={} subtitles={} attempted={} text_frames={} skipped_unchanged={} skipped_no_text={} workers={} engine_threads={} extract_ms={} ocr_ms={} subtitle_ms={} total_ms={}",
            started_at.elapsed().as_millis(),
            result.frame_count,
            result.raw_ocr.len(),
            result.subtitles.len(),
            result.telemetry.ocr_attempted_frames,
            result.telemetry.text_frames,
            result.telemetry.unchanged_skipped_frames,
            result.telemetry.no_text_skipped_frames,
            result.telemetry.effective_workers,
            result.telemetry.engine_threads,
            result.timings.extract_ms,
            result.timings.ocr_ms,
            result.timings.subtitle_ms,
            result.timings.total_ms,
        );
    }
}
