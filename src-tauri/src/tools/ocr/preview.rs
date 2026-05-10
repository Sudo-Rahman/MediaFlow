use std::fs::Metadata;
use std::path::Path;
use std::process::Stdio;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::Emitter;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::shared::hash::stable_hash64;
use crate::shared::process::force_terminate_process;
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::store::{resolve_ffmpeg_path, resolve_ffprobe_path};
use crate::shared::validation::validate_media_path;
use crate::tools::ffprobe::get_media_duration_us;
use crate::tools::ffprobe::probe::probe_file_with_ffprobe;

/// Timeout for video transcoding for preview (10 minutes)
const VIDEO_PREVIEW_TRANSCODE_TIMEOUT: Duration = Duration::from_secs(600);
const PREVIEW_CACHE_VERSION: &str = "ocr-preview-v2-local-best-effort";
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreviewMediaInfo {
    streams: Vec<PreviewMediaStream>,
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

fn preview_has_audio(info: &PreviewMediaInfo) -> bool {
    info.streams
        .iter()
        .any(|stream| stream.kind == PreviewStreamKind::Audio)
}

fn build_preview_attempts(strategy: PreviewStrategy, has_audio: bool) -> Vec<PreviewStrategy> {
    let mut attempts = vec![strategy];

    if strategy != PreviewStrategy::FullTranscode {
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
) -> std::path::PathBuf {
    let input = Path::new(input_path);
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let identity_hash = format!(
        "{:x}",
        stable_hash64(&build_preview_source_identity_key(identity))
    );

    temp_dir.join(format!("{}_{}.mp4", stem, &identity_hash[..8]))
}

fn get_preview_output_path(input_path: &str) -> Result<std::path::PathBuf, String> {
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

fn remove_cached_preview_for_source(input_path: &str) -> Result<(), String> {
    validate_media_path(input_path)?;
    let output_path = get_preview_output_path(input_path)?;

    if output_path.exists() {
        std::fs::remove_file(&output_path)
            .map_err(|e| format!("Failed to remove cached preview: {}", e))?;
    }

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
) -> Result<(), String> {
    let args = build_preview_transcode_args(input_path, output_path, strategy);
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

    // Read stdout for progress
    if let Some(mut stdout) = child.stdout.take() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let app_clone = app.clone();
        let file_id_clone = file_id.to_string();
        let codec_label = strategy.display_label().to_string();

        tokio::spawn(async move {
            let reader = BufReader::new(&mut stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if line.starts_with("out_time_us=") {
                    if let Ok(time_us) = line.trim_start_matches("out_time_us=").parse::<u64>() {
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

    let file_id_for_cleanup = file_id.to_string();
    let output_path_for_cleanup = output_path.to_string();
    let output = timeout(VIDEO_PREVIEW_TRANSCODE_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            if let Some(pid) = child_pid {
                force_terminate_process(pid);
            }
            clear_ocr_process_tracking(&file_id_for_cleanup);
            let _ = std::fs::remove_file(&output_path_for_cleanup);
            format!(
                "Video transcoding timeout after {} seconds",
                VIDEO_PREVIEW_TRANSCODE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| {
            clear_ocr_process_tracking(&file_id_for_cleanup);
            let _ = std::fs::remove_file(&output_path_for_cleanup);
            format!("FFmpeg error: {}", e)
        })?;

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
) -> Result<(), String> {
    let args = build_preview_transcode_args(input_path, output_path, strategy);
    let ffmpeg_path_owned = ffmpeg_path.to_string();
    let output_path_owned = output_path.to_string();
    let wait_future = async move {
        Command::new(ffmpeg_path_owned)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
    };

    let output = timeout(VIDEO_PREVIEW_TRANSCODE_TIMEOUT, wait_future)
        .await
        .map_err(|_| {
            let _ = std::fs::remove_file(&output_path_owned);
            format!(
                "Video transcoding timeout after {} seconds",
                VIDEO_PREVIEW_TRANSCODE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| {
            let _ = std::fs::remove_file(&output_path_owned);
            format!("FFmpeg error: {}", e)
        })?;

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
) -> Result<PreviewStrategy, String> {
    let mut errors = Vec::new();

    for strategy in attempts.iter().copied() {
        let _ = std::fs::remove_file(output_path);

        match run_preview_transcode_attempt_without_progress(
            ffmpeg_path,
            input_path,
            output_path,
            strategy,
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
) -> Result<PreviewTranscodeResult, String> {
    validate_media_path(input_path)?;

    let source_identity = get_preview_source_identity(input_path)?;

    let temp_dir = std::env::temp_dir().join("mediaflow_preview");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let output_path = build_preview_output_path(&temp_dir, input_path, &source_identity);
    let output_str = output_path.to_string_lossy().to_string();
    let _ = std::fs::remove_file(&output_path);

    let media_info = probe_preview_media_with_ffprobe(ffprobe_path, input_path).await?;
    let strategy = preview_strategy_for_media(&media_info);
    let attempts = build_preview_attempts(strategy, preview_has_audio(&media_info));

    run_preview_attempts_without_progress(ffmpeg_path, input_path, &output_str, &attempts).await?;

    if !output_path.exists() {
        return Err("Transcoding failed: output file not created".to_string());
    }

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
        transcode_for_preview_with_bins_result(ffmpeg_path, ffprobe_path, input_path).await?;
    Ok(result.path)
}

/// Prepare an MP4 preview for HTML5 playback.
#[tauri::command]
pub(crate) async fn transcode_for_preview(
    app: tauri::AppHandle,
    input_path: String,
    file_id: String,
) -> Result<PreviewTranscodeResult, String> {
    validate_media_path(&input_path)?;

    let _sleep_guard = SleepInhibitGuard::try_acquire("Video preview transcoding").ok();

    let source_identity = get_preview_source_identity(&input_path)?;

    let temp_dir = std::env::temp_dir().join("mediaflow_preview");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let output_path = build_preview_output_path(&temp_dir, &input_path, &source_identity);
    let output_str = output_path.to_string_lossy().to_string();

    // Check if already transcoded
    if output_path.exists() {
        return Ok(PreviewTranscodeResult {
            path: output_str,
            source_identity,
            preview_version: PREVIEW_CACHE_VERSION.to_string(),
        });
    }

    if let Ok(mut guard) = super::state::OCR_TRANSCODE_PATHS.lock() {
        guard.insert(file_id.clone(), output_str.clone());
    }

    let setup_result = async {
        let ffmpeg_path = resolve_ffmpeg_path(&app)?;
        let ffprobe_path = resolve_ffprobe_path(&app)?;
        let media_info = probe_preview_media_with_ffprobe(&ffprobe_path, &input_path).await?;
        let strategy = preview_strategy_for_media(&media_info);
        let attempts = build_preview_attempts(strategy, preview_has_audio(&media_info));
        let duration_us = get_media_duration_us(&app, &input_path).await.unwrap_or(0);

        Ok::<_, String>((ffmpeg_path, strategy, attempts, duration_us))
    }
    .await;

    let (ffmpeg_path, strategy, attempts, duration_us) = match setup_result {
        Ok(result) => result,
        Err(error) => {
            clear_ocr_transcode_tracking(&file_id);
            let _ = std::fs::remove_file(&output_path);
            return Err(error);
        }
    };

    if is_ocr_transcode_cancelled(&file_id) {
        clear_ocr_process_tracking(&file_id);
        let _ = std::fs::remove_file(&output_path);
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
        &output_str,
        &file_id,
        duration_us,
        &attempts,
    )
    .await
    {
        Ok(strategy) => strategy,
        Err(error) => {
            clear_ocr_process_tracking(&file_id);
            clear_ocr_transcode_tracking(&file_id);
            let _ = std::fs::remove_file(&output_path);
            return Err(error);
        }
    };

    if is_ocr_transcode_cancelled(&file_id) {
        clear_ocr_process_tracking(&file_id);
        let _ = std::fs::remove_file(&output_path);
        return Err("Preview generation cancelled".to_string());
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
pub(crate) fn get_ocr_preview_cache_entry(
    input_path: String,
) -> Result<PreviewTranscodeResult, String> {
    get_preview_cache_entry(&input_path)
}

#[cfg(test)]
mod tests {
    use serial_test::serial;

    use super::{
        PREVIEW_CACHE_VERSION, PreviewMediaInfo, PreviewMediaStream, PreviewStrategy,
        PreviewStreamKind, build_preview_attempts, build_preview_output_path,
        build_preview_source_identity_key, build_preview_transcode_args, get_preview_cache_entry,
        is_ocr_transcode_cancelled, preview_strategy_for_media, remove_cached_preview_for_source,
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
        }
    }

    fn audio_stream(codec: &str) -> PreviewMediaStream {
        PreviewMediaStream {
            kind: PreviewStreamKind::Audio,
            codec_name: codec.to_string(),
            pix_fmt: None,
            profile: None,
            bits_per_raw_sample: None,
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
        let args = build_preview_transcode_args("input.mkv", "output.mp4", strategy);

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
        let args = build_preview_transcode_args("input.mkv", "output.mp4", strategy);

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
            let args = build_preview_transcode_args("input.mkv", "output.mp4", strategy);

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
    fn preview_cache_version_is_stable_for_best_effort_pipeline() {
        assert_eq!(PREVIEW_CACHE_VERSION, "ocr-preview-v2-local-best-effort");
    }

    #[test]
    fn preview_attempts_retry_copy_with_transcode_and_video_only_fallback() {
        assert_eq!(
            build_preview_attempts(PreviewStrategy::CopyAll, true),
            vec![
                PreviewStrategy::CopyAll,
                PreviewStrategy::FullTranscode,
                PreviewStrategy::FullTranscodeVideoOnly,
            ]
        );
        assert_eq!(
            build_preview_attempts(PreviewStrategy::CopyVideoEncodeAudio, true),
            vec![
                PreviewStrategy::CopyVideoEncodeAudio,
                PreviewStrategy::FullTranscode,
                PreviewStrategy::FullTranscodeVideoOnly,
            ]
        );
        assert_eq!(
            build_preview_attempts(PreviewStrategy::FullTranscode, false),
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

        remove_cached_preview_for_source(input_path.to_string_lossy().as_ref())
            .expect("preview invalidation should succeed");

        assert!(!output_path.exists());
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
