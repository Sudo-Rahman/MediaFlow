use std::collections::VecDeque;
use std::fs::File;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use oxideav_core::{Error as OxideavError, Frame, ReadSeek, RuntimeContext, TimeBase, VideoFrame};

use crate::shared::validation::validate_media_path;
use crate::tools::subtitle_ocr::SubtitleOcrDecodedCue;

const DEFAULT_MISSING_CUE_DURATION_MS: u64 = 2_000;
const MIN_NORMALIZED_CUE_DURATION_MS: u64 = 250;
const MAX_NORMALIZED_CUE_DURATION_MS: u64 = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum BitmapSubtitleSource {
    Pgs {
        path: PathBuf,
    },
    VobSub {
        idx_path: PathBuf,
        sub_path: PathBuf,
    },
}

#[derive(Debug, Clone)]
pub(super) struct DecodedBitmapCue {
    pub(super) metadata: SubtitleOcrDecodedCue,
    pub(super) rgba: Vec<u8>,
}

#[tauri::command]
pub(crate) async fn decode_subtitle_ocr_bitmaps(
    source_path: String,
    idx_path: Option<String>,
    sub_path: Option<String>,
    item_id: String,
) -> Result<Vec<SubtitleOcrDecodedCue>, String> {
    if item_id.trim().is_empty() {
        return Err("Subtitle OCR item id is required".to_string());
    }

    let source =
        validate_bitmap_subtitle_source(&source_path, idx_path.as_deref(), sub_path.as_deref())?;
    super::state::begin_operation(&item_id)?;

    let item_id_for_task = item_id.clone();
    let join_result = tokio::task::spawn_blocking(move || {
        let mut decoded_metadata = Vec::new();
        decode_bitmap_subtitle_source_with_handler(&source, &item_id_for_task, |decoded| {
            decoded_metadata.push(decoded.metadata);
            Ok(())
        })?;
        Ok(decoded_metadata)
    })
    .await;

    let _ = super::state::clear_registered_operation(&item_id);
    let result = join_result.map_err(|e| format!("Subtitle OCR decode task failed: {}", e))?;
    if result.is_ok() {
        let _ = super::state::clear_cancelled(&item_id);
    }

    result
}

pub(super) fn validate_bitmap_subtitle_source(
    source_path: &str,
    idx_path: Option<&str>,
    sub_path: Option<&str>,
) -> Result<BitmapSubtitleSource, String> {
    let idx_path = non_empty_path(idx_path);
    let sub_path = non_empty_path(sub_path);

    match (idx_path, sub_path) {
        (Some(idx_path), Some(sub_path)) => {
            let idx_path = validate_existing_file_with_extension(idx_path, "idx")?;
            let sub_path = validate_existing_file_with_extension(sub_path, "sub")?;
            ensure_vobsub_pair_matches(&idx_path, &sub_path)?;
            return Ok(BitmapSubtitleSource::VobSub { idx_path, sub_path });
        }
        (Some(_), None) | (None, Some(_)) => {
            return Err("VobSub Subtitle OCR requires both .idx and .sub paths".to_string());
        }
        (None, None) => {}
    }

    let source = Path::new(source_path);
    match lower_extension(source).as_deref() {
        Some("sup") => {
            validate_media_path(source_path)?;
            Ok(BitmapSubtitleSource::Pgs {
                path: source.to_path_buf(),
            })
        }
        Some("idx") => {
            let idx_path = validate_existing_file_with_extension(source_path, "idx")?;
            let sub_path = source.with_extension("sub");
            if !sub_path.exists() {
                return Err(format!(
                    "VobSub .sub sidecar not found: {}",
                    sub_path.display()
                ));
            }
            validate_existing_file_with_extension(sub_path.to_string_lossy().as_ref(), "sub")?;
            ensure_vobsub_pair_matches(&idx_path, &sub_path)?;
            Ok(BitmapSubtitleSource::VobSub { idx_path, sub_path })
        }
        Some("sub") => {
            let sub_path = validate_existing_file_with_extension(source_path, "sub")?;
            let idx_path = source.with_extension("idx");
            if !idx_path.exists() {
                return Err(format!(
                    "VobSub .idx sidecar not found: {}",
                    idx_path.display()
                ));
            }
            validate_existing_file_with_extension(idx_path.to_string_lossy().as_ref(), "idx")?;
            ensure_vobsub_pair_matches(&idx_path, &sub_path)?;
            Ok(BitmapSubtitleSource::VobSub { idx_path, sub_path })
        }
        Some(ext) => Err(format!("Unsupported Subtitle OCR source type: .{}", ext)),
        None => Err("Subtitle OCR source path has no file extension".to_string()),
    }
}

