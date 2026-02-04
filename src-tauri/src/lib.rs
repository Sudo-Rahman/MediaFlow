use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tiktoken_rs::o200k_base_singleton;
use tokio::process::Command;
use tokio::time::timeout;
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

// OCR library
use ocr_rs::{OcrEngine, OcrEngineConfig, Backend};

// ============================================================================
// GLOBAL STATE FOR PROCESS MANAGEMENT
// ============================================================================

/// Store transcode process IDs keyed by input path for individual cancellation
static TRANSCODE_PROCESS_IDS: LazyLock<Mutex<HashMap<String, u32>>> = 
    LazyLock::new(|| Mutex::new(HashMap::new()));

// ============================================================================
// CONSTANTS
// ============================================================================

/// Timeout for FFprobe operations (30 seconds)
const FFPROBE_TIMEOUT: Duration = Duration::from_secs(30);

/// Timeout for FFmpeg extraction operations (5 minutes)
const FFMPEG_EXTRACT_TIMEOUT: Duration = Duration::from_secs(300);

/// Timeout for FFmpeg merge operations (10 minutes)
const FFMPEG_MERGE_TIMEOUT: Duration = Duration::from_secs(600);

/// Allowed media file extensions
const ALLOWED_MEDIA_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "avi", "mov", "webm", "m4v", "mks", "mka", "m4a", "mp3", 
    "flac", "wav", "ogg", "aac", "ac3", "dts", "srt", "ass", "ssa", "vtt", "sub", "sup", "opus", "wma"
];

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtractionError {
    message: String,
}

impl From<std::io::Error> for ExtractionError {
    fn from(err: std::io::Error) -> Self {
        ExtractionError {
            message: err.to_string(),
        }
    }
}

impl From<String> for ExtractionError {
    fn from(msg: String) -> Self {
        ExtractionError { message: msg }
    }
}

impl std::fmt::Display for ExtractionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

// ============================================================================
// PATH VALIDATION
// ============================================================================

/// Validate that a path exists and is a file with an allowed extension
fn validate_media_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    
    // Check if path exists
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }
    
    // Check if it's a file (not a directory)
    if !path.is_file() {
        return Err(format!("Not a file: {}", path.display()));
    }
    
    // Check extension
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    
    if !ALLOWED_MEDIA_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("Unsupported file type: .{}", ext));
    }
    
    Ok(())
}

/// Validate that a path is safe (no path traversal) and parent directory exists
fn validate_output_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    
    // Check for path traversal attempts
    let path_str = path.to_string_lossy();
    if path_str.contains("..") {
        return Err("Path traversal not allowed".to_string());
    }
    
    // Check that parent directory exists
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!("Output directory does not exist: {}", parent.display()));
        }
    }
    
    Ok(())
}

/// Validate that a directory path exists
fn validate_directory_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    
    if !path.exists() {
        return Err(format!("Directory not found: {}", path.display()));
    }
    
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", path.display()));
    }
    
    Ok(())
}

// ============================================================================
// FFPROBE COMMAND
// ============================================================================

/// Probe a video file using ffprobe and return JSON output
/// Uses async tokio::process::Command with timeout
#[tauri::command]
async fn probe_file(path: String) -> Result<String, String> {
    // Validate input path
    validate_media_path(&path)?;
    
    let probe_future = async {
        Command::new("ffprobe")
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                "-show_format",
                &path,
            ])
            .output()
            .await
    };
    
    // Execute with timeout
    let output = timeout(FFPROBE_TIMEOUT, probe_future)
        .await
        .map_err(|_| format!("FFprobe timeout after {} seconds", FFPROBE_TIMEOUT.as_secs()))?
        .map_err(|e| {
            format!(
                "Failed to execute ffprobe: {}. Make sure FFmpeg is installed.",
                e
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8 output: {}", e))
}

// ============================================================================
// CODEC TO FFMPEG FORMAT MAPPING
// Fallback for codecs that require explicit -f flag
// ============================================================================

/// Codecs that require explicit -f flag in FFmpeg
/// Maps codec name to FFmpeg format name
const CODEC_TO_FFMPEG_FORMAT: &[(&str, &str)] = &[
    // Windows Media Audio variants
    ("wmav2", "asf"),      // WMA v2 -> ASF container
    ("wmav1", "asf"),      // WMA v1 -> ASF container
    ("wma", "asf"),        // Generic WMA -> ASF container
    ("wmapro", "asf"),     // WMA Pro -> ASF container
    ("wmavoice", "asf"),   // WMA Voice -> ASF container
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
    ("mp2", "mp3"),        // MPEG-1 Audio Layer II
    ("truehd", "mlp"),     // Dolby TrueHD
    ("mlp", "mlp"),        // Meridian Lossless Packing
    ("wavpack", "wv"),     // WavPack
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
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v", ".m4a",
    ".mp3", ".aac", ".ac3", ".eac3", ".dts", ".flac", ".ogg", ".opus", ".wav", ".wma",
    ".ass", ".ssa", ".srt", ".vtt", ".sub", ".sup",
];

// ============================================================================
// FFMPEG EXTRACTION COMMAND
// ============================================================================

/// Extract a track from a video file using ffmpeg
/// Uses async tokio::process::Command with timeout
/// Automatically adds -f flag when codec requires explicit format specification
#[tauri::command]
async fn extract_track(
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

    let extract_future = async {
        Command::new("ffmpeg")
            .args(&args)
            .output()
            .await
    };
    
    // Execute with timeout
    let output = timeout(FFMPEG_EXTRACT_TIMEOUT, extract_future)
        .await
        .map_err(|_| format!("FFmpeg extraction timeout after {} seconds", FFMPEG_EXTRACT_TIMEOUT.as_secs()))?
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

// ============================================================================
// FILE SYSTEM COMMANDS
// ============================================================================

/// Open a folder in the system file manager
#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    // Validate directory path
    validate_directory_path(&path)?;
    
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

// ============================================================================
// FFMPEG UTILITIES
// ============================================================================

/// Check if ffmpeg and ffprobe are available
#[tauri::command]
async fn check_ffmpeg() -> Result<bool, String> {
    let ffprobe_check = Command::new("ffprobe").arg("-version").output().await;
    let ffmpeg_check = Command::new("ffmpeg").arg("-version").output().await;

    match (ffprobe_check, ffmpeg_check) {
        (Ok(probe), Ok(mpeg)) if probe.status.success() && mpeg.status.success() => Ok(true),
        _ => Ok(false),
    }
}

/// Get FFmpeg version string
#[tauri::command]
async fn get_ffmpeg_version() -> Result<String, String> {
    let output = Command::new("ffmpeg")
        .arg("-version")
        .output()
        .await
        .map_err(|e| format!("Failed to get FFmpeg version: {}", e))?;

    if output.status.success() {
        let version_str = String::from_utf8_lossy(&output.stdout);
        // Extract first line which contains version
        if let Some(first_line) = version_str.lines().next() {
            // Try to extract just the version number
            if let Some(version) = first_line.split_whitespace().nth(2) {
                return Ok(version.to_string());
            }
        }
        Ok("Unknown".to_string())
    } else {
        Err("FFmpeg not found".to_string())
    }
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/// Rename a file on disk
#[tauri::command]
async fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    // Validate paths
    let old = Path::new(&old_path);
    if !old.exists() {
        return Err(format!("Source file not found: {}", old_path));
    }
    if !old.is_file() {
        return Err(format!("Source is not a file: {}", old_path));
    }
    
    validate_output_path(&new_path)?;
    
    // Check if destination already exists
    let new = Path::new(&new_path);
    if new.exists() {
        return Err(format!("Destination already exists: {}", new_path));
    }
    
    std::fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename file: {}", e))
}

/// Copy a file to a new location
#[tauri::command]
async fn copy_file(source_path: String, dest_path: String) -> Result<(), String> {
    // Validate paths
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err(format!("Source file not found: {}", source_path));
    }
    if !source.is_file() {
        return Err(format!("Source is not a file: {}", source_path));
    }
    
    validate_output_path(&dest_path)?;
    
    std::fs::copy(&source_path, &dest_path)
        .map_err(|e| format!("Failed to copy file: {}", e))?;
    Ok(())
}

/// File metadata structure
#[derive(Debug, Serialize, Deserialize)]
pub struct FileMetadata {
    size: u64,
    created_at: Option<u64>,  // Unix timestamp in milliseconds
    modified_at: Option<u64>, // Unix timestamp in milliseconds
}

/// Get file metadata (size, created, modified dates)
#[tauri::command]
async fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    
    let size = metadata.len();
    
    let created_at = metadata.created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    
    let modified_at = metadata.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    
    Ok(FileMetadata {
        size,
        created_at,
        modified_at,
    })
}

/// Count tokens in a text using tiktoken o200k_base encoding (GPT-4o, GPT-5)
/// Runs async to avoid blocking the main thread
#[tauri::command]
async fn count_tokens(text: String) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || {
        let bpe = o200k_base_singleton();
        bpe.encode_with_special_tokens(&text).len()
    })
    .await
    .map_err(|e| format!("Token counting failed: {}", e))
}

