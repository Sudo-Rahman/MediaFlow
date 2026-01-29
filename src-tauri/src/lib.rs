use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;
use tiktoken_rs::o200k_base_singleton;
use tokio::process::Command;
use tokio::time::timeout;
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

// ============================================================================
// GLOBAL STATE FOR PROCESS MANAGEMENT
// ============================================================================

/// Store the current whisper process ID for cancellation
static WHISPER_PROCESS_ID: Mutex<Option<u32>> = Mutex::new(None);

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
// FFMPEG EXTRACTION COMMAND
// ============================================================================

/// Extract a track from a video file using ffmpeg
/// Uses async tokio::process::Command with timeout
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
    match track_type.as_str() {
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
        }
        "audio" => {
            args.extend(["-c:a".to_string(), "copy".to_string()]);
            args.extend(["-vn".to_string()]); // No video
        }
        "video" => {
            args.extend(["-c:v".to_string(), "copy".to_string()]);
            args.extend(["-an".to_string()]); // No audio
            args.extend(["-sn".to_string()]); // No subtitles
        }
        _ => {
            args.extend(["-c".to_string(), "copy".to_string()]);
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
// WHISPER COMMANDS
// ============================================================================


/// Audio formats natively supported by whisper-cli (whisper.cpp)
/// Other formats will be converted to WAV before transcription
const WHISPER_SUPPORTED_FORMATS: &[&str] = &["wav", "mp3", "flac", "ogg"];

/// Timeout for audio conversion (2 minutes should be enough for most files)
const AUDIO_CONVERT_TIMEOUT: Duration = Duration::from_secs(120);

/// Get the whisper models directory path
fn get_whisper_models_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    Ok(Path::new(&home).join(".cache").join("whisper"))
}

/// Check if whisper.cpp is installed
#[tauri::command]
async fn check_whisper() -> Result<bool, String> {
    // Try whisper-cli (Homebrew installation on macOS)
    let whisper_cli = Command::new("whisper-cli")
        .arg("--help")
        .output()
        .await;
    
    if let Ok(output) = whisper_cli {
        // whisper-cli returns exit code 0 or 1 for help
        if output.status.success() || output.status.code() == Some(1) {
            return Ok(true);
        }
    }
    
    // Try main (whisper.cpp compiled from source)
    let main_check = Command::new("main")
        .arg("--help")
        .output()
        .await;
    
    if let Ok(output) = main_check {
        if output.status.success() || output.status.code() == Some(1) {
            return Ok(true);
        }
    }
    
    // Try Python whisper (fallback)
    let python_check = Command::new("whisper")
        .arg("--help")
        .output()
        .await;
    
    if let Ok(output) = python_check {
        if output.status.success() {
            return Ok(true);
        }
    }
    
    Ok(false)
}

/// Get whisper version string
#[tauri::command]
async fn get_whisper_version() -> Result<String, String> {
    // Try whisper-cli
    let output = Command::new("whisper-cli")
        .arg("--version")
        .output()
        .await;
    
    if let Ok(out) = output {
        if out.status.success() {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !version.is_empty() {
                return Ok(version);
            }
        }
    }
    
    // Try to get version from main binary (compiled from source)
    let output = Command::new("main")
        .arg("--version")
        .output()
        .await;
    
    if let Ok(out) = output {
        if out.status.success() {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !version.is_empty() {
                return Ok(version);
            }
        }
    }
    
    // Try Python whisper
    let output = Command::new("whisper")
        .arg("--version")
        .output()
        .await;
    
    if let Ok(out) = output {
        let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !version.is_empty() {
            return Ok(version);
        }
    }
    
    Err("Could not determine whisper version".to_string())
}

/// Get the path where whisper models are stored
#[tauri::command]
async fn get_whisper_models_path() -> Result<String, String> {
    let models_dir = get_whisper_models_dir()?;
    Ok(models_dir.to_string_lossy().to_string())
}