pub(super) fn decode_bitmap_subtitle_source_with_handler<F>(
    source: &BitmapSubtitleSource,
    item_id: &str,
    mut handler: F,
) -> Result<(), String>
where
    F: FnMut(DecodedBitmapCue) -> Result<(), String>,
{
    let mut ctx = RuntimeContext::new();
    oxideav_sub_image::register(&mut ctx);

    let (container_id, source_key, input): (&str, String, Box<dyn ReadSeek>) = match source {
        BitmapSubtitleSource::Pgs { path } => {
            let file = File::open(path)
                .map_err(|e| format!("Failed to open PGS subtitle source: {}", e))?;
            ("pgs", path.to_string_lossy().to_string(), Box::new(file))
        }
        BitmapSubtitleSource::VobSub { idx_path, sub_path } => {
            let idx_text = std::fs::read_to_string(idx_path)
                .map_err(|e| format!("Failed to read VobSub .idx source: {}", e))?;
            let idx_text = with_oxideav_idx_path_hint(&idx_text, idx_path);
            (
                "vobsub",
                format!(
                    "{}|{}",
                    idx_path.to_string_lossy(),
                    sub_path.to_string_lossy()
                ),
                Box::new(Cursor::new(idx_text.into_bytes())),
            )
        }
    };

    let mut demuxer = ctx
        .containers
        .open_demuxer(container_id, input, &ctx.codecs)
        .map_err(|e| format!("Failed to open Subtitle OCR source: {}", e))?;
    let stream = demuxer
        .streams()
        .first()
        .ok_or_else(|| "Subtitle OCR source did not contain a subtitle stream".to_string())?
        .clone();
    let mut decoder = ctx
        .codecs
        .first_decoder(&stream.params)
        .map_err(|e| format!("Failed to create Subtitle OCR decoder: {}", e))?;

    let mut cue_index = 0usize;
    let mut normalizer = StreamingCueTimingNormalizer::new(&mut handler);
    loop {
        ensure_decode_not_cancelled(item_id)?;
        let packet = match demuxer.next_packet() {
            Ok(packet) => packet,
            Err(OxideavError::Eof) => break,
            Err(error) => return Err(format!("Failed to read Subtitle OCR packet: {}", error)),
        };

        if packet.stream_index != stream.index {
            continue;
        }

        let start_time_ms = packet
            .pts
            .map(|pts| timestamp_to_ms(pts, packet.time_base))
            .unwrap_or(0);
        let end_time_ms = packet
            .duration
            .map(|duration| {
                start_time_ms.saturating_add(timestamp_to_ms(duration, packet.time_base))
            })
            // OxideAV leaves the final bitmap subtitle packet duration unset when
            // the source does not encode a disappearance time.
            .unwrap_or(start_time_ms);

        decoder
            .send_packet(&packet)
            .map_err(|e| format!("Failed to decode Subtitle OCR packet: {}", e))?;
        drain_decoder_frames(
            decoder.as_mut(),
            &mut normalizer,
            &mut cue_index,
            item_id,
            &source_key,
            start_time_ms,
            end_time_ms,
        )?;
    }

    decoder
        .flush()
        .map_err(|e| format!("Failed to flush Subtitle OCR decoder: {}", e))?;
    drain_decoder_frames(
        decoder.as_mut(),
        &mut normalizer,
        &mut cue_index,
        item_id,
        &source_key,
        0,
        0,
    )?;
    normalizer.finish()
}

fn ensure_end_after_start(start_time_ms: u64, end_time_ms: u64) -> u64 {
    if end_time_ms > start_time_ms {
        end_time_ms
    } else {
        start_time_ms.saturating_add(1)
    }
}

struct StreamingCueTimingNormalizer<'handler, F>
where
    F: FnMut(DecodedBitmapCue) -> Result<(), String>,
{
    pending: VecDeque<DecodedBitmapCue>,
    previous_positive_duration: Option<u64>,
    handler: &'handler mut F,
}