// ============================================================================
// OPUS TRANSCODING COMMANDS
// ============================================================================

/// Timeout for audio transcoding (5 minutes)
const AUDIO_TRANSCODE_TIMEOUT: Duration = Duration::from_secs(300);

/// Timeout for audio conversion for waveform (2 minutes)
const AUDIO_CONVERT_TIMEOUT: Duration = Duration::from_secs(120);

/// Get media duration in microseconds using ffprobe
/// This is used to calculate progress percentage during transcoding
async fn get_media_duration_us(path: &str) -> Result<u64, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }
    
    let duration_str = String::from_utf8_lossy(&output.stdout);
    let duration_secs: f64 = duration_str
        .trim()
        .parse()
        .map_err(|_| format!("Invalid duration: {}", duration_str.trim()))?;
    
    Ok((duration_secs * 1_000_000.0) as u64)
}

/// Transcode audio/video to OPUS format (mono 96kbps)
/// If track_index is provided, extract that specific audio track
/// Otherwise, use the first audio track
#[tauri::command]
async fn transcode_to_opus(
    app: tauri::AppHandle,
    input_path: String,
    output_path: String,
    track_index: Option<u32>,
) -> Result<String, String> {
    validate_media_path(&input_path)?;
    validate_output_path(&output_path)?;
    
    // Get media duration BEFORE starting FFmpeg for accurate progress
    let duration_us = get_media_duration_us(&input_path).await.unwrap_or(0);
    
    // Build FFmpeg command
    let map_arg = match track_index {
        Some(idx) => format!("0:a:{}", idx),
        None => "0:a:0".to_string(),
    };
    
    // Emit initial progress
    let _ = app.emit("transcode-progress", serde_json::json!({ 
        "progress": 0, 
        "inputPath": input_path.clone()
    }));
    
    let mut child = tokio::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-i", &input_path,
            "-map", &map_arg,
            "-c:a", "libopus",
            "-b:a", "96k",
            "-ac", "1",  // Mono
            "-progress", "pipe:1",  // Progress to stdout
            &output_path,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;
    
    // Store process ID for cancellation (keyed by input path)
    if let Some(pid) = child.id() {
        if let Ok(mut guard) = TRANSCODE_PROCESS_IDS.lock() {
            guard.insert(input_path.clone(), pid);
        }
    }
    
    // Read stdout for progress
    let stdout = child.stdout.take();
    let app_clone = app.clone();
    let input_path_clone = input_path.clone();
    
    if let Some(mut stdout) = stdout {
        use tokio::io::AsyncBufReadExt;
        use tokio::io::BufReader;
        
        tokio::spawn(async move {
            let reader = BufReader::new(&mut stdout);
            let mut lines = reader.lines();
            
            while let Ok(Some(line)) = lines.next_line().await {
                // Parse progress from FFmpeg's -progress output
                if line.starts_with("out_time_us=") {
                    if let Ok(time_us) = line.trim_start_matches("out_time_us=").parse::<u64>() {
                        if duration_us > 0 {
                            let progress = ((time_us as f64 / duration_us as f64) * 100.0).min(99.0) as i32;
                            let _ = app_clone.emit("transcode-progress", serde_json::json!({ 
                                "progress": progress, 
                                "inputPath": input_path_clone 
                            }));
                        }
                    }
                }
            }
        });
    }
    
    // Wait for completion with timeout
    let wait_future = async {
        child.wait_with_output().await
    };
    
    let input_path_for_cleanup = input_path.clone();
    let output = timeout(AUDIO_TRANSCODE_TIMEOUT, wait_future)
        .await
        .map_err(|_| {
            if let Ok(mut guard) = TRANSCODE_PROCESS_IDS.lock() {
                guard.remove(&input_path_for_cleanup);
            }
            format!("Transcode timeout after {} seconds", AUDIO_TRANSCODE_TIMEOUT.as_secs())
        })?
        .map_err(|e| {
            if let Ok(mut guard) = TRANSCODE_PROCESS_IDS.lock() {
                guard.remove(&input_path_for_cleanup);
            }
            format!("FFmpeg error: {}", e)
        })?;
    
    // Clear process ID for this file
    if let Ok(mut guard) = TRANSCODE_PROCESS_IDS.lock() {
        guard.remove(&input_path);
    }
    
    // Emit completion
    let _ = app.emit("transcode-progress", serde_json::json!({ 
        "progress": 100, 
        "inputPath": input_path 
    }));
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Transcode failed: {}", stderr));
    }
    
    // Verify output exists
    if !Path::new(&output_path).exists() {
        return Err("Transcode failed: output file not created".to_string());
    }

    println!("Transcode finished, {}", output_path);
    Ok(output_path)
}

