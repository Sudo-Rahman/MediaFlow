use std::fs::Metadata;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::Emitter;
use tokio::process::Command;
use tokio::time::{Duration, Instant, interval, timeout};

use crate::shared::hash::stable_hash64;
use crate::shared::process::force_terminate_process;
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::store::{resolve_ffmpeg_path, resolve_ffprobe_path};
use crate::shared::validation::validate_media_path;
use crate::tools::ffprobe::get_media_duration_us;
use crate::tools::ffprobe::probe::probe_file_with_ffprobe;

const VIDEO_PREVIEW_PROGRESS_STARTUP_TIMEOUT: Duration = Duration::from_secs(90);
const VIDEO_PREVIEW_PROGRESS_STALL_TIMEOUT: Duration = Duration::from_secs(120);
const VIDEO_PREVIEW_PROGRESS_CHECK_INTERVAL: Duration = Duration::from_secs(1);
const VIDEO_PREVIEW_NO_PROGRESS_TIMEOUT: Duration = Duration::from_secs(7_200);
const PREVIEW_CACHE_VERSION: &str = "ocr-preview-v3-480p-progress-timeout";
const PREVIEW_MAX_HEIGHT: u32 = 480;
const LIBX264_ENCODER: &str = "libx264";
const LIBX264_LABEL: &str = "H.264 (libx264)";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewSourceIdentity {
    path: String,
    size: u64,
    modified_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewTranscodeResult {
    path: String,
    source_identity: PreviewSourceIdentity,
    preview_version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PreviewStrategy {
    CopyAll,
    CopyVideoEncodeAudio,
    FullTranscode,
    FullTranscodeVideoOnly,
}

impl PreviewStrategy {
    fn display_label(self) -> &'static str {
        match self {
            Self::CopyAll => "H.264/AAC remux",
            Self::CopyVideoEncodeAudio => "H.264 video copy + AAC audio",
            Self::FullTranscode => LIBX264_LABEL,
            Self::FullTranscodeVideoOnly => "H.264 (libx264, video only)",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PreviewStreamKind {
    Video,
    Audio,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreviewMediaStream {
    kind: PreviewStreamKind,
    codec_name: String,
    pix_fmt: Option<String>,
    profile: Option<String>,
    bits_per_raw_sample: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreviewMediaInfo {
    streams: Vec<PreviewMediaStream>,
}

#[derive(Debug, Clone)]
struct PreviewProgressTimeout {
    startup_timeout: Duration,
    stall_timeout: Duration,
    highest_progress_us: u64,
    last_progress_at: Option<Duration>,
}

impl PreviewProgressTimeout {
    fn new(startup_timeout: Duration, stall_timeout: Duration) -> Self {
        Self {
            startup_timeout,
            stall_timeout,
            highest_progress_us: 0,
            last_progress_at: None,
        }
    }

    fn for_preview() -> Self {
        Self::new(
            VIDEO_PREVIEW_PROGRESS_STARTUP_TIMEOUT,
            VIDEO_PREVIEW_PROGRESS_STALL_TIMEOUT,
        )
    }

    fn record_progress(&mut self, out_time_us: u64, elapsed: Duration) {
        if out_time_us > self.highest_progress_us {
            self.highest_progress_us = out_time_us;
            self.last_progress_at = Some(elapsed);
        }
    }

    fn is_timed_out(&self, elapsed: Duration) -> bool {
        match self.last_progress_at {
            Some(last_progress_at) => elapsed.saturating_sub(last_progress_at) > self.stall_timeout,
            None => elapsed > self.startup_timeout,
        }
    }

    fn timeout_message(&self) -> String {
        match self.last_progress_at {
            Some(_) => format!(
                "Video preview transcoding stalled for {} seconds",
                self.stall_timeout.as_secs()
            ),
            None => format!(
                "Video preview transcoding did not report progress within {} seconds",
                self.startup_timeout.as_secs()
            ),
        }
    }
}

fn normalize_codec(codec: &str) -> String {
    codec.trim().to_ascii_lowercase()
}

fn is_browser_safe_h264(stream: &PreviewMediaStream) -> bool {
    if normalize_codec(&stream.codec_name) != "h264" {
        return false;
    }

    if stream.pix_fmt.as_deref().map(normalize_codec).as_deref() != Some("yuv420p") {
        return false;
    }

    if let Some(bits) = stream.bits_per_raw_sample.as_deref() {
        if bits.trim().parse::<u32>().is_ok_and(|value| value > 8) {
            return false;
        }
    }

    let profile = stream
        .profile
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();

    !profile.contains("10") && !profile.contains("4:2:2") && !profile.contains("4:4:4")
}

fn preview_strategy_for_media(info: &PreviewMediaInfo) -> PreviewStrategy {
    let Some(video) = info
        .streams
        .iter()
        .find(|stream| stream.kind == PreviewStreamKind::Video)
    else {
        return PreviewStrategy::FullTranscode;
    };

    if preview_stream_needs_downscale(video) {
        return PreviewStrategy::FullTranscode;
    }

    if !is_browser_safe_h264(video) {
        return PreviewStrategy::FullTranscode;
    }

    let audio = info
        .streams
        .iter()
        .find(|stream| stream.kind == PreviewStreamKind::Audio);

    match audio {
        Some(stream) if normalize_codec(&stream.codec_name) != "aac" => {
            PreviewStrategy::CopyVideoEncodeAudio
        }
        _ => PreviewStrategy::CopyAll,
    }
}

fn preview_stream_needs_downscale(stream: &PreviewMediaStream) -> bool {
    stream
        .height
        .is_some_and(|height| height > PREVIEW_MAX_HEIGHT)
}

fn preview_needs_downscale(info: &PreviewMediaInfo) -> bool {
    info.streams
        .iter()
        .find(|stream| stream.kind == PreviewStreamKind::Video)
        .is_some_and(preview_stream_needs_downscale)
}

fn preview_has_audio(info: &PreviewMediaInfo) -> bool {
    info.streams
        .iter()
        .any(|stream| stream.kind == PreviewStreamKind::Audio)
}

fn build_preview_attempts(
    strategy: PreviewStrategy,
    has_audio: bool,
    force_full_transcode: bool,
) -> Vec<PreviewStrategy> {
    let mut attempts = if force_full_transcode {
        vec![PreviewStrategy::FullTranscode]
    } else {
        vec![strategy]
    };

    if !force_full_transcode && strategy != PreviewStrategy::FullTranscode {
        attempts.push(PreviewStrategy::FullTranscode);
    }

    if has_audio {
        attempts.push(PreviewStrategy::FullTranscodeVideoOnly);
    }

    attempts.dedup();
    attempts
}

fn parse_preview_media_info(probe_json: &str) -> Result<PreviewMediaInfo, String> {
    let value: serde_json::Value = serde_json::from_str(probe_json)
        .map_err(|e| format!("Failed to parse ffprobe preview metadata: {}", e))?;
    let streams = value
        .get("streams")
        .and_then(|streams| streams.as_array())
        .ok_or_else(|| "FFprobe output did not contain streams".to_string())?;

    let parsed_streams = streams
        .iter()
        .map(|stream| {
            let kind = match stream.get("codec_type").and_then(|value| value.as_str()) {
                Some("video") => PreviewStreamKind::Video,
                Some("audio") => PreviewStreamKind::Audio,
                _ => PreviewStreamKind::Other,
            };

            PreviewMediaStream {
                kind,
                codec_name: stream
                    .get("codec_name")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                pix_fmt: stream
                    .get("pix_fmt")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                profile: stream
                    .get("profile")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                bits_per_raw_sample: stream
                    .get("bits_per_raw_sample")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                width: stream
                    .get("width")
                    .and_then(|value| value.as_u64())
                    .and_then(|value| u32::try_from(value).ok()),
                height: stream
                    .get("height")
                    .and_then(|value| value.as_u64())
                    .and_then(|value| u32::try_from(value).ok()),
            }
        })
        .collect();

    Ok(PreviewMediaInfo {
        streams: parsed_streams,
    })
}

async fn probe_preview_media_with_ffprobe(
    ffprobe_path: &str,
    input_path: &str,
) -> Result<PreviewMediaInfo, String> {
    let json = probe_file_with_ffprobe(ffprobe_path, input_path).await?;
    parse_preview_media_info(&json)
}

fn build_preview_transcode_args(
    input_path: &str,
    output_path: &str,
    strategy: PreviewStrategy,
    downscale_preview_height: bool,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
    ];

    if strategy != PreviewStrategy::FullTranscodeVideoOnly {
        args.extend(["-map".to_string(), "0:a:0?".to_string()]);
    }

    args.extend(["-sn".to_string(), "-dn".to_string()]);

    match strategy {
        PreviewStrategy::CopyAll => {
            args.extend([
                "-c:v".to_string(),
                "copy".to_string(),
                "-c:a".to_string(),
                "copy".to_string(),
            ]);
        }
        PreviewStrategy::CopyVideoEncodeAudio => {
            args.extend([
                "-c:v".to_string(),
                "copy".to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "128k".to_string(),
                "-ac".to_string(),
                "2".to_string(),
            ]);
        }
        PreviewStrategy::FullTranscode => {
            if downscale_preview_height {
                args.extend([
                    "-vf".to_string(),
                    format!("scale=-2:{}", PREVIEW_MAX_HEIGHT),
                ]);
            }
            args.extend([
                "-c:v".to_string(),
                LIBX264_ENCODER.to_string(),
                "-preset".to_string(),
                "fast".to_string(),
                "-crf".to_string(),
                "23".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "128k".to_string(),
                "-ac".to_string(),
                "2".to_string(),
            ]);
        }
        PreviewStrategy::FullTranscodeVideoOnly => {
            if downscale_preview_height {
                args.extend([
                    "-vf".to_string(),
                    format!("scale=-2:{}", PREVIEW_MAX_HEIGHT),
                ]);
            }
            args.extend([
                "-c:v".to_string(),
                LIBX264_ENCODER.to_string(),
                "-preset".to_string(),
                "fast".to_string(),
                "-crf".to_string(),
                "23".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-an".to_string(),
            ]);
        }
    }

    args.extend([
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-progress".to_string(),
        "pipe:1".to_string(),
        output_path.to_string(),
    ]);

    args
}

fn metadata_modified_ms(metadata: &Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

fn source_identity_from_parts(path: &str, size: u64, modified_ms: u64) -> PreviewSourceIdentity {
    PreviewSourceIdentity {
        path: path.to_string(),
        size,
        modified_ms,
    }
}

fn get_preview_source_identity(input_path: &str) -> Result<PreviewSourceIdentity, String> {
    let metadata = std::fs::metadata(input_path)
        .map_err(|e| format!("Failed to read source metadata: {}", e))?;

    Ok(source_identity_from_parts(
        input_path,
        metadata.len(),
        metadata_modified_ms(&metadata),
    ))
}

fn build_preview_source_identity_key(identity: &PreviewSourceIdentity) -> String {
    format!(
        "{}:{}:{}:{}",
        PREVIEW_CACHE_VERSION, identity.path, identity.size, identity.modified_ms
    )
}

fn build_preview_output_path(
    temp_dir: &Path,
    input_path: &str,
    identity: &PreviewSourceIdentity,
) -> PathBuf {
    let input = Path::new(input_path);
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let identity_hash = format!(
        "{:016x}",
        stable_hash64(&build_preview_source_identity_key(identity))
    );

    temp_dir.join(format!("{}_{}.mp4", stem, identity_hash))
}

fn build_preview_temp_output_path(output_path: &Path) -> PathBuf {
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = output_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("preview");
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);

    parent.join(format!(
        ".{}.{}.{}.tmp.mp4",
        stem,
        std::process::id(),
        unique
    ))
}

fn remove_preview_temp_outputs(output_path: &Path) -> Result<(), String> {
    let Some(parent) = output_path.parent() else {
        return Ok(());
    };
    if !parent.exists() {
        return Ok(());
    }
    let Some(stem) = output_path.file_stem().and_then(|value| value.to_str()) else {
        return Ok(());
    };
    let temp_prefix = format!(".{}.", stem);

    for entry in
        std::fs::read_dir(parent).map_err(|e| format!("Failed to read preview directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read preview entry: {}", e))?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if file_name.starts_with(&temp_prefix) && file_name.ends_with(".tmp.mp4") {
            std::fs::remove_file(entry.path())
                .map_err(|e| format!("Failed to remove temporary preview: {}", e))?;
        }
    }

    Ok(())
}

fn get_preview_output_path(input_path: &str) -> Result<PathBuf, String> {
    let source_identity = get_preview_source_identity(input_path)?;
    let temp_dir = std::env::temp_dir().join("mediaflow_preview");

    Ok(build_preview_output_path(
        &temp_dir,
        input_path,
        &source_identity,
    ))
}

fn get_preview_cache_entry(input_path: &str) -> Result<PreviewTranscodeResult, String> {
    validate_media_path(input_path)?;
    let source_identity = get_preview_source_identity(input_path)?;
    let output_path = build_preview_output_path(
        &std::env::temp_dir().join("mediaflow_preview"),
        input_path,
        &source_identity,
    );

    Ok(PreviewTranscodeResult {
        path: output_path.to_string_lossy().to_string(),
        source_identity,
        preview_version: PREVIEW_CACHE_VERSION.to_string(),
    })
}

async fn validate_preview_file_with_ffprobe(
    ffprobe_path: &str,
    preview_path: &Path,
) -> Result<(), String> {
    let preview_path_str = preview_path.to_string_lossy();
    let info = probe_preview_media_with_ffprobe(ffprobe_path, &preview_path_str).await?;
    let Some(video) = info
        .streams
        .iter()
        .find(|stream| stream.kind == PreviewStreamKind::Video)
    else {
        return Err("Preview file does not contain a video stream".to_string());
    };

    if !is_browser_safe_h264(video) {
        return Err("Preview file is not browser-safe H.264 yuv420p".to_string());
    }

    if preview_stream_needs_downscale(video) {
        return Err(format!(
            "Preview file exceeds {}p height cap",
            PREVIEW_MAX_HEIGHT
        ));
    }

    Ok(())
}

async fn get_validated_preview_cache_entry(
    ffprobe_path: &str,
    input_path: &str,
) -> Result<PreviewTranscodeResult, String> {
    let entry = get_preview_cache_entry(input_path)?;
    let output_path = Path::new(&entry.path);

    if output_path.exists() {
        if let Err(error) = validate_preview_file_with_ffprobe(ffprobe_path, output_path).await {
            let _ = std::fs::remove_file(output_path);
            return Err(format!("Cached preview is invalid: {}", error));
        }
    }

    Ok(entry)
}

fn remove_cached_preview_for_source(input_path: &str) -> Result<(), String> {
    validate_media_path(input_path)?;
    let output_path = get_preview_output_path(input_path)?;

    if output_path.exists() {
        std::fs::remove_file(&output_path)
            .map_err(|e| format!("Failed to remove cached preview: {}", e))?;
    }

    remove_preview_temp_outputs(&output_path)?;

    Ok(())
}

fn sanitize_ffmpeg_stderr(stderr: &[u8], input_path: &str, output_path: &str) -> String {
    String::from_utf8_lossy(stderr)
        .replace(input_path, "<source>")
        .replace(output_path, "<preview>")
}

fn emit_transcoding_progress(
    app: &tauri::AppHandle,
    file_id: &str,
    current: i32,
    message: String,
    codec_label: &str,
) {
    let _ = app.emit(
        "ocr-progress",
        serde_json::json!({
            "fileId": file_id,
            "phase": "transcoding",
            "current": current,
            "total": 100,
            "message": message,
            "transcodingCodec": codec_label
        }),
    );
}

fn clear_ocr_process_tracking(file_id: &str) {
    if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
        guard.remove(file_id);
    }
}

fn clear_ocr_transcode_tracking(file_id: &str) {
    if let Ok(mut guard) = super::state::OCR_TRANSCODE_PATHS.lock() {
        guard.remove(file_id);
    }
}

fn is_ocr_transcode_cancelled(file_id: &str) -> bool {
    if let Ok(guard) = super::state::OCR_TRANSCODE_PATHS.lock() {
        return !guard.contains_key(file_id);
    }
    true
}

async fn run_preview_transcode_attempt(
    app: &tauri::AppHandle,
    ffmpeg_path: &str,
    input_path: &str,
    output_path: &str,
    file_id: &str,
    duration_us: u64,
    strategy: PreviewStrategy,
    downscale_preview_height: bool,
) -> Result<(), String> {
    let args =
        build_preview_transcode_args(input_path, output_path, strategy, downscale_preview_height);
    let mut child = Command::new(ffmpeg_path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    let child_pid = child.id();
    if let Some(pid) = child_pid {
        if let Ok(mut guard) = super::state::OCR_PROCESS_IDS.lock() {
            guard.insert(file_id.to_string(), pid);
        }
    }

    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<u64>();

    if let Some(mut stdout) = child.stdout.take() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let app_clone = app.clone();
        let file_id_clone = file_id.to_string();
        let codec_label = strategy.display_label().to_string();
        let progress_tx = progress_tx.clone();

        tokio::spawn(async move {
            let reader = BufReader::new(&mut stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if line.starts_with("out_time_us=") {
                    if let Ok(time_us) = line.trim_start_matches("out_time_us=").parse::<u64>() {
                        let _ = progress_tx.send(time_us);
                        if duration_us > 0 {
                            let progress =
                                ((time_us as f64 / duration_us as f64) * 100.0).min(99.0) as i32;
                            emit_transcoding_progress(
                                &app_clone,
                                &file_id_clone,
                                progress,
                                format!("Transcoding video... {}%", progress),
                                &codec_label,
                            );
                        }
                    }
                }
            }
        });
    }
    drop(progress_tx);

    let file_id_for_cleanup = file_id.to_string();
    let output_path_for_cleanup = output_path.to_string();
    let started_at = Instant::now();
    let mut progress_timeout = PreviewProgressTimeout::for_preview();
    let mut progress_check = interval(VIDEO_PREVIEW_PROGRESS_CHECK_INTERVAL);
    let mut wait_future = Box::pin(child.wait_with_output());
    let output = loop {
        tokio::select! {
            output = &mut wait_future => {
                break output.map_err(|e| {
                    clear_ocr_process_tracking(&file_id_for_cleanup);
                    let _ = std::fs::remove_file(&output_path_for_cleanup);
                    format!("FFmpeg error: {}", e)
                });
            }
            Some(time_us) = progress_rx.recv() => {
                progress_timeout.record_progress(time_us, started_at.elapsed());
            }
            _ = progress_check.tick() => {
                let elapsed = started_at.elapsed();
                if progress_timeout.is_timed_out(elapsed) {
                    if let Some(pid) = child_pid {
                        force_terminate_process(pid);
                    }
                    clear_ocr_process_tracking(&file_id_for_cleanup);
                    let _ = std::fs::remove_file(&output_path_for_cleanup);
                    let message = progress_timeout.timeout_message();
                    let _ = timeout(Duration::from_secs(5), &mut wait_future).await;
                    return Err(message);
                }
            }
        }
    }?;

    clear_ocr_process_tracking(file_id);

    if !output.status.success() {
        let stderr = sanitize_ffmpeg_stderr(&output.stderr, input_path, output_path);
        let _ = std::fs::remove_file(output_path);
        return Err(format!(
            "Video transcoding failed with {}: {}",
            strategy.display_label(),
            stderr
        ));
    }

    if !Path::new(output_path).exists() {
        return Err("Transcoding failed: output file not created".to_string());
    }

    Ok(())
}

async fn run_preview_transcode_attempt_without_progress(
    ffmpeg_path: &str,
    input_path: &str,
    output_path: &str,
    strategy: PreviewStrategy,
    downscale_preview_height: bool,
) -> Result<(), String> {
    let args =
        build_preview_transcode_args(input_path, output_path, strategy, downscale_preview_height);
    let output_path_owned = output_path.to_string();
    let child = Command::new(ffmpeg_path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;
    let child_pid = child.id();

    let mut wait_future = Box::pin(child.wait_with_output());
    let output = match timeout(VIDEO_PREVIEW_NO_PROGRESS_TIMEOUT, &mut wait_future).await {
        Ok(result) => result.map_err(|e| {
            let _ = std::fs::remove_file(&output_path_owned);
            format!("FFmpeg error: {}", e)
        })?,
        Err(_) => {
            if let Some(pid) = child_pid {
                force_terminate_process(pid);
            }
            let _ = timeout(Duration::from_secs(5), &mut wait_future).await;
            let _ = std::fs::remove_file(&output_path_owned);
            return Err(format!(
                "Video preview transcoding safety timeout after {} seconds",
                VIDEO_PREVIEW_NO_PROGRESS_TIMEOUT.as_secs()
            ));
        }
    };

    if !output.status.success() {
        let stderr = sanitize_ffmpeg_stderr(&output.stderr, input_path, output_path);
        let _ = std::fs::remove_file(output_path);
        return Err(format!(
            "Video transcoding failed with {}: {}",
            strategy.display_label(),
            stderr
        ));
    }

    if !Path::new(output_path).exists() {
        return Err("Transcoding failed: output file not created".to_string());
    }

    Ok(())
}

async fn run_preview_attempts(
    app: &tauri::AppHandle,
    ffmpeg_path: &str,
    input_path: &str,
    output_path: &str,
    file_id: &str,
    duration_us: u64,
    attempts: &[PreviewStrategy],
    downscale_preview_height: bool,
) -> Result<PreviewStrategy, String> {
    let mut errors = Vec::new();

    for (index, strategy) in attempts.iter().copied().enumerate() {
        if is_ocr_transcode_cancelled(file_id) {
            return Err("Preview generation cancelled".to_string());
        }

        let _ = std::fs::remove_file(output_path);

        if index > 0 {
            emit_transcoding_progress(
                app,
                file_id,
                0,
                format!("Retrying preview with {}...", strategy.display_label()),
                strategy.display_label(),
            );
        }

        match run_preview_transcode_attempt(
            app,
            ffmpeg_path,
            input_path,
            output_path,
            file_id,
            duration_us,
            strategy,
            downscale_preview_height,
        )
        .await
        {
            Ok(()) => {
                if is_ocr_transcode_cancelled(file_id) {
                    let _ = std::fs::remove_file(output_path);
                    return Err("Preview generation cancelled".to_string());
                }
                return Ok(strategy);
            }
            Err(error) => {
                if is_ocr_transcode_cancelled(file_id) {
                    return Err("Preview generation cancelled".to_string());
                }
                errors.push(format!("{}: {}", strategy.display_label(), error));
            }
        }
    }

    Err(format!(
        "Preview generation failed after {} attempt(s): {}",
        errors.len(),
        errors.join(" | ")
    ))
}

async fn run_preview_attempts_without_progress(
    ffmpeg_path: &str,
    input_path: &str,
    output_path: &str,
    attempts: &[PreviewStrategy],
    downscale_preview_height: bool,
) -> Result<PreviewStrategy, String> {
    let mut errors = Vec::new();

    for strategy in attempts.iter().copied() {
        let _ = std::fs::remove_file(output_path);

        match run_preview_transcode_attempt_without_progress(
            ffmpeg_path,
            input_path,
            output_path,
            strategy,
            downscale_preview_height,
        )
        .await
        {
            Ok(()) => return Ok(strategy),
            Err(error) => errors.push(format!("{}: {}", strategy.display_label(), error)),
        }
    }

    Err(format!(
        "Preview generation failed after {} attempt(s): {}",
        errors.len(),
        errors.join(" | ")
    ))
}

/// Prepare an MP4 preview for HTML5 playback.
#[cfg_attr(not(test), allow(dead_code))]
async fn transcode_for_preview_with_bins_result(
    ffmpeg_path: &str,
    ffprobe_path: &str,
    input_path: &str,
    force_full_transcode: bool,
) -> Result<PreviewTranscodeResult, String> {
    validate_media_path(input_path)?;

    let source_identity = get_preview_source_identity(input_path)?;

    let temp_dir = std::env::temp_dir().join("mediaflow_preview");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let output_path = build_preview_output_path(&temp_dir, input_path, &source_identity);
    let output_str = output_path.to_string_lossy().to_string();
    let temp_output_path = build_preview_temp_output_path(&output_path);
    let temp_output_str = temp_output_path.to_string_lossy().to_string();

    if !force_full_transcode && output_path.exists() {
        if validate_preview_file_with_ffprobe(ffprobe_path, &output_path)
            .await
            .is_ok()
        {
            return Ok(PreviewTranscodeResult {
                path: output_str,
                source_identity,
                preview_version: PREVIEW_CACHE_VERSION.to_string(),
            });
        }
    }
    let _ = std::fs::remove_file(&output_path);

    let media_info = probe_preview_media_with_ffprobe(ffprobe_path, input_path).await?;
    let strategy = preview_strategy_for_media(&media_info);
    let downscale_preview_height = preview_needs_downscale(&media_info);
    let attempts = build_preview_attempts(
        strategy,
        preview_has_audio(&media_info),
        force_full_transcode,
    );

    let run_result = run_preview_attempts_without_progress(
        ffmpeg_path,
        input_path,
        &temp_output_str,
        &attempts,
        downscale_preview_height,
    )
    .await;

    if let Err(error) = run_result {
        let _ = std::fs::remove_file(&temp_output_path);
        let _ = std::fs::remove_file(&output_path);
        return Err(error);
    }

    if !temp_output_path.exists() {
        return Err("Transcoding failed: output file not created".to_string());
    }

    if let Err(error) = validate_preview_file_with_ffprobe(ffprobe_path, &temp_output_path).await {
        let _ = std::fs::remove_file(&temp_output_path);
        let _ = std::fs::remove_file(&output_path);
        return Err(format!("Generated preview is invalid: {}", error));
    }

    let _ = std::fs::remove_file(&output_path);
    std::fs::rename(&temp_output_path, &output_path)
        .map_err(|e| format!("Failed to publish preview file: {}", e))?;

    Ok(PreviewTranscodeResult {
        path: output_str,
        source_identity,
        preview_version: PREVIEW_CACHE_VERSION.to_string(),
    })
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) async fn transcode_for_preview_with_bins(
    ffmpeg_path: &str,
    ffprobe_path: &str,
    input_path: &str,
) -> Result<String, String> {
    let result =
        transcode_for_preview_with_bins_result(ffmpeg_path, ffprobe_path, input_path, false)
            .await?;
    Ok(result.path)
}

/// Prepare an MP4 preview for HTML5 playback.
#[tauri::command]
pub(crate) async fn transcode_for_preview(
    app: tauri::AppHandle,
    input_path: String,
    file_id: String,
    force_full_transcode: Option<bool>,
) -> Result<PreviewTranscodeResult, String> {
    validate_media_path(&input_path)?;

    let _sleep_guard = SleepInhibitGuard::try_acquire("Video preview transcoding").ok();

    let source_identity = get_preview_source_identity(&input_path)?;

    let temp_dir = std::env::temp_dir().join("mediaflow_preview");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let output_path = build_preview_output_path(&temp_dir, &input_path, &source_identity);
    let output_str = output_path.to_string_lossy().to_string();
    let temp_output_path = build_preview_temp_output_path(&output_path);
    let temp_output_str = temp_output_path.to_string_lossy().to_string();
    let force_full_transcode = force_full_transcode.unwrap_or(false);
    let ffprobe_path = resolve_ffprobe_path(&app)?;

    if !force_full_transcode && output_path.exists() {
        if validate_preview_file_with_ffprobe(&ffprobe_path, &output_path)
            .await
            .is_err()
        {
            let _ = std::fs::remove_file(&output_path);
        } else {
            return Ok(PreviewTranscodeResult {
                path: output_str,
                source_identity,
                preview_version: PREVIEW_CACHE_VERSION.to_string(),
            });
        }
    }
    let _ = std::fs::remove_file(&output_path);

    if let Ok(mut guard) = super::state::OCR_TRANSCODE_PATHS.lock() {
        guard.insert(file_id.clone(), temp_output_str.clone());
    }

    let setup_result = async {
        let ffmpeg_path = resolve_ffmpeg_path(&app)?;
        let media_info = probe_preview_media_with_ffprobe(&ffprobe_path, &input_path).await?;
        let strategy = preview_strategy_for_media(&media_info);
        let downscale_preview_height = preview_needs_downscale(&media_info);
        let attempts = build_preview_attempts(
            strategy,
            preview_has_audio(&media_info),
            force_full_transcode,
        );
        let duration_us = get_media_duration_us(&app, &input_path).await.unwrap_or(0);

        Ok::<_, String>((
            ffmpeg_path,
            strategy,
            attempts,
            duration_us,
            downscale_preview_height,
        ))
    }
    .await;

    let (ffmpeg_path, strategy, attempts, duration_us, downscale_preview_height) =
        match setup_result {
            Ok(result) => result,
            Err(error) => {
                clear_ocr_transcode_tracking(&file_id);
                let _ = std::fs::remove_file(&output_path);
                let _ = std::fs::remove_file(&temp_output_path);
                return Err(error);
            }
        };

    if is_ocr_transcode_cancelled(&file_id) {
        clear_ocr_process_tracking(&file_id);
        let _ = std::fs::remove_file(&output_path);
        let _ = std::fs::remove_file(&temp_output_path);
        return Err("Preview generation cancelled".to_string());
    }

    // Emit initial progress
    emit_transcoding_progress(
        &app,
        &file_id,
        0,
        format!(
            "Starting preview preparation with {}...",
            strategy.display_label()
        ),
        strategy.display_label(),
    );

    let active_strategy = match run_preview_attempts(
        &app,
        &ffmpeg_path,
        &input_path,
        &temp_output_str,
        &file_id,
        duration_us,
        &attempts,
        downscale_preview_height,
    )
    .await
    {
        Ok(strategy) => strategy,
        Err(error) => {
            clear_ocr_process_tracking(&file_id);
            clear_ocr_transcode_tracking(&file_id);
            let _ = std::fs::remove_file(&output_path);
            let _ = std::fs::remove_file(&temp_output_path);
            return Err(error);
        }
    };

    if is_ocr_transcode_cancelled(&file_id) {
        clear_ocr_process_tracking(&file_id);
        let _ = std::fs::remove_file(&output_path);
        let _ = std::fs::remove_file(&temp_output_path);
        return Err("Preview generation cancelled".to_string());
    }

    if let Err(error) = validate_preview_file_with_ffprobe(&ffprobe_path, &temp_output_path).await {
        clear_ocr_process_tracking(&file_id);
        clear_ocr_transcode_tracking(&file_id);
        let _ = std::fs::remove_file(&output_path);
        let _ = std::fs::remove_file(&temp_output_path);
        return Err(format!("Generated preview is invalid: {}", error));
    }

    let _ = std::fs::remove_file(&output_path);
    if let Err(error) = std::fs::rename(&temp_output_path, &output_path) {
        clear_ocr_process_tracking(&file_id);
        clear_ocr_transcode_tracking(&file_id);
        let _ = std::fs::remove_file(&temp_output_path);
        return Err(format!("Failed to publish preview file: {}", error));
    }

    clear_ocr_process_tracking(&file_id);
    clear_ocr_transcode_tracking(&file_id);

    // Emit completion
    emit_transcoding_progress(
        &app,
        &file_id,
        100,
        "Preview preparation complete".to_string(),
        active_strategy.display_label(),
    );

    Ok(PreviewTranscodeResult {
        path: output_str,
        source_identity,
        preview_version: PREVIEW_CACHE_VERSION.to_string(),
    })
}

#[tauri::command]
pub(crate) fn invalidate_ocr_preview(input_path: String) -> Result<(), String> {
    remove_cached_preview_for_source(&input_path)
}

#[tauri::command]
pub(crate) async fn get_ocr_preview_cache_entry(
    app: tauri::AppHandle,
    input_path: String,
) -> Result<PreviewTranscodeResult, String> {
    let ffprobe_path = resolve_ffprobe_path(&app)?;
    get_validated_preview_cache_entry(&ffprobe_path, &input_path).await
}

#[cfg(test)]
mod tests {
    use serial_test::serial;
    use tokio::time::Duration;

    use super::{
        PREVIEW_CACHE_VERSION, PreviewMediaInfo, PreviewMediaStream, PreviewProgressTimeout,
        PreviewStrategy, PreviewStreamKind, build_preview_attempts, build_preview_output_path,
        build_preview_source_identity_key, build_preview_temp_output_path,
        build_preview_transcode_args, get_preview_cache_entry, is_ocr_transcode_cancelled,
        preview_needs_downscale, preview_strategy_for_media, remove_cached_preview_for_source,
        sanitize_ffmpeg_stderr, source_identity_from_parts, transcode_for_preview_with_bins,
        transcode_for_preview_with_bins_result,
    };

    fn args_contain_pair(args: &[String], flag: &str, value: &str) -> bool {
        args.windows(2)
            .any(|window| window[0] == flag && window[1] == value)
    }

    fn parse_ffprobe_key_value(text: &str, key: &str) -> Option<String> {
        for line in text.lines() {
            if let Some((line_key, line_value)) = line.split_once('=') {
                if line_key.trim() == key {
                    return Some(line_value.trim().to_string());
                }
            }
        }
        None
    }

    fn parse_ffprobe_u32(text: &str, key: &str) -> Option<u32> {
        parse_ffprobe_key_value(text, key).and_then(|value| value.parse::<u32>().ok())
    }

    fn media_info(
        video: PreviewMediaStream,
        audio: Option<PreviewMediaStream>,
    ) -> PreviewMediaInfo {
        let mut streams = vec![video];
        if let Some(audio_stream) = audio {
            streams.push(audio_stream);
        }
        PreviewMediaInfo { streams }
    }

    fn video_stream(codec: &str, pix_fmt: Option<&str>) -> PreviewMediaStream {
        PreviewMediaStream {
            kind: PreviewStreamKind::Video,
            codec_name: codec.to_string(),
            pix_fmt: pix_fmt.map(str::to_string),
            profile: None,
            bits_per_raw_sample: Some("8".to_string()),
            width: None,
            height: None,
        }
    }

    fn video_stream_with_height(
        codec: &str,
        pix_fmt: Option<&str>,
        height: u32,
    ) -> PreviewMediaStream {
        PreviewMediaStream {
            height: Some(height),
            width: Some(1280),
            ..video_stream(codec, pix_fmt)
        }
    }

    fn audio_stream(codec: &str) -> PreviewMediaStream {
        PreviewMediaStream {
            kind: PreviewStreamKind::Audio,
            codec_name: codec.to_string(),
            pix_fmt: None,
            profile: None,
            bits_per_raw_sample: None,
            width: None,
            height: None,
        }
    }

    #[tokio::test]
    async fn transcode_for_preview_creates_mp4_file() {
        let input = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");

        let output = transcode_for_preview_with_bins(
            crate::test_support::ffmpeg::ffmpeg_path(),
            crate::test_support::ffmpeg::ffprobe_path(),
            input.to_string_lossy().as_ref(),
        )
        .await
        .expect("preview transcode should succeed");

        assert!(std::path::Path::new(&output).exists());
        assert!(output.ends_with(".mp4"));
    }

    #[tokio::test]
    async fn transcode_for_preview_outputs_expected_media_properties() {
        let input = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");
        let temp_dir = tempfile::tempdir().expect("failed to create temp dir");
        let unique_input = temp_dir.path().join("codec-check-input.mp4");
        std::fs::copy(&input, &unique_input).expect("failed to copy sample video");

        let result = transcode_for_preview_with_bins_result(
            crate::test_support::ffmpeg::ffmpeg_path(),
            crate::test_support::ffmpeg::ffprobe_path(),
            unique_input.to_string_lossy().as_ref(),
            false,
        )
        .await
        .expect("preview transcode should succeed");

        let output = result.path;
        let ffprobe_output =
            std::process::Command::new(crate::test_support::ffmpeg::ffprobe_path())
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=codec_name,codec_tag_string,width,height",
                    "-of",
                    "default=noprint_wrappers=1",
                    &output,
                ])
                .output()
                .expect("failed to run ffprobe");

        let source_video_probe =
            std::process::Command::new(crate::test_support::ffmpeg::ffprobe_path())
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height",
                    "-of",
                    "default=noprint_wrappers=1",
                    unique_input.to_string_lossy().as_ref(),
                ])
                .output()
                .expect("failed to probe source video");

        let audio_probe = std::process::Command::new(crate::test_support::ffmpeg::ffprobe_path())
            .args([
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_name,channels,bit_rate",
                "-of",
                "default=noprint_wrappers=1",
                &output,
            ])
            .output()
            .expect("failed to probe preview audio");

        assert!(
            ffprobe_output.status.success(),
            "ffprobe failed: {}",
            String::from_utf8_lossy(&ffprobe_output.stderr)
        );
        assert!(
            source_video_probe.status.success(),
            "source ffprobe failed: {}",
            String::from_utf8_lossy(&source_video_probe.stderr)
        );
        assert!(
            audio_probe.status.success(),
            "audio ffprobe failed: {}",
            String::from_utf8_lossy(&audio_probe.stderr)
        );

        let ffprobe_text = String::from_utf8_lossy(&ffprobe_output.stdout);
        let source_video_text = String::from_utf8_lossy(&source_video_probe.stdout);
        let audio_text = String::from_utf8_lossy(&audio_probe.stdout);
        let codec_name = parse_ffprobe_key_value(&ffprobe_text, "codec_name");
        let codec_tag = parse_ffprobe_key_value(&ffprobe_text, "codec_tag_string");
        let audio_codec = parse_ffprobe_key_value(&audio_text, "codec_name");

        assert_eq!(codec_name.as_deref(), Some("h264"));
        assert_eq!(codec_tag.as_deref(), Some("avc1"));
        assert_eq!(
            parse_ffprobe_u32(&ffprobe_text, "width"),
            parse_ffprobe_u32(&source_video_text, "width")
        );
        assert_eq!(
            parse_ffprobe_u32(&ffprobe_text, "height"),
            parse_ffprobe_u32(&source_video_text, "height")
        );
        assert_eq!(audio_codec.as_deref(), Some("aac"));
        assert!(
            parse_ffprobe_u32(&audio_text, "channels").unwrap_or(0) >= 1,
            "expected preview audio to keep at least one channel"
        );
        assert_eq!(result.preview_version, PREVIEW_CACHE_VERSION);
    }

    #[test]
    fn h264_yuv420p_aac_uses_remux_copy_without_video_encode() {
        let info = media_info(
            video_stream("h264", Some("yuv420p")),
            Some(audio_stream("aac")),
        );
        let strategy = preview_strategy_for_media(&info);
        let args = build_preview_transcode_args("input.mkv", "output.mp4", strategy, false);

        assert_eq!(strategy, PreviewStrategy::CopyAll);
        assert!(args_contain_pair(&args, "-c:v", "copy"));
        assert!(args_contain_pair(&args, "-c:a", "copy"));
        assert!(!args.iter().any(|arg| arg == "libx264"));
        assert!(args_contain_pair(&args, "-map", "0:v:0"));
        assert!(args_contain_pair(&args, "-map", "0:a:0?"));
        assert!(args.iter().any(|arg| arg == "-sn"));
        assert!(args.iter().any(|arg| arg == "-dn"));
    }

    #[test]
    fn h264_yuv420p_flac_copies_video_and_encodes_audio_to_aac() {
        let info = media_info(
            video_stream("h264", Some("yuv420p")),
            Some(audio_stream("flac")),
        );
        let strategy = preview_strategy_for_media(&info);
        let args = build_preview_transcode_args("input.mkv", "output.mp4", strategy, false);

        assert_eq!(strategy, PreviewStrategy::CopyVideoEncodeAudio);
        assert!(args_contain_pair(&args, "-c:v", "copy"));
        assert!(args_contain_pair(&args, "-c:a", "aac"));
        assert!(args_contain_pair(&args, "-b:a", "128k"));
        assert!(args_contain_pair(&args, "-ac", "2"));
        assert!(!args.iter().any(|arg| arg == "libx264"));
    }

    #[test]
    fn non_safe_video_uses_cpu_h264_aac_transcode() {
        for info in [
            media_info(
                video_stream("hevc", Some("yuv420p")),
                Some(audio_stream("aac")),
            ),
            media_info(
                video_stream("h264", Some("yuv420p10le")),
                Some(audio_stream("aac")),
            ),
            media_info(
                video_stream("h264", Some("yuv422p")),
                Some(audio_stream("aac")),
            ),
        ] {
            let strategy = preview_strategy_for_media(&info);
            let args = build_preview_transcode_args("input.mkv", "output.mp4", strategy, false);

            assert_eq!(strategy, PreviewStrategy::FullTranscode);
            assert!(args_contain_pair(&args, "-c:v", "libx264"));
            assert!(args_contain_pair(&args, "-preset", "fast"));
            assert!(args_contain_pair(&args, "-crf", "23"));
            assert!(args_contain_pair(&args, "-pix_fmt", "yuv420p"));
            assert!(args_contain_pair(&args, "-c:a", "aac"));
            assert!(args_contain_pair(&args, "-b:a", "128k"));
            assert!(args_contain_pair(&args, "-ac", "2"));
        }
    }

    #[test]
    fn previews_above_480p_use_transcode_with_scale_filter() {
        let info = media_info(
            video_stream_with_height("h264", Some("yuv420p"), 1080),
            Some(audio_stream("aac")),
        );

        let strategy = preview_strategy_for_media(&info);
        let args = build_preview_transcode_args(
            "input.mkv",
            "output.mp4",
            strategy,
            preview_needs_downscale(&info),
        );

        assert_eq!(strategy, PreviewStrategy::FullTranscode);
        assert!(args_contain_pair(&args, "-vf", "scale=-2:480"));
        assert!(!args_contain_pair(&args, "-c:v", "copy"));
    }

    #[test]
    fn previews_at_or_below_480p_keep_source_resolution() {
        let info = media_info(
            video_stream_with_height("h264", Some("yuv420p"), 480),
            Some(audio_stream("aac")),
        );

        let strategy = preview_strategy_for_media(&info);
        let args = build_preview_transcode_args(
            "input.mkv",
            "output.mp4",
            strategy,
            preview_needs_downscale(&info),
        );

        assert_eq!(strategy, PreviewStrategy::CopyAll);
        assert!(!args.iter().any(|arg| arg == "-vf"));
        assert!(args_contain_pair(&args, "-c:v", "copy"));
    }

    #[test]
    fn forced_full_transcode_attempts_bypass_copy_remux() {
        assert_eq!(
            build_preview_attempts(PreviewStrategy::CopyAll, true, true),
            vec![
                PreviewStrategy::FullTranscode,
                PreviewStrategy::FullTranscodeVideoOnly,
            ]
        );
        assert_eq!(
            build_preview_attempts(PreviewStrategy::CopyVideoEncodeAudio, false, true),
            vec![PreviewStrategy::FullTranscode]
        );
    }

    #[test]
    fn preview_cache_version_is_stable_for_best_effort_pipeline() {
        assert_eq!(
            PREVIEW_CACHE_VERSION,
            "ocr-preview-v3-480p-progress-timeout"
        );
    }

    #[test]
    fn preview_cache_key_includes_pipeline_version() {
        let identity = source_identity_from_parts("/Volumes/NAS/source.mkv", 1024, 1_778_000);

        assert!(build_preview_source_identity_key(&identity).starts_with(PREVIEW_CACHE_VERSION));
    }

    #[test]
    fn preview_attempts_retry_copy_with_transcode_and_video_only_fallback() {
        assert_eq!(
            build_preview_attempts(PreviewStrategy::CopyAll, true, false),
            vec![
                PreviewStrategy::CopyAll,
                PreviewStrategy::FullTranscode,
                PreviewStrategy::FullTranscodeVideoOnly,
            ]
        );
        assert_eq!(
            build_preview_attempts(PreviewStrategy::CopyVideoEncodeAudio, true, false),
            vec![
                PreviewStrategy::CopyVideoEncodeAudio,
                PreviewStrategy::FullTranscode,
                PreviewStrategy::FullTranscodeVideoOnly,
            ]
        );
        assert_eq!(
            build_preview_attempts(PreviewStrategy::FullTranscode, false, false),
            vec![PreviewStrategy::FullTranscode]
        );
    }

    #[test]
    #[serial]
    fn cancelled_preview_state_is_detected_before_retrying_fallbacks() {
        let file_id = "preview-cancelled-before-retry";

        {
            let mut guard = super::super::state::OCR_TRANSCODE_PATHS
                .lock()
                .expect("failed to lock preview path state");
            guard.insert(file_id.to_string(), "/tmp/partial.mp4".to_string());
        }

        assert!(!is_ocr_transcode_cancelled(file_id));

        {
            let mut guard = super::super::state::OCR_TRANSCODE_PATHS
                .lock()
                .expect("failed to lock preview path state");
            guard.remove(file_id);
        }

        assert!(is_ocr_transcode_cancelled(file_id));
    }

    #[test]
    fn sanitize_ffmpeg_stderr_redacts_source_and_preview_paths() {
        let source = "/Volumes/NAS/source.mkv";
        let preview = "/tmp/mediaflow_preview/source.mp4";
        let stderr = format!("Cannot read {} and cannot write {}", source, preview);

        let sanitized = sanitize_ffmpeg_stderr(stderr.as_bytes(), source, preview);

        assert!(!sanitized.contains(source));
        assert!(!sanitized.contains(preview));
        assert!(sanitized.contains("<source>"));
        assert!(sanitized.contains("<preview>"));
    }

    #[test]
    fn build_preview_transcode_args_has_video_only_fallback() {
        let args = build_preview_transcode_args(
            "input.mkv",
            "output.mp4",
            PreviewStrategy::FullTranscodeVideoOnly,
            false,
        );

        assert!(args_contain_pair(&args, "-c:v", "libx264"));
        assert!(args_contain_pair(&args, "-preset", "fast"));
        assert!(args_contain_pair(&args, "-crf", "23"));
        assert!(args.iter().any(|arg| arg == "-an"));
        assert!(!args.iter().any(|arg| arg == "-c:a"));
        assert!(!args.iter().any(|arg| arg.contains("scale")));
        assert!(!args.iter().any(|arg| {
            matches!(
                arg.as_str(),
                "h264_videotoolbox" | "h264_vaapi" | "h264_nvenc" | "h264_qsv" | "h264_amf"
            )
        }));
    }

    #[test]
    fn build_preview_temp_output_path_uses_same_directory_and_tmp_suffix() {
        let output_path = std::path::Path::new("/tmp/mediaflow_preview/source_abcd1234.mp4");

        let temp_path = build_preview_temp_output_path(output_path);

        assert_eq!(temp_path.parent(), output_path.parent());
        assert_eq!(
            temp_path.extension().and_then(|value| value.to_str()),
            Some("mp4")
        );
        assert!(temp_path.to_string_lossy().contains(".tmp.mp4"));
        assert_ne!(temp_path, output_path);
    }

    #[test]
    fn preview_progress_timeout_tracks_start_and_stalled_progress() {
        let monitor =
            PreviewProgressTimeout::new(Duration::from_secs(60), Duration::from_secs(120));

        assert!(!monitor.is_timed_out(Duration::from_secs(59)));
        assert!(monitor.is_timed_out(Duration::from_secs(61)));

        let mut monitor =
            PreviewProgressTimeout::new(Duration::from_secs(60), Duration::from_secs(120));
        monitor.record_progress(1_000, Duration::from_secs(30));

        assert!(!monitor.is_timed_out(Duration::from_secs(149)));
        assert!(monitor.is_timed_out(Duration::from_secs(151)));

        monitor.record_progress(2_000, Duration::from_secs(151));
        assert!(!monitor.is_timed_out(Duration::from_secs(260)));

        monitor.record_progress(2_000, Duration::from_secs(260));
        assert!(monitor.is_timed_out(Duration::from_secs(272)));

        monitor.record_progress(3_000, Duration::from_secs(10_000));
        assert!(!monitor.is_timed_out(Duration::from_secs(10_119)));
    }

    #[test]
    fn preview_cache_key_changes_when_source_size_or_mtime_changes() {
        let original = source_identity_from_parts("/Volumes/NAS/source.mkv", 1024, 1_778_000);
        let changed_size = source_identity_from_parts("/Volumes/NAS/source.mkv", 2048, 1_778_000);
        let changed_mtime = source_identity_from_parts("/Volumes/NAS/source.mkv", 1024, 1_778_001);

        let original_key = build_preview_source_identity_key(&original);

        assert_ne!(
            original_key,
            build_preview_source_identity_key(&changed_size)
        );
        assert_ne!(
            original_key,
            build_preview_source_identity_key(&changed_mtime)
        );
    }

    #[test]
    fn preview_output_path_uses_full_identity_hash() {
        let temp_dir = std::path::Path::new("mediaflow_preview");
        let first = source_identity_from_parts("/Volumes/One/source.mkv", 1024, 1_778_000);
        let second = source_identity_from_parts("/Volumes/Two/source.mkv", 2048, 1_778_000);

        let first_path = build_preview_output_path(temp_dir, &first.path, &first);
        let second_path = build_preview_output_path(temp_dir, &second.path, &second);
        let first_hash = format!(
            "{:016x}",
            crate::shared::hash::stable_hash64(&build_preview_source_identity_key(&first))
        );

        assert_ne!(first_path, second_path);
        assert_eq!(first_hash.len(), 16);
        assert!(
            first_path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(&format!("_{}.mp4", first_hash)))
        );
    }

    #[test]
    fn remove_cached_preview_for_source_deletes_matching_output_path() {
        let temp_dir = tempfile::tempdir().expect("failed to create temp dir");
        let input_path = temp_dir.path().join("source.mp4");
        std::fs::write(&input_path, b"not a real mp4").expect("failed to create source file");

        let identity = super::get_preview_source_identity(input_path.to_string_lossy().as_ref())
            .expect("failed to get source identity");
        let output_path = build_preview_output_path(
            &std::env::temp_dir().join("mediaflow_preview"),
            input_path.to_string_lossy().as_ref(),
            &identity,
        );
        std::fs::create_dir_all(
            output_path
                .parent()
                .expect("preview output should have parent"),
        )
        .expect("failed to create preview dir");
        std::fs::write(&output_path, b"cached preview").expect("failed to write cached preview");
        let temp_output_path = build_preview_temp_output_path(&output_path);
        std::fs::write(&temp_output_path, b"partial preview")
            .expect("failed to write partial preview");

        remove_cached_preview_for_source(input_path.to_string_lossy().as_ref())
            .expect("preview invalidation should succeed");

        assert!(!output_path.exists());
        assert!(!temp_output_path.exists());
    }

    #[test]
    fn get_preview_cache_entry_returns_backend_managed_path_and_version() {
        let temp_dir = tempfile::tempdir().expect("failed to create temp dir");
        let input_path = temp_dir.path().join("source.mp4");
        std::fs::write(&input_path, b"not a real mp4").expect("failed to create source file");

        let entry = get_preview_cache_entry(input_path.to_string_lossy().as_ref())
            .expect("failed to get preview cache entry");

        assert!(entry.path.contains("mediaflow_preview"));
        assert!(entry.path.ends_with(".mp4"));
        assert_eq!(entry.preview_version, PREVIEW_CACHE_VERSION);
        assert_eq!(entry.source_identity.size, 14);
    }
}