impl<F> StreamingCueTimingNormalizer<'_, F>
where
    F: FnMut(DecodedBitmapCue) -> Result<(), String>,
{
    fn new(handler: &mut F) -> StreamingCueTimingNormalizer<'_, F> {
        StreamingCueTimingNormalizer {
            pending: VecDeque::new(),
            previous_positive_duration: None,
            handler,
        }
    }

    fn push(&mut self, cue: DecodedBitmapCue) -> Result<(), String> {
        self.flush_ready(Some(cue.metadata.start_time_ms))?;
        self.pending.push_back(cue);
        self.flush_ready(None)
    }

    fn finish(mut self) -> Result<(), String> {
        while let Some(mut cue) = self.pending.pop_front() {
            self.normalize_final_missing_duration(&mut cue);
            self.emit(cue)?;
        }

        Ok(())
    }

    fn flush_ready(&mut self, later_start_time_ms: Option<u64>) -> Result<(), String> {
        loop {
            let Some(front) = self.pending.front_mut() else {
                return Ok(());
            };
            let start_time_ms = front.metadata.start_time_ms;

            if front.metadata.end_time_ms <= start_time_ms {
                match later_start_time_ms {
                    Some(later_start_time_ms) if later_start_time_ms > start_time_ms => {
                        front.metadata.end_time_ms =
                            ensure_end_after_start(start_time_ms, later_start_time_ms);
                    }
                    _ => return Ok(()),
                }
            }

            let cue = self
                .pending
                .pop_front()
                .ok_or_else(|| "Subtitle OCR cue timing queue was empty".to_string())?;
            self.emit(cue)?;
        }
    }

    fn normalize_final_missing_duration(&self, cue: &mut DecodedBitmapCue) {
        let start_time_ms = cue.metadata.start_time_ms;
        if cue.metadata.end_time_ms > start_time_ms {
            return;
        }

        let duration = self
            .previous_positive_duration
            .unwrap_or(DEFAULT_MISSING_CUE_DURATION_MS)
            .clamp(
                MIN_NORMALIZED_CUE_DURATION_MS,
                MAX_NORMALIZED_CUE_DURATION_MS,
            );
        cue.metadata.end_time_ms =
            ensure_end_after_start(start_time_ms, start_time_ms.saturating_add(duration));
    }

    fn emit(&mut self, cue: DecodedBitmapCue) -> Result<(), String> {
        let duration = cue
            .metadata
            .end_time_ms
            .saturating_sub(cue.metadata.start_time_ms);
        if duration > 0 {
            self.previous_positive_duration = Some(duration);
        }

        (self.handler)(cue)
    }
}

fn drain_decoder_frames<F>(
    decoder: &mut dyn oxideav_core::Decoder,
    normalizer: &mut StreamingCueTimingNormalizer<'_, F>,
    cue_index: &mut usize,
    item_id: &str,
    source_key: &str,
    start_time_ms: u64,
    end_time_ms: u64,
) -> Result<(), String>
where
    F: FnMut(DecodedBitmapCue) -> Result<(), String>,
{
    loop {
        ensure_decode_not_cancelled(item_id)?;
        match decoder.receive_frame() {
            Ok(Frame::Video(frame)) => {
                let cue = decoded_frame_to_cue(
                    frame,
                    *cue_index,
                    item_id,
                    source_key,
                    start_time_ms,
                    end_time_ms,
                )?;
                *cue_index += 1;
                normalizer.push(cue)?;
            }
            Ok(_) => {}
            Err(OxideavError::NeedMore | OxideavError::Eof) => break,
            Err(error) => return Err(format!("Failed to receive Subtitle OCR frame: {}", error)),
        }
    }

    Ok(())
}

fn ensure_decode_not_cancelled(item_id: &str) -> Result<(), String> {
    if super::state::is_operation_cancelled(item_id) {
        Err("Subtitle OCR operation cancelled".to_string())
    } else {
        Ok(())
    }
}