/// Cancel a specific file's transcode by input path
#[tauri::command]
async fn cancel_transcode_file(input_path: String) -> Result<(), String> {
    let pid = {
        match TRANSCODE_PROCESS_IDS.lock() {
            Ok(mut guard) => guard.remove(&input_path),
            Err(_) => return Err("Failed to acquire process lock".to_string()),
        }
    };
    
    if let Some(pid) = pid {
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
        
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F"])
                .output();
        }
    }
    
    Ok(())
}

/// Cancel all ongoing transcodes
#[tauri::command]
async fn cancel_transcode() -> Result<(), String> {
    let pids: Vec<u32> = {
        match TRANSCODE_PROCESS_IDS.lock() {
            Ok(mut guard) => {
                let pids: Vec<u32> = guard.values().copied().collect();
                guard.clear();
                pids
            },
            Err(_) => return Err("Failed to acquire process lock".to_string()),
        }
    };
    
    for pid in pids {
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
        
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F"])
                .output();
        }
    }
    
    Ok(())
}

// ============================================================================
// TRANSCRIPTION DATA PERSISTENCE
// ============================================================================

/// Save transcription data to .rsext.json file
#[tauri::command]
async fn save_transcription_data(audio_path: String, data: String) -> Result<(), String> {
    let json_path = get_transcription_data_path(&audio_path);
    
    std::fs::write(&json_path, &data)
        .map_err(|e| format!("Failed to save transcription data: {}", e))?;
    
    Ok(())
}

/// Load transcription data from .rsext.json file
#[tauri::command]
async fn load_transcription_data(audio_path: String) -> Result<Option<String>, String> {
    let json_path = get_transcription_data_path(&audio_path);
    
    if !Path::new(&json_path).exists() {
        return Ok(None);
    }
    
    let data = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Failed to read transcription data: {}", e))?;
    
    Ok(Some(data))
}

/// Delete transcription data file
#[tauri::command]
async fn delete_transcription_data(audio_path: String) -> Result<(), String> {
    let json_path = get_transcription_data_path(&audio_path);
    
    if Path::new(&json_path).exists() {
        std::fs::remove_file(&json_path)
            .map_err(|e| format!("Failed to delete transcription data: {}", e))?;
    }
    
    Ok(())
}

/// Get the path for transcription data JSON file
fn get_transcription_data_path(audio_path: &str) -> String {
    let path = Path::new(audio_path);
    let parent = path.parent().unwrap_or(Path::new("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    
    parent.join(format!("{}.rsext.json", stem)).to_string_lossy().to_string()
}

/// Convert audio file to a lightweight format for waveform visualization
/// Converts to low-bitrate MP3 for small file size while maintaining playability
/// Returns the path to the converted file in the system temp directory
#[tauri::command]
async fn convert_audio_for_waveform(audio_path: String, track_index: Option<i32>) -> Result<String, String> {
    validate_media_path(&audio_path)?;
    
    let input = Path::new(&audio_path);
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    
    // Use system temp directory for waveform cache
    let temp_dir = std::env::temp_dir().join("rsextractor_waveform");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    
    // Create a unique filename based on the original path hash AND track index
    let track_idx = track_index.unwrap_or(0);
    let cache_key = format!("{}::track{}", audio_path, track_idx);
    let path_hash = format!("{:x}", md5_hash(&cache_key));
    let output_path = temp_dir.join(format!("{}_track{}_{}.mp3", stem, track_idx, &path_hash[..8]));
    let output_str = output_path.to_str().unwrap().to_string();
    
    // If already converted, return existing file
    if output_path.exists() {
        return Ok(output_str);
    }

    // FFmpeg command to convert to low-bitrate MP3
    let audio_stream = format!("a:{}", track_idx);
    let convert_future = async {
        Command::new("ffmpeg")
            .args([
                "-y",
                "-i", &audio_path,
                "-b:a", "128k",
                "-ac", "1",
                "-map", &audio_stream,  // Use specified audio stream
                &output_str,
            ])
            .output()
            .await
    };
    
    let output = timeout(AUDIO_CONVERT_TIMEOUT, convert_future)
        .await
        .map_err(|_| format!("Waveform conversion timeout after {} seconds", AUDIO_CONVERT_TIMEOUT.as_secs()))?
        .map_err(|e| format!("Failed to convert for waveform: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Waveform conversion failed: {}", stderr));
    }
    
    if !output_path.exists() {
        return Err("Waveform conversion failed: output file not created".to_string());
    }
    
    Ok(output_str)
}

/// Simple hash function for creating unique filenames
fn md5_hash(s: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}

// ============================================================================
// VIDEO OCR COMMANDS
// ============================================================================

/// Store OCR process IDs and output paths for cancellation and cleanup
static OCR_PROCESS_IDS: LazyLock<Mutex<HashMap<String, u32>>> = 
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Store OCR transcode output paths for cleanup on cancel/error
static OCR_TRANSCODE_PATHS: LazyLock<Mutex<HashMap<String, String>>> = 
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Timeout for video transcoding for preview (10 minutes)
const VIDEO_PREVIEW_TRANSCODE_TIMEOUT: Duration = Duration::from_secs(600);

/// Timeout for frame extraction (30 minutes for long videos)
const FRAME_EXTRACTION_TIMEOUT: Duration = Duration::from_secs(1800);

/// Global OCR engine storage keyed by language
/// Using Arc<Mutex<>> for thread-safe lazy initialization
static OCR_ENGINES: LazyLock<Mutex<HashMap<String, Arc<OcrEngine>>>> = 
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// OCR model paths configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrModelPaths {
    pub models_dir: String,
}

/// Default OCR models directory (relative to app resources)
const DEFAULT_OCR_MODELS_DIR: &str = "ocr-models";

/// Model file names for PP-OCRv5
const OCR_DET_MODEL: &str = "PP-OCRv5_mobile_det.mnn";
const OCR_CHARSET: &str = "ppocr_keys_v5.txt";

/// Language to recognition model mapping
fn get_rec_model_for_language(language: &str) -> &'static str {
    match language {
        "multi" | "chinese" | "japanese" | "en" => "PP-OCRv5_mobile_rec.mnn",
        "korean" => "korean_PP-OCRv5_mobile_rec_infer.mnn",
        "latin" => "latin_PP-OCRv5_mobile_rec_infer.mnn",
        "cyrillic" => "cyrillic_PP-OCRv5_mobile_rec_infer.mnn",
        "arabic" => "arabic_PP-OCRv5_mobile_rec_infer.mnn",
        "devanagari" => "devanagari_PP-OCRv5_mobile_rec_infer.mnn",
        "thai" => "th_PP-OCRv5_mobile_rec_infer.mnn",
        "greek" => "el_PP-OCRv5_mobile_rec_infer.mnn",
        "tamil" => "ta_PP-OCRv5_mobile_rec_infer.mnn",
        "telugu" => "te_PP-OCRv5_mobile_rec_infer.mnn",
        _ => "PP-OCRv5_mobile_rec.mnn", // Default to multi-language
    }
}

