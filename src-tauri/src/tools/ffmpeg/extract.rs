use crate::shared::ffmpeg_progress::FfmpegProgressTracker;
use crate::shared::process::terminate_process;
use crate::shared::store::resolve_ffmpeg_path;
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::validation::{validate_media_path, validate_output_path};
use std::process::Stdio;
use tauri::Emitter;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

/// Timeout for FFmpeg extraction operations (5 minutes)
const FFMPEG_EXTRACT_TIMEOUT: Duration = Duration::from_secs(300);

fn remove_partial_output(path: &str) {
    let _ = std::fs::remove_file(path);
}

fn clear_extract_registration(input_path: &str) -> (Option<u32>, Option<String>) {
    let pid = super::state::EXTRACT_PROCESS_IDS
        .lock()
        .ok()
        .and_then(|mut guard| guard.remove(input_path));

    let output_path = super::state::EXTRACT_OUTPUT_PATHS
        .lock()
        .ok()
        .and_then(|mut guard| guard.remove(input_path));

    (pid, output_path)
}

// ============================================================================
// CODEC TO FFMPEG FORMAT MAPPING
// Fallback for codecs that require explicit -f flag
// ============================================================================

/// Codecs that require explicit -f flag in FFmpeg
/// Maps codec name to FFmpeg format name
const CODEC_TO_FFMPEG_FORMAT: &[(&str, &str)] = &[
    // Windows Media Audio variants
    ("wmav2", "asf"),    // WMA v2 -> ASF container
    ("wmav1", "asf"),    // WMA v1 -> ASF container
    ("wma", "asf"),      // Generic WMA -> ASF container
    ("wmapro", "asf"),   // WMA Pro -> ASF container
    ("wmavoice", "asf"), // WMA Voice -> ASF container
    // PCM variants
    ("pcm_s16le", "wav"),
    ("pcm_s24le", "wav"),
    ("pcm_s32le", "wav"),
    ("pcm_s16be", "wav"),
    ("pcm_s24be", "wav"),
    ("pcm_s32be", "wav"),
    ("pcm_u8", "wav"),
    ("pcm_u16le", "wav"),
    ("pcm_u24le", "wav"),
    ("pcm_u32le", "wav"),
    ("pcm_u16be", "wav"),
    ("pcm_u24be", "wav"),
    ("pcm_u32be", "wav"),
    // ADPCM
    ("adpcm_ima_wav", "wav"),
    ("adpcm_ms", "wav"),
    ("adpcm_yamaha", "wav"),
    // Other audio
    ("mp2", "mp3"),    // MPEG-1 Audio Layer II
    ("truehd", "mlp"), // Dolby TrueHD
    ("mlp", "mlp"),    // Meridian Lossless Packing
    ("wavpack", "wv"), // WavPack
];

/// Get FFmpeg format for a given codec
/// Returns None if no special format is needed (FFmpeg can auto-detect)
fn get_ffmpeg_format_for_codec(codec: &str) -> Option<&'static str> {
    CODEC_TO_FFMPEG_FORMAT
        .iter()
        .find(|(c, _)| c.eq_ignore_ascii_case(codec))
        .map(|(_, format)| *format)
}

/// Check if output path has a recognized extension for FFmpeg auto-detection
fn has_recognized_extension(path: &str) -> bool {
    let path_lower = path.to_lowercase();
    KNOWN_EXTENSIONS.iter().any(|ext| path_lower.ends_with(ext))
}

/// Extensions that FFmpeg recognizes for auto-detection
const KNOWN_EXTENSIONS: &[&str] = &[
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v", ".m4a", ".mp3", ".aac", ".ac3", ".eac3",
    ".dts", ".flac", ".ogg", ".opus", ".wav", ".wma", ".ass", ".ssa", ".srt", ".vtt", ".sub",
    ".sup",
];

fn build_extract_args(
    input_path: &str,
    output_path: &str,
    track_index: i32,
    track_type: &str,
    codec: &str,
) -> Vec<String> {
    let map_arg = format!("0:{}", track_index);

    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string(),
        "-map".to_string(),
        map_arg,
    ];

    let needs_explicit_format = match track_type {
        "subtitle" => {
            match codec {
                "ass" | "ssa" => args.extend(["-c:s".to_string(), "copy".to_string()]),
                "subrip" | "srt" => args.extend(["-c:s".to_string(), "srt".to_string()]),
                "webvtt" => args.extend(["-c:s".to_string(), "webvtt".to_string()]),
                "hdmv_pgs_subtitle" | "dvd_subtitle" => {
                    args.extend(["-c:s".to_string(), "copy".to_string()])
                }
                _ => args.extend(["-c:s".to_string(), "copy".to_string()]),
            }
            false
        }
        "audio" => {
            args.extend(["-c:a".to_string(), "copy".to_string()]);
            args.extend(["-vn".to_string()]);
            get_ffmpeg_format_for_codec(codec).is_some() || !has_recognized_extension(output_path)
        }
        "video" => {
            args.extend(["-c:v".to_string(), "copy".to_string()]);
            args.extend(["-an".to_string()]);
            args.extend(["-sn".to_string()]);
            false
        }
        _ => {
            args.extend(["-c".to_string(), "copy".to_string()]);
            false
        }
    };

    if needs_explicit_format {
        if let Some(format) = get_ffmpeg_format_for_codec(codec) {
            args.push("-f".to_string());
            args.push(format.to_string());
        }
    }

    args.push("-progress".to_string());
    args.push("pipe:1".to_string());
    args.push(output_path.to_string());
    args
}