fn decoded_frame_to_cue(
    frame: VideoFrame,
    cue_index: usize,
    item_id: &str,
    source_key: &str,
    start_time_ms: u64,
    end_time_ms: u64,
) -> Result<DecodedBitmapCue, String> {
    let plane =
        frame.planes.into_iter().next().ok_or_else(|| {
            "Decoded Subtitle OCR frame did not contain an RGBA plane".to_string()
        })?;
    if plane.stride == 0 || plane.stride % 4 != 0 {
        return Err("Decoded Subtitle OCR frame had an invalid RGBA stride".to_string());
    }
    if plane.data.len() % plane.stride != 0 {
        return Err("Decoded Subtitle OCR frame had incomplete RGBA rows".to_string());
    }

    let width = u32::try_from(plane.stride / 4)
        .map_err(|_| "Decoded Subtitle OCR frame width was too large".to_string())?;
    let height = u32::try_from(plane.data.len() / plane.stride)
        .map_err(|_| "Decoded Subtitle OCR frame height was too large".to_string())?;
    let cue_id = format!("{}-cue-{}", item_id, cue_index + 1);
    let bitmap_hash = stable_hash64_bytes(&plane.data);
    let cache_key = format!(
        "subtitle-ocr:{}:{:016x}",
        item_id,
        stable_hash64_bytes(
            format!(
                "{}:{}:{}:{}:{}:{:016x}",
                source_key, cue_index, start_time_ms, end_time_ms, width, bitmap_hash
            )
            .as_bytes()
        )
    );

    Ok(DecodedBitmapCue {
        metadata: SubtitleOcrDecodedCue {
            cue_id,
            start_time_ms,
            end_time_ms,
            width,
            height,
            cache_key,
        },
        rgba: plane.data,
    })
}

fn timestamp_to_ms(value: i64, time_base: TimeBase) -> u64 {
    let ms = time_base.seconds_of(value) * 1000.0;
    if !ms.is_finite() || ms <= 0.0 {
        0
    } else {
        ms.round() as u64
    }
}

fn with_oxideav_idx_path_hint(idx_text: &str, idx_path: &Path) -> String {
    if idx_text.lines().any(|line| line.starts_with("# idx-path:")) {
        idx_text.to_string()
    } else {
        format!("# idx-path: {}\n{}", idx_path.display(), idx_text)
    }
}

fn validate_existing_file_with_extension(path: &str, extension: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("Not a file: {}", path.display()));
    }
    match lower_extension(path).as_deref() {
        Some(ext) if ext == extension => Ok(path.to_path_buf()),
        Some(ext) => Err(format!(
            "Expected .{} Subtitle OCR source, got .{}",
            extension, ext
        )),
        None => Err(format!(
            "Expected .{} Subtitle OCR source, got path without extension",
            extension
        )),
    }
}

fn ensure_vobsub_pair_matches(idx_path: &Path, sub_path: &Path) -> Result<(), String> {
    if idx_path.with_extension("sub") == sub_path {
        Ok(())
    } else {
        Err(format!(
            "VobSub .sub sidecar must match the .idx path: expected {}",
            idx_path.with_extension("sub").display()
        ))
    }
}

fn lower_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
}

fn non_empty_path(path: Option<&str>) -> Option<&str> {
    path.map(str::trim).filter(|path| !path.is_empty())
}