/// Get charset file for language
fn get_charset_for_language(language: &str) -> &'static str {
    match language {
        "korean" => "ppocr_keys_korean.txt",
        "latin" => "ppocr_keys_latin.txt",
        "cyrillic" => "ppocr_keys_cyrillic.txt",
        "arabic" => "ppocr_keys_arabic.txt",
        "devanagari" => "ppocr_keys_devanagari.txt",
        "thai" => "ppocr_keys_th.txt",
        "greek" => "ppocr_keys_el.txt",
        "tamil" => "ppocr_keys_ta.txt",
        "telugu" => "ppocr_keys_te.txt",
        _ => OCR_CHARSET, // Default v5 charset
    }
}

/// Get or create an OCR engine for the given language
fn get_or_create_ocr_engine(
    models_dir: &Path,
    language: &str,
) -> Result<Arc<OcrEngine>, String> {
    let mut engines = OCR_ENGINES.lock()
        .map_err(|e| format!("Failed to lock OCR engines: {}", e))?;
    
    // Check if engine already exists for this language
    if let Some(engine) = engines.get(language) {
        return Ok(Arc::clone(engine));
    }
    
    // Build model paths
    let det_path = models_dir.join(OCR_DET_MODEL);
    let rec_model = get_rec_model_for_language(language);
    let rec_path = models_dir.join(rec_model);
    let charset_file = get_charset_for_language(language);
    let charset_path = models_dir.join(charset_file);
    
    // Validate model files exist
    if !det_path.exists() {
        return Err(format!(
            "Detection model not found: {}. Please download OCR models.", 
            det_path.display()
        ));
    }
    if !rec_path.exists() {
        return Err(format!(
            "Recognition model not found: {}. Please download OCR models for language '{}'.", 
            rec_path.display(), language
        ));
    }
    if !charset_path.exists() {
        return Err(format!(
            "Charset file not found: {}. Please download OCR models.", 
            charset_path.display()
        ));
    }
    
    // Create OCR engine config with GPU acceleration on macOS
    #[cfg(target_os = "macos")]
    let config = OcrEngineConfig::new()
        .with_backend(Backend::Metal)
        .with_threads(4);
    
    #[cfg(not(target_os = "macos"))]
    let config = OcrEngineConfig::new()
        .with_threads(4);
    
    // Create the engine
    let engine = OcrEngine::new(
        det_path.to_str().ok_or("Invalid detection model path")?,
        rec_path.to_str().ok_or("Invalid recognition model path")?,
        charset_path.to_str().ok_or("Invalid charset path")?,
        Some(config),
    ).map_err(|e| format!("Failed to create OCR engine: {}", e))?;
    
    let engine = Arc::new(engine);
    engines.insert(language.to_string(), Arc::clone(&engine));
    
    Ok(engine)
}

/// Get the OCR models directory, checking app resources first, then user config
fn get_ocr_models_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    // First, check if models are in app resources
    if let Ok(resource_dir) = app.path().resource_dir() {
        let models_dir = resource_dir.join(DEFAULT_OCR_MODELS_DIR);
        if models_dir.exists() && models_dir.is_dir() {
            return Ok(models_dir);
        }
    }
    
    // Check app data directory for user-downloaded models
    if let Ok(app_data) = app.path().app_data_dir() {
        let models_dir = app_data.join(DEFAULT_OCR_MODELS_DIR);
        if models_dir.exists() && models_dir.is_dir() {
            return Ok(models_dir);
        }
    }
    
    Err("OCR models not found. Please download the PP-OCRv5 models and place them in the app's ocr-models directory.".to_string())
}

/// OCR region for cropping frames
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrRegion {
    x: f64,      // 0-1 relative position
    y: f64,
    width: f64,
    height: f64,
}

/// OCR frame result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrFrameResult {
    frame_index: u32,
    time_ms: u64,
    text: String,
    confidence: f64,
}

/// OCR subtitle entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrSubtitleEntry {
    id: String,
    text: String,
    start_time: u64,  // ms
    end_time: u64,    // ms
    confidence: f64,
}

/// Transcode video to 480p MP4 for HTML5 preview
/// Uses H.264 video, AAC audio (mono 96kbps)
#[tauri::command]
async fn transcode_for_preview(
    app: tauri::AppHandle,
    input_path: String,
    file_id: String,
) -> Result<String, String> {
    validate_media_path(&input_path)?;
    
    // Create output path in temp directory
    let input = Path::new(&input_path);
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("video");
    let path_hash = format!("{:x}", md5_hash(&input_path));
    
    let temp_dir = std::env::temp_dir().join("rsextractor_preview");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    
    let output_path = temp_dir.join(format!("{}_{}.mp4", stem, &path_hash[..8]));
    let output_str = output_path.to_str().unwrap().to_string();
    
    // Check if already transcoded
    if output_path.exists() {
        return Ok(output_str);
    }
    
    // Get duration for progress
    let duration_us = get_media_duration_us(&input_path).await.unwrap_or(0);
    
    // Emit initial progress
    let _ = app.emit("ocr-progress", serde_json::json!({
        "fileId": file_id,
        "phase": "transcoding",
        "current": 0,
        "total": 100,
        "message": "Starting video transcoding..."
    }));
    
    let mut child = tokio::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-i", &input_path,
            "-vf", "scale=-2:480",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "28",
            "-c:a", "aac",
            "-b:a", "96k",
            "-ac", "1",
            "-progress", "pipe:1",
            &output_str,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;
    
    // Store PID for cancellation
    if let Some(pid) = child.id() {
        if let Ok(mut guard) = OCR_PROCESS_IDS.lock() {
            guard.insert(file_id.clone(), pid);
        }
    }
    
    // Store output path for cleanup on cancel/error
    if let Ok(mut guard) = OCR_TRANSCODE_PATHS.lock() {
        guard.insert(file_id.clone(), output_str.clone());
    }
    
    // Read stdout for progress
    let stdout = child.stdout.take();
    let app_clone = app.clone();
    let file_id_clone = file_id.clone();
    
    if let Some(mut stdout) = stdout {
        use tokio::io::AsyncBufReadExt;
        use tokio::io::BufReader;
        
        tokio::spawn(async move {
            let reader = BufReader::new(&mut stdout);
            let mut lines = reader.lines();
            
            while let Ok(Some(line)) = lines.next_line().await {
                if line.starts_with("out_time_us=") {
                    if let Ok(time_us) = line.trim_start_matches("out_time_us=").parse::<u64>() {
                        if duration_us > 0 {
                            let progress = ((time_us as f64 / duration_us as f64) * 100.0).min(99.0) as i32;
                            let _ = app_clone.emit("ocr-progress", serde_json::json!({
                                "fileId": file_id_clone,
                                "phase": "transcoding",
                                "current": progress,
                                "total": 100,
                                "message": format!("Transcoding video... {}%", progress)
                            }));
                        }
                    }
                }
            }
        });
    }
    
    // Wait for completion
    let file_id_for_cleanup = file_id.clone();
    let output_path_for_cleanup = output_str.clone();
    let output = timeout(VIDEO_PREVIEW_TRANSCODE_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            if let Ok(mut guard) = OCR_PROCESS_IDS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            if let Ok(mut guard) = OCR_TRANSCODE_PATHS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            // Clean up partial file on timeout
            let _ = std::fs::remove_file(&output_path_for_cleanup);
            format!("Video transcoding timeout after {} seconds", VIDEO_PREVIEW_TRANSCODE_TIMEOUT.as_secs())
        })?
        .map_err(|e| {
            if let Ok(mut guard) = OCR_PROCESS_IDS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            if let Ok(mut guard) = OCR_TRANSCODE_PATHS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            // Clean up partial file on error
            let _ = std::fs::remove_file(&output_path_for_cleanup);
            format!("FFmpeg error: {}", e)
        })?;
    
    // Clear PID and path tracking
    if let Ok(mut guard) = OCR_PROCESS_IDS.lock() {
        guard.remove(&file_id);
    }
    if let Ok(mut guard) = OCR_TRANSCODE_PATHS.lock() {
        guard.remove(&file_id);
    }
    
    // Emit completion
    let _ = app.emit("ocr-progress", serde_json::json!({
        "fileId": file_id,
        "phase": "transcoding",
        "current": 100,
        "total": 100,
        "message": "Transcoding complete"
    }));
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Clean up partial file on FFmpeg failure
        let _ = std::fs::remove_file(&output_path);
        return Err(format!("Video transcoding failed: {}", stderr));
    }
    
    if !output_path.exists() {
        return Err("Transcoding failed: output file not created".to_string());
    }
    
    Ok(output_str)
}

