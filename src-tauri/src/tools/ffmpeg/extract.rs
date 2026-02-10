use crate::shared::store::resolve_ffmpeg_path;
use crate::shared::validation::{validate_media_path, validate_output_path};
use tokio::process::Command;
use tokio::time::{Duration, timeout};

/// Timeout for FFmpeg extraction operations (5 minutes)
const FFMPEG_EXTRACT_TIMEOUT: Duration = Duration::from_secs(300);

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
) -> Result<(), String> {
    // Validate paths
    validate_media_path(&input_path)?;
    validate_output_path(&output_path)?;

    // Build the map argument based on track type
    let map_arg = format!("0:{}", track_index);

    // Determine codec options based on track type
    let mut args = vec![
        "-y".to_string(), // Overwrite output
        "-i".to_string(),
        input_path.clone(),
        "-map".to_string(),
        map_arg,
    ];

    // Add codec-specific options
    let needs_explicit_format = match track_type.as_str() {
        "subtitle" => {
            // For subtitles, we might need to convert
            match codec.as_str() {
                "ass" | "ssa" => {
                    args.extend(["-c:s".to_string(), "copy".to_string()]);
                }
                "subrip" | "srt" => {
                    args.extend(["-c:s".to_string(), "srt".to_string()]);
                }
                "webvtt" => {
                    args.extend(["-c:s".to_string(), "webvtt".to_string()]);
                }
                "hdmv_pgs_subtitle" | "dvd_subtitle" => {
                    args.extend(["-c:s".to_string(), "copy".to_string()]);
                }
                _ => {
                    args.extend(["-c:s".to_string(), "copy".to_string()]);
                }
            }
            false
        }
        "audio" => {
            args.extend(["-c:a".to_string(), "copy".to_string()]);
            args.extend(["-vn".to_string()]); // No video
            // Check if this codec needs explicit format
            get_ffmpeg_format_for_codec(&codec).is_some() || !has_recognized_extension(&output_path)
        }
        "video" => {
            args.extend(["-c:v".to_string(), "copy".to_string()]);
            args.extend(["-an".to_string()]); // No audio
            args.extend(["-sn".to_string()]); // No subtitles
            false
        }
        _ => {
            args.extend(["-c".to_string(), "copy".to_string()]);
            false
        }
    };

    // Add explicit format flag if needed
    if needs_explicit_format {
        if let Some(format) = get_ffmpeg_format_for_codec(&codec) {
            args.push("-f".to_string());
            args.push(format.to_string());
        }
    }

    args.push(output_path.clone());

    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let extract_future = async move { Command::new(ffmpeg_path).args(&args).output().await };

    // Execute with timeout
    let output = timeout(FFMPEG_EXTRACT_TIMEOUT, extract_future)
        .await
        .map_err(|_| {
            format!(
                "FFmpeg extraction timeout after {} seconds",
                FFMPEG_EXTRACT_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| {
            format!(
                "Failed to execute ffmpeg: {}. Make sure FFmpeg is installed.",
                e
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg extraction failed: {}", stderr));
    }

    Ok(())
}