fn stable_hash64_bytes(bytes: &[u8]) -> u64 {
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = FNV_OFFSET_BASIS;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::{
        BitmapSubtitleSource, DecodedBitmapCue, StreamingCueTimingNormalizer,
        decode_bitmap_subtitle_source_with_handler, validate_bitmap_subtitle_source,
    };
    use crate::tools::subtitle_ocr::SubtitleOcrDecodedCue;

    fn decoded_cue(cue_id: &str, start_time_ms: u64, end_time_ms: u64) -> DecodedBitmapCue {
        DecodedBitmapCue {
            metadata: SubtitleOcrDecodedCue {
                cue_id: cue_id.to_string(),
                start_time_ms,
                end_time_ms,
                width: 2,
                height: 2,
                cache_key: format!("cache-{cue_id}"),
            },
            rgba: Vec::new(),
        }
    }

    #[test]
    fn validate_bitmap_subtitle_source_accepts_standalone_sup() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let sup = dir.path().join("track.sup");
        std::fs::write(&sup, b"PG").expect("failed to write sup");

        let source = validate_bitmap_subtitle_source(sup.to_string_lossy().as_ref(), None, None)
            .expect("sup source should be valid");

        assert!(matches!(source, BitmapSubtitleSource::Pgs { .. }));
    }

    #[test]
    fn validate_bitmap_subtitle_source_accepts_vobsub_pair() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let idx = dir.path().join("track.idx");
        let sub = dir.path().join("track.sub");
        std::fs::write(&idx, b"# VobSub index file").expect("failed to write idx");
        std::fs::write(&sub, b"sub").expect("failed to write sub");

        let source = validate_bitmap_subtitle_source(
            idx.to_string_lossy().as_ref(),
            Some(idx.to_string_lossy().as_ref()),
            Some(sub.to_string_lossy().as_ref()),
        )
        .expect("vobsub source should be valid");

        assert!(matches!(source, BitmapSubtitleSource::VobSub { .. }));
    }

    #[test]
    fn validate_bitmap_subtitle_source_rejects_missing_vobsub_sidecar() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let idx = dir.path().join("track.idx");
        std::fs::write(&idx, b"# VobSub index file").expect("failed to write idx");

        let error = validate_bitmap_subtitle_source(idx.to_string_lossy().as_ref(), None, None)
            .expect_err("missing sub sidecar should fail");

        assert!(error.contains("VobSub .sub sidecar not found"));
    }

    #[test]
    fn streaming_timing_normalizer_uses_later_start_for_middle_missing_duration() {
        let mut emitted = Vec::new();
        let mut handler = |cue| {
            emitted.push(cue);
            Ok(())
        };
        let mut normalizer = StreamingCueTimingNormalizer::new(&mut handler);

        normalizer
            .push(decoded_cue("cue-1", 0, 1_000))
            .expect("first cue should push");
        normalizer
            .push(decoded_cue("cue-2", 1_500, 1_500))
            .expect("second cue should push");
        normalizer
            .push(decoded_cue("cue-3", 2_500, 3_000))
            .expect("third cue should push");
        normalizer.finish().expect("normalizer should finish");

        assert_eq!(emitted[1].metadata.end_time_ms, 2_500);
    }

    #[test]
    fn streaming_timing_normalizer_uses_previous_duration_for_final_missing_duration() {
        let mut emitted = Vec::new();
        let mut handler = |cue| {
            emitted.push(cue);
            Ok(())
        };
        let mut normalizer = StreamingCueTimingNormalizer::new(&mut handler);

        normalizer
            .push(decoded_cue("cue-1", 0, 1_000))
            .expect("first cue should push");
        normalizer
            .push(decoded_cue("cue-2", 3_000, 3_000))
            .expect("second cue should push");
        normalizer.finish().expect("normalizer should finish");

        assert_eq!(emitted[1].metadata.end_time_ms, 4_000);
    }

    #[test]
    fn decode_bitmap_subtitle_source_with_handler_decodes_vobsub_demo_spu() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let idx = dir.path().join("demo.idx");
        let sub = dir.path().join("demo.sub");
        let spu = oxideav_sub_image::vobsub::build_demo_spu(2, 2, &[1, 1, 1, 1]);
        std::fs::write(&sub, spu).expect("failed to write sub");
        std::fs::write(
            &idx,
            "\
# VobSub index file
size: 2x2
palette: ff0000, 00ff00, 0000ff, ffffff, 000000, 808080, c0c0c0, 404040, 200020, 800080, a0a0a0, 010203, 040506, 070809, 0a0b0c, 0d0e0f
timestamp: 00:00:01:500, filepos: 000000000
",
        )
        .expect("failed to write idx");
        let source = BitmapSubtitleSource::VobSub {
            idx_path: idx,
            sub_path: sub,
        };
        let mut decoded_metadata = Vec::new();

        decode_bitmap_subtitle_source_with_handler(&source, "demo-item", |decoded| {
            assert_eq!(decoded.metadata.width, 2);
            assert_eq!(decoded.metadata.height, 2);
            assert_eq!(decoded.metadata.start_time_ms, 1_500);
            assert!(decoded.metadata.end_time_ms > decoded.metadata.start_time_ms);
            assert_eq!(decoded.rgba.len(), 16);
            decoded_metadata.push(decoded.metadata);
            Ok(())
        })
        .expect("demo VobSub fixture should decode");

        assert_eq!(decoded_metadata.len(), 1);
        assert_eq!(decoded_metadata[0].end_time_ms, 3_500);
    }
}