/// Extract frames from video at specified FPS
/// Returns the number of frames extracted
#[tauri::command]
async fn extract_ocr_frames(
    app: tauri::AppHandle,
    video_path: String,
    file_id: String,
    fps: f64,
    region: Option<OcrRegion>,
) -> Result<(String, u32), String> {
    validate_media_path(&video_path)?;
    
    // Create output directory
    let path_hash = format!("{:x}", md5_hash(&video_path));
    let temp_dir = std::env::temp_dir().join("rsextractor_ocr_frames").join(&path_hash[..12]);
    
    // Clean previous extraction if exists
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to clean temp directory: {}", e))?;
    }
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    
    let output_pattern = temp_dir.join("frame_%06d.png");
    let output_pattern_str = output_pattern.to_str().unwrap();
    
    // Get video info for frame count estimation
    let duration_us = get_media_duration_us(&video_path).await.unwrap_or(0);
    let estimated_frames = if duration_us > 0 {
        ((duration_us as f64 / 1_000_000.0) * fps) as u32
    } else {
        1000 // Fallback
    };
    
    // Build filter chain
    let mut filters = vec![format!("fps={}", fps)];
    
    if let Some(ref r) = region {
        // Crop filter with relative coordinates
        // First scale to get dimensions, then crop
        filters.push(format!(
            "crop=iw*{}:ih*{}:iw*{}:ih*{}",
            r.width, r.height, r.x, r.y
        ));
    }
    
    let filter_str = filters.join(",");
    
    // Emit start
    let _ = app.emit("ocr-progress", serde_json::json!({
        "fileId": file_id,
        "phase": "extracting",
        "current": 0,
        "total": estimated_frames,
        "message": "Starting frame extraction..."
    }));
    
    let mut child = tokio::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-i", &video_path,
            "-vf", &filter_str,
            "-f", "image2",
            "-progress", "pipe:1",
            output_pattern_str,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;
    
    // Store PID
    if let Some(pid) = child.id() {
        if let Ok(mut guard) = OCR_PROCESS_IDS.lock() {
            guard.insert(file_id.clone(), pid);
        }
    }
    
    // Progress tracking
    let stdout = child.stdout.take();
    let app_clone = app.clone();
    let file_id_clone = file_id.clone();
    
    if let Some(mut stdout) = stdout {
        use tokio::io::AsyncBufReadExt;
        use tokio::io::BufReader;
        
        tokio::spawn(async move {
            let reader = BufReader::new(&mut stdout);
            let mut lines = reader.lines();
            
            while let Ok(Some(line)) = lines.next_line().await {
                if line.starts_with("frame=") {
                    if let Ok(frame) = line.trim_start_matches("frame=").trim().parse::<u32>() {
                        let _ = app_clone.emit("ocr-progress", serde_json::json!({
                            "fileId": file_id_clone,
                            "phase": "extracting",
                            "current": frame,
                            "total": estimated_frames,
                            "message": format!("Extracting frame {}...", frame)
                        }));
                    }
                }
            }
        });
    }
    
    // Wait for completion
    let file_id_for_cleanup = file_id.clone();
    let output = timeout(FRAME_EXTRACTION_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            if let Ok(mut guard) = OCR_PROCESS_IDS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            format!("Frame extraction timeout after {} seconds", FRAME_EXTRACTION_TIMEOUT.as_secs())
        })?
        .map_err(|e| {
            if let Ok(mut guard) = OCR_PROCESS_IDS.lock() {
                guard.remove(&file_id_for_cleanup);
            }
            format!("FFmpeg error: {}", e)
        })?;
    
    // Clear PID
    if let Ok(mut guard) = OCR_PROCESS_IDS.lock() {
        guard.remove(&file_id);
    }
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Frame extraction failed: {}", stderr));
    }
    
    // Count extracted frames
    let frame_count = std::fs::read_dir(&temp_dir)
        .map_err(|e| format!("Failed to read frames directory: {}", e))?
        .filter(|entry| {
            entry.as_ref()
                .map(|e| e.path().extension().map(|ext| ext == "png").unwrap_or(false))
                .unwrap_or(false)
        })
        .count() as u32;
    
    // Emit completion
    let _ = app.emit("ocr-progress", serde_json::json!({
        "fileId": file_id,
        "phase": "extracting",
        "current": frame_count,
        "total": frame_count,
        "message": format!("Extracted {} frames", frame_count)
    }));
    
    Ok((temp_dir.to_string_lossy().to_string(), frame_count))
}