fn emit_extract_progress(
    app: &tauri::AppHandle,
    input_path: &str,
    output_path: &str,
    track_index: i32,
    progress: i32,
    speed_bytes_per_sec: Option<f64>,
) {
    let _ = app.emit(
        "extract-progress",
        serde_json::json!({
            "inputPath": input_path,
            "outputPath": output_path,
            "trackIndex": track_index,
            "progress": progress,
            "speedBytesPerSec": speed_bytes_per_sec
        }),
    );
}

async fn extract_track_with_ffmpeg_and_progress(
    app: Option<&tauri::AppHandle>,
    ffmpeg_path: &str,
    input_path: &str,
    output_path: &str,
    track_index: i32,
    track_type: &str,
    codec: &str,
    duration_us: Option<u64>,
) -> Result<(), String> {
    // Validate paths
    validate_media_path(input_path)?;
    validate_output_path(output_path)?;

    let args = build_extract_args(input_path, output_path, track_index, track_type, codec);

    let mut child = Command::new(ffmpeg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to execute ffmpeg: {}. Make sure FFmpeg is installed.",
                e
            )
        })?;

    if let Some(pid) = child.id() {
        if let Ok(mut guard) = super::state::EXTRACT_PROCESS_IDS.lock() {
            guard.insert(input_path.to_string(), pid);
        }
    }
    if let Ok(mut guard) = super::state::EXTRACT_OUTPUT_PATHS.lock() {
        guard.insert(input_path.to_string(), output_path.to_string());
    }

    if let Some(app_handle) = app {
        emit_extract_progress(
            app_handle,
            input_path,
            output_path,
            track_index,
            0,
            None,
        );
    }

    if let Some(stdout) = child.stdout.take() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let app_for_progress = app.cloned();
        let input_path_for_progress = input_path.to_string();
        let output_path_for_progress = output_path.to_string();

        tokio::spawn(async move {
            let mut tracker = FfmpegProgressTracker::new(duration_us);
            let mut last_progress = 0;
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(update) = tracker.handle_line(&line) {
                    if let Some(progress) = update.progress {
                        last_progress = progress;
                    }

                    if let Some(app_handle) = app_for_progress.as_ref() {
                        emit_extract_progress(
                            app_handle,
                            &input_path_for_progress,
                            &output_path_for_progress,
                            track_index,
                            last_progress,
                            update.speed_bytes_per_sec,
                        );
                    }

                    if update.is_end {
                        last_progress = 100;
                    }
                }
            }
        });
    }

    let extract_future = async { child.wait_with_output().await };

    let output = timeout(FFMPEG_EXTRACT_TIMEOUT, extract_future)
        .await
        .map_err(|_| {
            let (pid, registered_output) = clear_extract_registration(input_path);
            if let Some(pid) = pid {
                terminate_process(pid);
            }
            if let Some(path) = registered_output {
                remove_partial_output(&path);
            }

            format!(
                "FFmpeg extraction timeout after {} seconds",
                FFMPEG_EXTRACT_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| {
            let (_pid, registered_output) = clear_extract_registration(input_path);
            if let Some(path) = registered_output {
                remove_partial_output(&path);
            }
            format!("Failed to execute ffmpeg: {}", e)
        })?;

    clear_extract_registration(input_path);

    if !output.status.success() {
        remove_partial_output(output_path);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg extraction failed: {}", stderr));
    }

    if let Some(app_handle) = app {
        emit_extract_progress(
            app_handle,
            input_path,
            output_path,
            track_index,
            100,
            None,
        );
    }

    Ok(())
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) async fn extract_track_with_ffmpeg(
    ffmpeg_path: &str,
    input_path: &str,
    output_path: &str,
    track_index: i32,
    track_type: &str,
    codec: &str,
) -> Result<(), String> {
    extract_track_with_ffmpeg_and_progress(
        None,
        ffmpeg_path,
        input_path,
        output_path,
        track_index,
        track_type,
        codec,
        None,
    )
    .await
}

/// Extract a track from a video file using ffmpeg
/// Uses async tokio::process::Command with timeout
/// Automatically adds -f flag when codec requires explicit format specification
#[tauri::command]
pub(crate) async fn extract_track(
    app: tauri::AppHandle,
    input_path: String,
    output_path: String,
    track_index: i32,
    track_type: String,
    codec: String,
    duration_us: Option<u64>,
) -> Result<(), String> {
    let _sleep_guard = SleepInhibitGuard::try_acquire("FFmpeg extraction").ok();
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    extract_track_with_ffmpeg_and_progress(
        Some(&app),
        &ffmpeg_path,
        &input_path,
        &output_path,
        track_index,
        &track_type,
        &codec,
        duration_us,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        build_extract_args, extract_track_with_ffmpeg, get_ffmpeg_format_for_codec,
        has_recognized_extension,
    };

    #[test]
    fn get_ffmpeg_format_for_codec_matches_known_codec_case_insensitive() {
        assert_eq!(get_ffmpeg_format_for_codec("WMAV2"), Some("asf"));
        assert_eq!(get_ffmpeg_format_for_codec("unknown"), None);
    }

    #[test]
    fn has_recognized_extension_supports_common_extensions() {
        assert!(has_recognized_extension("/tmp/file.MP3"));
        assert!(!has_recognized_extension("/tmp/file.custom"));
    }

    #[test]
    fn build_extract_args_adds_explicit_format_for_audio_codec_when_needed() {
        let args = build_extract_args(
            "/tmp/input.mkv",
            "/tmp/output.bin",
            1,
            "audio",
            "wmav2",
        );
        assert!(args.windows(2).any(|w| w == ["-f", "asf"]));
    }

    #[test]
    fn build_extract_args_for_video_disables_audio_and_subtitles() {
        let args = build_extract_args(
            "/tmp/input.mkv",
            "/tmp/output.mkv",
            0,
            "video",
            "h264",
        );
        assert!(args.contains(&"-an".to_string()));
        assert!(args.contains(&"-sn".to_string()));
    }

    #[test]
    fn build_extract_args_enables_progress_output() {
        let args = build_extract_args(
            "/tmp/input.mkv",
            "/tmp/output.mkv",
            0,
            "video",
            "h264",
        );
        assert!(args.windows(2).any(|w| w == ["-progress", "pipe:1"]));
    }

    #[tokio::test]
    async fn extract_track_extracts_video_stream_from_sample_video() {
        let video = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("video.mkv");

        let probe_json =
            crate::tools::ffprobe::probe::probe_file_with_ffprobe("ffprobe", video.to_string_lossy().as_ref())
                .await
                .expect("probe should succeed");
        let probe_value: serde_json::Value =
            serde_json::from_str(&probe_json).expect("valid probe json expected");
        let track_index = probe_value
            .get("streams")
            .and_then(|v| v.as_array())
            .and_then(|streams| {
                streams.iter().find_map(|stream| {
                    let codec_type = stream.get("codec_type")?.as_str()?;
                    if codec_type == "video" {
                        stream.get("index")?.as_i64().map(|idx| idx as i32)
                    } else {
                        None
                    }
                })
            })
            .expect("video stream index should exist");

        extract_track_with_ffmpeg(
            "ffmpeg",
            video.to_string_lossy().as_ref(),
            output.to_string_lossy().as_ref(),
            track_index,
            "video",
            "h264",
        )
        .await
        .expect("video extraction should succeed");

        assert!(output.exists());
    }

    #[tokio::test]
    async fn extract_track_rejects_invalid_track_index() {
        let video = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("invalid-track.mkv");

        let error = extract_track_with_ffmpeg(
            "ffmpeg",
            video.to_string_lossy().as_ref(),
            output.to_string_lossy().as_ref(),
            999,
            "video",
            "h264",
        )
        .await
        .expect_err("invalid track index should fail");

        assert!(error.contains("ffmpeg extraction failed"));
    }

    #[tokio::test]
    async fn extract_track_rejects_corrupted_media_input() {
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let input = temp.path().join("corrupted.mp4");
        std::fs::write(&input, b"this-is-not-valid-media").expect("failed to write corrupted input");
        let output = temp.path().join("out.mkv");

        let error = extract_track_with_ffmpeg(
            "ffmpeg",
            input.to_string_lossy().as_ref(),
            output.to_string_lossy().as_ref(),
            0,
            "video",
            "h264",
        )
        .await
        .expect_err("corrupted input should fail");

        assert!(error.contains("ffmpeg extraction failed"));
    }

    #[tokio::test]
    async fn extract_track_reports_error_when_ffmpeg_binary_is_missing() {
        let video = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("missing-ffmpeg.mkv");

        let error = extract_track_with_ffmpeg(
            "/tmp/definitely-not-a-real-ffmpeg-binary",
            video.to_string_lossy().as_ref(),
            output.to_string_lossy().as_ref(),
            0,
            "video",
            "h264",
        )
        .await
        .expect_err("missing ffmpeg binary should fail");

        assert!(error.contains("Failed to execute ffmpeg"));
    }
}
