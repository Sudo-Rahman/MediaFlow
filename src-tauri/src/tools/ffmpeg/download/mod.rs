use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::Manager;
use tokio::io::AsyncWriteExt;

use crate::tools::ffmpeg::download::progress::{DownloadTracker, emit_download_progress};

mod archive;
mod btbn;
mod evermeet;
mod progress;

#[derive(Serialize)]
pub(crate) struct DownloadResult {
    #[serde(rename = "ffmpegPath")]
    pub(crate) ffmpeg_path: String,
    #[serde(rename = "ffprobePath")]
    pub(crate) ffprobe_path: String,
    pub(crate) warning: Option<String>,
}

fn create_temp_dir(app: &tauri::AppHandle, prefix: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .temp_dir()
        .map_err(|e| format!("Failed to access temp directory: {}", e))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string());
    let dir = base.join(format!("{}_{}", prefix, nonce));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;
    Ok(dir)
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("RsExtractor/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

async fn download_to_file(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    tracker: &mut DownloadTracker,
    stage: &str,
) -> Result<(), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download FFmpeg: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let content_length = response.content_length();
    if let Some(len) = content_length {
        tracker.total_bytes = tracker.total_bytes.saturating_add(len);
    }

    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("Failed to create download file: {}", e))?;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Failed to read download stream: {}", e))?;
        tracker.downloaded_bytes = tracker.downloaded_bytes.saturating_add(bytes.len() as u64);
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("Failed to write download file: {}", e))?;

        let progress = if tracker.total_bytes > 0 {
            (tracker.downloaded_bytes as f64 / tracker.total_bytes as f64) * 90.0
        } else {
            0.0
        };
        emit_download_progress(app, progress.min(90.0), stage);
    }

    Ok(())
}

async fn install_binaries(
    app: &tauri::AppHandle,
    ffmpeg_src: &Path,
    ffprobe_src: &Path,
) -> Result<(PathBuf, PathBuf), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to access app data directory: {}", e))?;
    let bin_dir = app_data_dir.join("ffmpeg").join("bin");

    tokio::fs::create_dir_all(&bin_dir)
        .await
        .map_err(|e| format!("Failed to create FFmpeg install directory: {}", e))?;

    let ffmpeg_dest = bin_dir.join(archive::binary_file_name("ffmpeg"));
    let ffprobe_dest = bin_dir.join(archive::binary_file_name("ffprobe"));

    if ffmpeg_dest.exists() {
        let _ = tokio::fs::remove_file(&ffmpeg_dest).await;
    }
    if ffprobe_dest.exists() {
        let _ = tokio::fs::remove_file(&ffprobe_dest).await;
    }

    tokio::fs::copy(ffmpeg_src, &ffmpeg_dest)
        .await
        .map_err(|e| format!("Failed to install ffmpeg: {}", e))?;
    tokio::fs::copy(ffprobe_src, &ffprobe_dest)
        .await
        .map_err(|e| format!("Failed to install ffprobe: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut ffmpeg_perms = std::fs::metadata(&ffmpeg_dest)
            .map_err(|e| format!("Failed to read ffmpeg permissions: {}", e))?
            .permissions();
        ffmpeg_perms.set_mode(0o755);
        tokio::fs::set_permissions(&ffmpeg_dest, ffmpeg_perms)
            .await
            .map_err(|e| format!("Failed to set ffmpeg permissions: {}", e))?;

        let mut ffprobe_perms = std::fs::metadata(&ffprobe_dest)
            .map_err(|e| format!("Failed to read ffprobe permissions: {}", e))?
            .permissions();
        ffprobe_perms.set_mode(0o755);
        tokio::fs::set_permissions(&ffprobe_dest, ffprobe_perms)
            .await
            .map_err(|e| format!("Failed to set ffprobe permissions: {}", e))?;
    }

    Ok((ffmpeg_dest, ffprobe_dest))
}

/// Download and install FFmpeg + FFprobe for the current OS/arch
#[tauri::command]
pub(crate) async fn download_ffmpeg(app: tauri::AppHandle) -> Result<DownloadResult, String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    match os {
        "macos" => evermeet::download_from_evermeet(&app, arch).await,
        "windows" | "linux" => btbn::download_from_btbn(&app, os, arch).await,
        _ => Err(format!("Unsupported OS: {}", os)),
    }
}