/// Perform OCR on extracted frames using PP-OCRv5
#[tauri::command]
async fn perform_ocr(
    app: tauri::AppHandle,
    frames_dir: String,
    file_id: String,
    language: String,
    frame_interval_ms: u32,
) -> Result<Vec<OcrFrameResult>, String> {
    validate_directory_path(&frames_dir)?;
    
    // Get OCR models directory
    let models_dir = get_ocr_models_dir(&app)?;
    
    // Get list of frame files
    let mut frames: Vec<_> = std::fs::read_dir(&frames_dir)
        .map_err(|e| format!("Failed to read frames directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().extension()
                .map(|ext| ext == "png")
                .unwrap_or(false)
        })
        .collect();
    
    // Sort by filename
    frames.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    
    let total_frames = frames.len() as u32;
    
    if total_frames == 0 {
        return Ok(Vec::new());
    }
    
    // Emit start - loading engine
    let _ = app.emit("ocr-progress", serde_json::json!({
        "fileId": file_id,
        "phase": "ocr",
        "current": 0,
        "total": total_frames,
        "message": "Loading OCR engine..."
    }));
    
    // Get or create OCR engine for the language
    // This is done in a blocking context since OcrEngine creation is CPU-intensive
    let engine = {
        let models_dir_clone = models_dir.clone();
        let language_clone = language.clone();
        tokio::task::spawn_blocking(move || {
            get_or_create_ocr_engine(&models_dir_clone, &language_clone)
        })
        .await
        .map_err(|e| format!("Failed to spawn OCR engine task: {}", e))??
    };
    
    // Emit start - processing
    let _ = app.emit("ocr-progress", serde_json::json!({
        "fileId": file_id,
        "phase": "ocr",
        "current": 0,
        "total": total_frames,
        "message": "Starting OCR processing..."
    }));
    
    let mut results = Vec::new();
    
    for (i, frame) in frames.iter().enumerate() {
        let frame_index = i as u32;
        let time_ms = (frame_index as u64) * (frame_interval_ms as u64);
        let frame_path = frame.path();
        
        // Check for cancellation before processing
        if let Ok(guard) = OCR_PROCESS_IDS.lock() {
            if !guard.contains_key(&file_id) {
                return Err("OCR cancelled".to_string());
            }
        }
        
        // Emit progress
        let _ = app.emit("ocr-progress", serde_json::json!({
            "fileId": file_id,
            "phase": "ocr",
            "current": frame_index + 1,
            "total": total_frames,
            "message": format!("Processing frame {}/{}...", frame_index + 1, total_frames)
        }));
        
        // Run OCR on this frame in a blocking task
        let engine_clone = Arc::clone(&engine);
        let frame_path_clone = frame_path.clone();
        
        let ocr_result = tokio::task::spawn_blocking(move || {
            // Load the image
            let image = image::open(&frame_path_clone)
                .map_err(|e| format!("Failed to open frame {}: {}", frame_path_clone.display(), e))?;
            
            // Run OCR detection and recognition
            let ocr_results = engine_clone.recognize(&image)
                .map_err(|e| format!("OCR failed on frame {}: {}", frame_path_clone.display(), e))?;
            
            // Combine all detected text from the frame
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
            
            Ok::<(String, f64), String>((combined_text, avg_confidence))
        })
        .await
        .map_err(|e| format!("OCR task failed: {}", e))??;
        
        results.push(OcrFrameResult {
            frame_index,
            time_ms,
            text: ocr_result.0,
            confidence: ocr_result.1,
        });
    }
    
    // Emit completion
    let _ = app.emit("ocr-progress", serde_json::json!({
        "fileId": file_id,
        "phase": "ocr",
        "current": total_frames,
        "total": total_frames,
        "message": "OCR processing complete"
    }));
    
    Ok(results)
}

/// Generate subtitles from OCR results with deduplication
#[tauri::command]
async fn generate_subtitles_from_ocr(
    app: tauri::AppHandle,
    file_id: String,
    frame_results: Vec<OcrFrameResult>,
    frame_interval_ms: u32,
    min_confidence: f64,
) -> Result<Vec<OcrSubtitleEntry>, String> {
    // Emit start
    let _ = app.emit("ocr-progress", serde_json::json!({
        "fileId": file_id,
        "phase": "generating",
        "current": 0,
        "total": frame_results.len(),
        "message": "Generating subtitles..."
    }));
    
    let mut subtitles: Vec<OcrSubtitleEntry> = Vec::new();
    let mut current_text = String::new();
    let mut start_time: u64 = 0;
    let mut last_confidence: f64 = 0.0;
    
    for (i, frame) in frame_results.iter().enumerate() {
        // Skip low confidence or empty results
        if frame.confidence < min_confidence || frame.text.trim().is_empty() {
            // End current subtitle if exists
            if !current_text.is_empty() {
                subtitles.push(OcrSubtitleEntry {
                    id: format!("sub-{}", subtitles.len() + 1),
                    text: current_text.clone(),
                    start_time,
                    end_time: frame.time_ms,
                    confidence: last_confidence,
                });
                current_text.clear();
            }
            continue;
        }
        
        let text = frame.text.trim();
        
        // Check if text changed (deduplication)
        if text != current_text.trim() {
            // Save previous subtitle if exists
            if !current_text.is_empty() {
                subtitles.push(OcrSubtitleEntry {
                    id: format!("sub-{}", subtitles.len() + 1),
                    text: current_text.clone(),
                    start_time,
                    end_time: frame.time_ms,
                    confidence: last_confidence,
                });
            }
            
            // Start new subtitle
            current_text = text.to_string();
            start_time = frame.time_ms;
            last_confidence = frame.confidence;
        } else {
            // Update confidence with running average
            last_confidence = (last_confidence + frame.confidence) / 2.0;
        }
        
        // Emit progress
        if i % 100 == 0 {
            let _ = app.emit("ocr-progress", serde_json::json!({
                "fileId": file_id,
                "phase": "generating",
                "current": i,
                "total": frame_results.len(),
                "message": format!("Processing frame {}...", i)
            }));
        }
    }
    
    // Don't forget the last subtitle
    if !current_text.is_empty() {
        let last_time = frame_results.last()
            .map(|f| f.time_ms + frame_interval_ms as u64)
            .unwrap_or(0);
        
        subtitles.push(OcrSubtitleEntry {
            id: format!("sub-{}", subtitles.len() + 1),
            text: current_text,
            start_time,
            end_time: last_time,
            confidence: last_confidence,
        });
    }
    
    // Emit completion
    let _ = app.emit("ocr-progress", serde_json::json!({
        "fileId": file_id,
        "phase": "generating",
        "current": frame_results.len(),
        "total": frame_results.len(),
        "message": format!("Generated {} subtitles", subtitles.len())
    }));
    
    Ok(subtitles)
}

/// Export subtitles to file
#[tauri::command]
async fn export_ocr_subtitles(
    subtitles: Vec<OcrSubtitleEntry>,
    output_path: String,
    format: String,
) -> Result<(), String> {
    validate_output_path(&output_path)?;
    
    let content = match format.as_str() {
        "srt" => format_srt(&subtitles),
        "vtt" => format_vtt(&subtitles),
        "txt" => format_txt(&subtitles),
        _ => return Err(format!("Unsupported format: {}", format)),
    };
    
    std::fs::write(&output_path, content)
        .map_err(|e| format!("Failed to write subtitle file: {}", e))?;
    
    Ok(())
}

/// Format subtitles as SRT
fn format_srt(subtitles: &[OcrSubtitleEntry]) -> String {
    subtitles.iter().enumerate().map(|(i, sub)| {
        format!(
            "{}\n{} --> {}\n{}\n",
            i + 1,
            format_srt_time(sub.start_time),
            format_srt_time(sub.end_time),
            sub.text
        )
    }).collect::<Vec<_>>().join("\n")
}

