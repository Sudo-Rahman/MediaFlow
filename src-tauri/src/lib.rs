use serde::{Deserialize, Serialize};
use std::process::Command;
use tiktoken_rs::o200k_base_singleton;
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

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

/// Probe a video file using ffprobe and return JSON output
#[tauri::command]
async fn probe_file(path: String) -> Result<String, String> {
    let output = Command::new("ffprobe")
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

/// Extract a track from a video file using ffmpeg
#[tauri::command]
async fn extract_track(
    input_path: String,
    output_path: String,
    track_index: i32,
    track_type: String,
    codec: String,
) -> Result<(), String> {
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

    let output = Command::new("ffmpeg").args(&args).output().map_err(|e| {
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

/// Open a folder in the system file manager
#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
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

/// Check if ffmpeg and ffprobe are available
#[tauri::command]
async fn check_ffmpeg() -> Result<bool, String> {
    let ffprobe_check = Command::new("ffprobe").arg("-version").output();

    let ffmpeg_check = Command::new("ffmpeg").arg("-version").output();

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

/// Rename a file on disk
#[tauri::command]
async fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename file: {}", e))
}

/// Copy a file to a new location
#[tauri::command]
async fn copy_file(source_path: String, dest_path: String) -> Result<(), String> {
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

/// Merge tracks into a video file
#[tauri::command]
async fn merge_tracks(
    video_path: String,
    tracks: Vec<serde_json::Value>,
    source_track_configs: Option<Vec<serde_json::Value>>,
    output_path: String,
) -> Result<(), String> {
    // First, probe the video to count streams and get their types
    let probe_output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            &video_path,
        ])
        .output()
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
    args.push(output_path);

    let output = Command::new("ffmpeg")
        .args(&args)
        .output()
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
            count_tokens
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