/// List downloaded whisper models
#[tauri::command]
async fn list_whisper_models() -> Result<Vec<String>, String> {
    let models_dir = get_whisper_models_dir()?;
    
    if !models_dir.exists() {
        return Ok(vec![]);
    }
    
    let mut models = Vec::new();
    let entries = std::fs::read_dir(&models_dir)
        .map_err(|e| format!("Failed to read models directory: {}", e))?;
    
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Models are named like: ggml-large-v3.bin
        if name.starts_with("ggml-") && name.ends_with(".bin") {
            let model_name = name
                .strip_prefix("ggml-")
                .and_then(|s| s.strip_suffix(".bin"))
                .unwrap_or(&name)
                .to_string();
            models.push(model_name);
        }
    }
    
    Ok(models)
}

/// Download a whisper model from Hugging Face
#[tauri::command]
async fn download_whisper_model(
    app: tauri::AppHandle,
    model: String
) -> Result<(), String> {
    let models_dir = get_whisper_models_dir()?;
    
    // Create models directory if it doesn't exist
    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;
    
    // Build model URL (Hugging Face ggerganov/whisper.cpp repository)
    let model_url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        model
    );
    
    let output_path = models_dir.join(format!("ggml-{}.bin", model));
    let temp_path = models_dir.join(format!("ggml-{}.bin.tmp", model));
    
    // Remove temp file if exists
    let _ = std::fs::remove_file(&temp_path);
    
    // Emit initial progress
    let _ = app.emit("whisper-download-progress", serde_json::json!({ 
        "progress": 0, 
        "model": model.clone()
    }));
    
    // Use curl with progress bar output that we can parse
    // -# shows a progress bar, --write-out gives us info at the end
    let mut child = tokio::process::Command::new("curl")
        .args([
            "-L",  // Follow redirects
            "-f",  // Fail on HTTP errors
            "-#",  // Progress bar
            "-o", temp_path.to_str().unwrap(),
            &model_url
        ])
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start download: {}", e))?;
    
    // Read stderr for progress (curl outputs progress bar to stderr)
    let stderr = child.stderr.take();
    let model_clone = model.clone();
    let app_clone = app.clone();
    
    if let Some(mut stderr) = stderr {
        use tokio::io::AsyncReadExt;
        tokio::spawn(async move {
            let mut buffer = [0u8; 256];
            let mut last_progress = 0;
            while let Ok(n) = stderr.read(&mut buffer).await {
                if n == 0 { break; }
                let text = String::from_utf8_lossy(&buffer[..n]);
                // Parse curl progress format: "###  10.5%"
                if let Some(pct_pos) = text.find('%') {
                    if pct_pos >= 4 {
                        let start = text[..pct_pos].rfind(|c: char| !c.is_ascii_digit() && c != '.').map(|i| i + 1).unwrap_or(0);
                        if let Ok(pct) = text[start..pct_pos].trim().parse::<f32>() {
                            let progress = pct as i32;
                            if progress != last_progress && progress > 0 {
                                last_progress = progress;
                                let _ = app_clone.emit("whisper-download-progress", serde_json::json!({ 
                                    "progress": progress, 
                                    "model": model_clone
                                }));
                            }
                        }
                    }
                }
            }
        });
    }
    
    let status = child.wait().await
        .map_err(|e| format!("Download process error: {}", e))?;
    
    if !status.success() {
        let _ = std::fs::remove_file(&temp_path);
        return Err("Download failed".to_string());
    }
    
    // Rename temp file to final path
    std::fs::rename(&temp_path, &output_path)
        .map_err(|e| format!("Failed to save model: {}", e))?;
    
    // Emit completion
    let _ = app.emit("whisper-download-progress", serde_json::json!({ 
        "progress": 100, 
        "model": model 
    }));
    
    Ok(())
}

/// Delete a whisper model
#[tauri::command]
async fn delete_whisper_model(model: String) -> Result<(), String> {
    let models_dir = get_whisper_models_dir()?;
    let model_path = models_dir.join(format!("ggml-{}.bin", model));
    
    if model_path.exists() {
        std::fs::remove_file(&model_path)
            .map_err(|e| format!("Failed to delete model: {}", e))?;
    }
    
    Ok(())
}