/// Format subtitles as VTT
fn format_vtt(subtitles: &[OcrSubtitleEntry]) -> String {
    let mut output = String::from("WEBVTT\n\n");
    for sub in subtitles {
        output.push_str(&format!(
            "{} --> {}\n{}\n\n",
            format_vtt_time(sub.start_time),
            format_vtt_time(sub.end_time),
            sub.text
        ));
    }
    output
}

/// Format subtitles as plain text
fn format_txt(subtitles: &[OcrSubtitleEntry]) -> String {
    subtitles.iter()
        .map(|sub| sub.text.clone())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Format time for SRT (00:00:00,000)
fn format_srt_time(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1000;
    let millis = ms % 1000;
    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, seconds, millis)
}

/// Format time for VTT (00:00:00.000)
fn format_vtt_time(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1000;
    let millis = ms % 1000;
    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, seconds, millis)
}

/// Cancel OCR operation for a specific file
#[tauri::command]
async fn cancel_ocr_operation(file_id: String) -> Result<(), String> {
    let pid = {
        match OCR_PROCESS_IDS.lock() {
            Ok(mut guard) => guard.remove(&file_id),
            Err(_) => return Err("Failed to acquire process lock".to_string()),
        }
    };
    
    // Get and remove the transcode output path for cleanup
    let transcode_path = {
        match OCR_TRANSCODE_PATHS.lock() {
            Ok(mut guard) => guard.remove(&file_id),
            Err(_) => None,
        }
    };
    
    if let Some(pid) = pid {
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
        
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F"])
                .output();
        }
    }
    
    // Clean up partial transcode file if it exists
    if let Some(path) = transcode_path {
        let _ = std::fs::remove_file(&path);
    }
    
    Ok(())
}

/// Clean up OCR frames directory
#[tauri::command]
async fn cleanup_ocr_frames(frames_dir: String) -> Result<(), String> {
    let path = Path::new(&frames_dir);
    if path.exists() && path.is_dir() {
        std::fs::remove_dir_all(&frames_dir)
            .map_err(|e| format!("Failed to cleanup frames: {}", e))?;
    }
    Ok(())
}

/// OCR models status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrModelsStatus {
    pub installed: bool,
    pub models_dir: Option<String>,
    pub available_languages: Vec<String>,
    pub missing_models: Vec<String>,
    pub download_instructions: String,
}

/// Check if OCR models are installed and return status
#[tauri::command]
async fn check_ocr_models(app: tauri::AppHandle) -> Result<OcrModelsStatus, String> {
    // Define all model files we need to check
    let required_models = vec![
        (OCR_DET_MODEL, "detection"),
        ("PP-OCRv5_mobile_rec.mnn", "multi"),
    ];
    
    let language_models = vec![
        ("korean_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_korean.txt", "korean"),
        ("latin_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_latin.txt", "latin"),
        ("cyrillic_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_cyrillic.txt", "cyrillic"),
        ("arabic_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_arabic.txt", "arabic"),
        ("devanagari_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_devanagari.txt", "devanagari"),
        ("th_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_th.txt", "thai"),
        ("el_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_el.txt", "greek"),
        ("ta_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_ta.txt", "tamil"),
        ("te_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_te.txt", "telugu"),
    ];
    
    // Try to find models directory
    let models_dir = match get_ocr_models_dir(&app) {
        Ok(dir) => dir,
        Err(_) => {
            // Models not found, check if app data dir exists
            let app_data = app.path().app_data_dir()
                .map_err(|e| format!("Failed to get app data dir: {}", e))?;
            let expected_dir = app_data.join(DEFAULT_OCR_MODELS_DIR);
            
            return Ok(OcrModelsStatus {
                installed: false,
                models_dir: Some(expected_dir.to_string_lossy().to_string()),
                available_languages: vec![],
                missing_models: required_models.iter().map(|(m, _)| m.to_string()).collect(),
                download_instructions: format!(
                    "OCR models not found. Please download PP-OCRv5 models and place them in:\n{}\n\n\
                    Required files:\n\
                    - {} (detection model)\n\
                    - PP-OCRv5_mobile_rec.mnn (recognition model)\n\
                    - ppocr_keys_v5.txt (charset file)\n\n\
                    Download from: https://github.com/zibo-chen/rust-paddle-ocr/tree/next/models",
                    expected_dir.display(),
                    OCR_DET_MODEL
                ),
            });
        }
    };
    
    let mut missing_models = Vec::new();
    let mut available_languages = Vec::new();
    
    // Check required models
    for (model, name) in &required_models {
        if !models_dir.join(model).exists() {
            missing_models.push(format!("{} ({})", model, name));
        }
    }
    
    // Check charset for multi-language
    if models_dir.join(OCR_CHARSET).exists() && models_dir.join("PP-OCRv5_mobile_rec.mnn").exists() {
        available_languages.push("multi".to_string());
    }
    
    // Check language-specific models
    for (rec_model, charset, lang) in &language_models {
        if models_dir.join(rec_model).exists() && models_dir.join(charset).exists() {
            available_languages.push(lang.to_string());
        }
    }
    
    let installed = missing_models.is_empty() && !available_languages.is_empty();
    
    Ok(OcrModelsStatus {
        installed,
        models_dir: Some(models_dir.to_string_lossy().to_string()),
        available_languages,
        missing_models,
        download_instructions: if installed {
            "OCR models are installed and ready to use.".to_string()
        } else {
            format!(
                "Some OCR models are missing. Please download PP-OCRv5 models and place them in:\n{}\n\n\
                Download from: https://github.com/zibo-chen/rust-paddle-ocr/tree/next/models",
                models_dir.display()
            )
        },
    })
}

// ============================================================================
// FFMPEG MERGE COMMAND
// ============================================================================

/// Merge tracks into a video file
/// Uses async tokio::process::Command with timeout
#[tauri::command]
async fn merge_tracks(
    video_path: String,
    tracks: Vec<serde_json::Value>,
    source_track_configs: Option<Vec<serde_json::Value>>,
    output_path: String,
) -> Result<(), String> {
    // Validate input paths
    validate_media_path(&video_path)?;
    validate_output_path(&output_path)?;
    
    // Validate all track input paths
    for track in &tracks {
        if let Some(input_path) = track.get("inputPath").and_then(|v| v.as_str()) {
            validate_media_path(input_path)?;
        }
    }
    
    // First, probe the video to count streams and get their types
    let probe_future = async {
        Command::new("ffprobe")
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                &video_path,
            ])
            .output()
            .await
    };
    
    let probe_output = timeout(FFPROBE_TIMEOUT, probe_future)
        .await
        .map_err(|_| format!("FFprobe timeout after {} seconds", FFPROBE_TIMEOUT.as_secs()))?
        .map_err(|e| format!("Failed to probe video: {}", e))?;

    if !probe_output.status.success() {
        return Err("Failed to probe video file".to_string());
    }

    let probe_json: serde_json::Value = serde_json::from_slice(&probe_output.stdout)
        .map_err(|e| format!("Failed to parse probe output: {}", e))?;

    let streams = probe_json
        .get("streams")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();

    let original_stream_count = streams.len();

    // Build list of enabled source track indices
    let enabled_source_indices: Vec<usize> = if let Some(ref configs) = source_track_configs {
        configs
            .iter()
            .filter_map(|c| {
                let enabled = c.get("config")
                    .and_then(|cfg| cfg.get("enabled"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if enabled {
                    c.get("originalIndex").and_then(|v| v.as_u64()).map(|i| i as usize)
                } else {
                    None
                }
            })
            .collect()
    } else {
        // If no configs provided, enable all original tracks
        (0..original_stream_count).collect()
    };

    let mut args = vec![
        "-y".to_string(), // Overwrite output
        "-i".to_string(),
        video_path.clone(),
    ];

    // Add input files for each attached track with optional delay
    for track in &tracks {
        if let Some(input_path) = track.get("inputPath").and_then(|v| v.as_str()) {
            // Check for delay
            let delay_ms = track
                .get("config")
                .and_then(|c| c.get("delayMs"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            if delay_ms != 0 {
                // Convert ms to seconds for itsoffset
                let delay_sec = delay_ms as f64 / 1000.0;
                args.push("-itsoffset".to_string());
                args.push(format!("{:.3}", delay_sec));
            }

            args.push("-i".to_string());
            args.push(input_path.to_string());
        }
    }

    // Map selected streams from main video
    for &idx in &enabled_source_indices {
        args.push("-map".to_string());
        args.push(format!("0:{}", idx));
    }

    // Map additional tracks (external files)
    for (i, _track) in tracks.iter().enumerate() {
        let input_idx = i + 1;
        args.push("-map".to_string());
        args.push(format!("{}:0", input_idx));
    }

    // Copy video and audio codecs
    args.push("-c:v".to_string());
    args.push("copy".to_string());
    args.push("-c:a".to_string());
    args.push("copy".to_string());

    // For subtitles, copy ASS/SSA as-is, convert text-based formats to ASS for MKV compatibility
    args.push("-c:s".to_string());
    args.push("copy".to_string());

    // Apply metadata and disposition for enabled source tracks
    if let Some(ref configs) = source_track_configs {
        let mut output_stream_idx = 0;
        for config in configs {
            let enabled = config.get("config")
                .and_then(|cfg| cfg.get("enabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);

            if !enabled {
                continue;
            }

            if let Some(cfg) = config.get("config") {
                // Language
                if let Some(lang) = cfg.get("language").and_then(|v| v.as_str()) {
                    if !lang.is_empty() {
                        args.push(format!("-metadata:s:{}", output_stream_idx));
                        args.push(format!("language={}", lang));
                    }
                }

                // Title
                if let Some(title) = cfg.get("title").and_then(|v| v.as_str()) {
                    args.push(format!("-metadata:s:{}", output_stream_idx));
                    args.push(format!("title={}", title));
                }

                // Default and forced flags
                let is_default = cfg.get("default").and_then(|v| v.as_bool()).unwrap_or(false);
                let is_forced = cfg.get("forced").and_then(|v| v.as_bool()).unwrap_or(false);

                if is_default || is_forced {
                    let mut disposition = Vec::new();
                    if is_default {
                        disposition.push("default");
                    }
                    if is_forced {
                        disposition.push("forced");
                    }
                    args.push(format!("-disposition:{}", output_stream_idx));
                    args.push(disposition.join("+"));
                } else {
                    args.push(format!("-disposition:{}", output_stream_idx));
                    args.push("0".to_string());
                }
            }

            output_stream_idx += 1;
        }
    }

    // Now set metadata and disposition for each added (attached) track
    let attached_start_idx = enabled_source_indices.len();
    for (i, track) in tracks.iter().enumerate() {
        let output_stream_idx = attached_start_idx + i;

        if let Some(config) = track.get("config") {
            // Language
            if let Some(lang) = config.get("language").and_then(|v| v.as_str()) {
                if !lang.is_empty() && lang != "und" {
                    args.push(format!("-metadata:s:{}", output_stream_idx));
                    args.push(format!("language={}", lang));
                }
            }

            // Title
            if let Some(title) = config.get("title").and_then(|v| v.as_str()) {
                if !title.is_empty() {
                    args.push(format!("-metadata:s:{}", output_stream_idx));
                    args.push(format!("title={}", title));
                }
            }

            // Default and forced flags
            let is_default = config.get("default").and_then(|v| v.as_bool()).unwrap_or(false);
            let is_forced = config.get("forced").and_then(|v| v.as_bool()).unwrap_or(false);

            if is_default || is_forced {
                let mut disposition = Vec::new();
                if is_default {
                    disposition.push("default");
                }
                if is_forced {
                    disposition.push("forced");
                }
                args.push(format!("-disposition:{}", output_stream_idx));
                args.push(disposition.join("+"));
            } else {
                args.push(format!("-disposition:{}", output_stream_idx));
                args.push("0".to_string());
            }
        }
    }

    // Output file
    args.push(output_path.clone());

    let merge_future = async {
        Command::new("ffmpeg")
            .args(&args)
            .output()
            .await
    };
    
    // Execute with timeout
    let output = timeout(FFMPEG_MERGE_TIMEOUT, merge_future)
        .await
        .map_err(|_| format!("FFmpeg merge timeout after {} seconds", FFMPEG_MERGE_TIMEOUT.as_secs()))?
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg merge failed: {}", stderr));
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(setup)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            probe_file,
            extract_track,
            open_folder,
            check_ffmpeg,
            get_ffmpeg_version,
            merge_tracks,
            rename_file,
            copy_file,
            get_file_metadata,
            count_tokens,
            // Audio transcription commands
            transcode_to_opus,
            cancel_transcode,
            cancel_transcode_file,
            save_transcription_data,
            load_transcription_data,
            delete_transcription_data,
            convert_audio_for_waveform,
            // Video OCR commands
            transcode_for_preview,
            extract_ocr_frames,
            perform_ocr,
            generate_subtitles_from_ocr,
            export_ocr_subtitles,
            cancel_ocr_operation,
            cleanup_ocr_frames,
            check_ocr_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup<'a>(app: &'a mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle_clone1 = app.handle().clone();
    create_main_window(handle_clone1.clone());
    Ok(())
}

pub fn create_main_window(app: tauri::AppHandle) {
    let window = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App("".into()))
        .title("")
        .inner_size(1200.0, 600.0)
        .min_inner_size(1200.0, 600.0)
        .center();

    #[cfg(target_os = "macos")]
    let window = window
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .shadow(true)
        .transparent(true)
        .traffic_light_position(tauri::Position::Logical(tauri::LogicalPosition {
            x: 20.0,
            y: 30.0,
        }));
    let window = window.build().unwrap();

    #[cfg(target_os = "macos")]
    apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, Some(25.0))
        .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");
}