/// Timeout for whisper transcription (2 hours for very long files)
const WHISPER_TIMEOUT: Duration = Duration::from_secs(7200);

/// Check if an audio format is natively supported by whisper-cli
fn is_whisper_supported_format(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    WHISPER_SUPPORTED_FORMATS.contains(&ext.as_str())
}

/// Convert audio file to WAV format for Whisper
/// Preserves quality: keeps original sample rate and converts to 16-bit PCM WAV
/// Returns the path to the converted file
async fn convert_audio_for_whisper(input_path: &str) -> Result<String, String> {
    let input = Path::new(input_path);
    let parent = input.parent().unwrap_or(Path::new("."));
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    
    // Create output path with .whisper.wav extension to avoid conflicts
    let output_path = parent.join(format!("{}.whisper.wav", stem));
    let output_str = output_path.to_str().unwrap().to_string();
    
    // FFmpeg command to convert to WAV while preserving quality:
    // -c:a pcm_s16le: 16-bit PCM (standard WAV format, lossless)
    // No sample rate or channel changes to preserve audio quality
    let convert_future = async {
        Command::new("ffmpeg")
            .args([
                "-y",           // Overwrite output
                "-i", input_path,
                "-c:a", "pcm_s16le", // 16-bit PCM (lossless)
                &output_str,
            ])
            .output()
            .await
    };
    
    let output = timeout(AUDIO_CONVERT_TIMEOUT, convert_future)
        .await
        .map_err(|_| format!("Audio conversion timeout after {} seconds", AUDIO_CONVERT_TIMEOUT.as_secs()))?
        .map_err(|e| format!("Failed to run ffmpeg for audio conversion: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Audio conversion failed: {}", stderr));
    }
    
    // Verify the output file was created
    if !output_path.exists() {
        return Err("Audio conversion failed: output file not created".to_string());
    }
    
    Ok(output_str)
}

/// Transcribe audio file using whisper
#[tauri::command]
async fn transcribe_audio(
    app: tauri::AppHandle,
    audio_path: String,
    output_dir: String,
    model: String,
    language: String,
    output_format: String,
    word_timestamps: bool,
    translate: bool,
    max_segment_length: i32,
) -> Result<String, String> {
    // Validate audio path
    validate_media_path(&audio_path)?;
    validate_directory_path(&output_dir)?;
    
    // Get model path
    let models_dir = get_whisper_models_dir()?;
    let model_path = models_dir.join(format!("ggml-{}.bin", model));
    
    if !model_path.exists() {
        return Err(format!("Model '{}' not found. Please download it first.", model));
    }
    
    // Check if audio format is supported by whisper-cli, convert if necessary
    let (actual_audio_path, temp_wav_path): (String, Option<String>) = 
        if is_whisper_supported_format(&audio_path) {
            (audio_path.clone(), None)
        } else {
            // Convert to WAV for whisper compatibility
            let wav_path = convert_audio_for_whisper(&audio_path).await?;
            (wav_path.clone(), Some(wav_path))
        };
    
    // Build output filename - use the ORIGINAL audio file name without its extension
    // (not the converted .whisper.wav name)
    let audio_name = Path::new(&audio_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    
    let output_ext = match output_format.as_str() {
        "srt" => "srt",
        "vtt" => "vtt",
        "json" => "json",
        _ => "srt"
    };
    
    // whisper-cli uses -of for the base output path (without extension)
    // It will automatically add the extension based on output format
    let output_base = Path::new(&output_dir).join(audio_name);
    let expected_output = Path::new(&output_dir).join(format!("{}.{}", audio_name, output_ext));
    
    // Emit start progress
    let _ = app.emit("whisper-transcribe-progress", serde_json::json!({ 
        "progress": 0, 
        "audioPath": audio_path 
    }));
    
    // Build whisper command arguments
    // whisper-cli syntax: whisper-cli -m model.bin -f audio.wav -osrt -of output_base
    let mut args = vec![
        "-m".to_string(), model_path.to_str().unwrap().to_string(),
        "-f".to_string(), actual_audio_path.clone(),
    ];
    
    // Output format flags
    match output_format.as_str() {
        "srt" => args.push("-osrt".to_string()),
        "vtt" => args.push("-ovtt".to_string()),
        "json" => args.push("-oj".to_string()),
        _ => args.push("-osrt".to_string()),
    }
    
    // Output path (without extension, whisper adds it automatically)
    args.push("-of".to_string());
    args.push(output_base.to_str().unwrap().to_string());
    
    // Language (skip if auto-detect)
    if language != "auto" {
        args.push("-l".to_string());
        args.push(language);
    }
    
    // Max segment length for better subtitle timing
    // This limits the number of characters per subtitle line
    if max_segment_length > 0 {
        args.push("-ml".to_string());
        args.push(max_segment_length.to_string());
        // Split on word boundaries for cleaner segments
        args.push("-sow".to_string());
    }
    
    // Word-level timestamps for more precise timing
    // When enabled, use a shorter max length for word-level display
    if word_timestamps {
        if max_segment_length == 0 {
            args.push("-ml".to_string());
            args.push("1".to_string());
        }
    }
    
    // Translate to English
    if translate {
        args.push("-tr".to_string());
    }
    
    // Enable progress printing for real-time updates
    args.push("-pp".to_string());
    
    // Try whisper-cli first, then main (compiled from source)
    let whisper_cmd = if Command::new("whisper-cli").arg("--help").output().await.is_ok() {
        "whisper-cli"
    } else {
        "main"
    };
    
    // Log the command being run for debugging
    let cmd_debug = format!("{} {}", whisper_cmd, args.join(" "));
    
    // Spawn process with piped stderr for progress parsing
    let mut child = Command::new(whisper_cmd)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start whisper: {} (command: {})", e, cmd_debug))?;
    
    // Store the process ID for cancellation
    if let Some(pid) = child.id() {
        if let Ok(mut guard) = WHISPER_PROCESS_ID.lock() {
            *guard = Some(pid);
        }
    }
    
    // Read stderr for progress updates
    let stderr = child.stderr.take();
    let app_clone = app.clone();
    let audio_path_clone = audio_path.clone();
    
    // Spawn a task to read progress from stderr
    if let Some(mut stderr) = stderr {
        use tokio::io::AsyncBufReadExt;
        use tokio::io::BufReader;
        
        tokio::spawn(async move {
            let reader = BufReader::new(&mut stderr);
            let mut lines = reader.lines();
            
            while let Ok(Some(line)) = lines.next_line().await {
                // whisper-cli progress format: "progress = XX%"
                if line.contains("progress =") {
                    if let Some(pct_str) = line.split('=').nth(1) {
                        let pct_str = pct_str.trim().trim_end_matches('%');
                        if let Ok(pct) = pct_str.parse::<i32>() {
                            let _ = app_clone.emit("whisper-transcribe-progress", serde_json::json!({ 
                                "progress": pct, 
                                "audioPath": audio_path_clone 
                            }));
                        }
                    }
                }
            }
        });
    }
    
    // Wait for process to complete with timeout
    let wait_future = async {
        child.wait_with_output().await
    };
    
    let output = timeout(WHISPER_TIMEOUT, wait_future)
        .await
        .map_err(|_| {
            // Clear the PID on timeout
            if let Ok(mut guard) = WHISPER_PROCESS_ID.lock() {
                *guard = None;
            }
            format!("Transcription timeout after {} hours", WHISPER_TIMEOUT.as_secs() / 3600)
        })?
        .map_err(|e| {
            // Clear the PID on error
            if let Ok(mut guard) = WHISPER_PROCESS_ID.lock() {
                *guard = None;
            }
            format!("Failed to run whisper: {} (command: {})", e, cmd_debug)
        })?;
    
    // Clear the process ID now that transcription is complete
    if let Ok(mut guard) = WHISPER_PROCESS_ID.lock() {
        *guard = None;
    }
    
    // Emit completion
    let _ = app.emit("whisper-transcribe-progress", serde_json::json!({ 
        "progress": 100, 
        "audioPath": audio_path 
    }));
    
    if !output.status.success() {
        // Clean up temporary WAV file on error
        if let Some(ref wav_path) = temp_wav_path {
            let _ = std::fs::remove_file(wav_path);
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!("Transcription failed: {} {} (command: {})", stderr, stdout, cmd_debug));
    }
    
    // Check for output file - whisper-cli might create with different naming
    // Try expected path first, then look for any file matching the pattern
    let final_output = if expected_output.exists() {
        expected_output
    } else {
        // Look for files that match the pattern in the output directory
        let output_dir_path = Path::new(&output_dir);
        let _pattern = format!("{}.{}", audio_name, output_ext);
        
        let mut found_file = None;
        if let Ok(entries) = std::fs::read_dir(output_dir_path) {
            for entry in entries.flatten() {
                let file_name = entry.file_name();
                let file_name_str = file_name.to_string_lossy();
                if file_name_str.ends_with(&format!(".{}", output_ext)) && 
                   file_name_str.starts_with(audio_name) {
                    found_file = Some(entry.path());
                    break;
                }
            }
        }
        
        match found_file {
            Some(path) => path,
            None => {
                // Clean up temporary WAV file before returning error
                if let Some(ref wav_path) = temp_wav_path {
                    let _ = std::fs::remove_file(wav_path);
                }
                let stdout = String::from_utf8_lossy(&output.stdout);
                return Err(format!(
                    "Output file not created. Expected: {}. Command: {}. Output: {}", 
                    expected_output.display(), 
                    cmd_debug,
                    stdout
                ));
            }
        }
    };
    
    // Clean up temporary WAV file if we created one
    if let Some(ref wav_path) = temp_wav_path {
        let _ = std::fs::remove_file(wav_path);
    }
    
    Ok(final_output.to_str().unwrap().to_string())
}

/// Cancel ongoing transcription by killing the whisper process
#[tauri::command]
async fn cancel_transcription() -> Result<(), String> {
    let pid = {
        match WHISPER_PROCESS_ID.lock() {
            Ok(mut guard) => guard.take(),
            Err(_) => return Err("Failed to acquire process lock".to_string()),
        }
    };
    
    if let Some(pid) = pid {
        #[cfg(unix)]
        {
            // Send SIGTERM to gracefully terminate the whisper process
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
        
        #[cfg(windows)]
        {
            // On Windows, use taskkill
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F"])
                .output();
        }
        
        Ok(())
    } else {
        // No process running, that's fine
        Ok(())
    }
}

/// Convert audio file to a lightweight format for waveform visualization
/// Converts to low-bitrate MP3 for small file size while maintaining playability
/// Returns the path to the converted file in the system temp directory
#[tauri::command]
async fn convert_audio_for_waveform(audio_path: String) -> Result<String, String> {
    validate_media_path(&audio_path)?;
    
    let input = Path::new(&audio_path);
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    
    // Use system temp directory for waveform cache
    let temp_dir = std::env::temp_dir().join("rsextractor_waveform");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    
    // Create a unique filename based on the original path hash
    let path_hash = format!("{:x}", md5_hash(&audio_path));
    let output_path = temp_dir.join(format!("{}_{}.mp3", stem, &path_hash[..8]));
    let output_str = output_path.to_str().unwrap().to_string();
    
    // If already converted, return existing file
    if output_path.exists() {
        return Ok(output_str);
    }


    // FFmpeg command to convert to low-bitrate MP3
    let convert_future = async {
        Command::new("ffmpeg")
            .args([
                "-y",
                "-i", &audio_path,
                "-b:a", "128k",
                "-ac", "1",
                "-map", "a:0",  // Only first audio stream
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
            // Whisper commands
            check_whisper,
            get_whisper_version,
            get_whisper_models_path,
            list_whisper_models,
            download_whisper_model,
            delete_whisper_model,
            transcribe_audio,
            cancel_transcription,
            convert_audio_for_waveform
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
