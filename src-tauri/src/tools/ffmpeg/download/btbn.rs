use std::path::PathBuf;

use crate::tools::ffmpeg::download::archive::{
    archive_type_from_url, binary_file_name, extract_archive, find_binary_path,
};
use crate::tools::ffmpeg::download::progress::{DownloadTracker, emit_download_progress};
use crate::tools::ffmpeg::download::{
    create_temp_dir, download_to_file, http_client, install_binaries,
};

/// Official download source (build list)
const BTBN_LATEST_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/wiki/Latest";

pub(super) fn resolve_btbn_variant(os: &str, arch: &str) -> Result<&'static str, String> {
    match (os, arch) {
        ("windows", "x86_64") => Ok("win64-gpl-8.0"),
        ("windows", "aarch64") => Ok("winarm64-gpl-8.0"),
        ("linux", "x86_64") => Ok("linux64-gpl-8.0"),
        ("linux", "aarch64") => Ok("linuxarm64-gpl-8.0"),
        _ => Err(format!("Unsupported platform: {} {}", os, arch)),
    }
}

fn find_btbn_url(
    page: &str,
    variant: &str,
    preferred_ext: &str,
    fallback_ext: &str,
) -> Option<String> {
    let preferred = find_btbn_url_with_ext(page, variant, preferred_ext);
    if preferred.is_some() {
        return preferred;
    }
    find_btbn_url_with_ext(page, variant, fallback_ext)
}

fn find_btbn_url_with_ext(page: &str, variant: &str, ext: &str) -> Option<String> {
    for token in page.split('"') {
        if !token.contains("releases/download/") {
            continue;
        }
        if !token.contains(variant) || !token.ends_with(ext) {
            continue;
        }
        if token.starts_with("http") {
            return Some(token.to_string());
        }
        if token.starts_with('/') {
            return Some(format!("https://github.com{}", token));
        }
    }
    None
}

pub(super) async fn download_from_btbn(
    app: &tauri::AppHandle,
    os: &str,
    arch: &str,
) -> Result<super::DownloadResult, String> {
    let variant = resolve_btbn_variant(os, arch)?;
    let client = http_client()?;
    let mut tracker = DownloadTracker::default();

    emit_download_progress(app, 0.0, "Preparing download...");

    let response = client
        .get(BTBN_LATEST_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch FFmpeg build list: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch FFmpeg build list: {}",
            response.status()
        ));
    }
    let page = response
        .text()
        .await
        .map_err(|e| format!("Failed to read FFmpeg build list: {}", e))?;

    let preferred_ext = if os == "windows" { ".zip" } else { ".tar.xz" };
    let url = find_btbn_url(&page, variant, preferred_ext, ".zip")
        .ok_or_else(|| format!("Failed to locate FFmpeg build for {}", variant))?;
    let archive_type = archive_type_from_url(&url)?;

    let temp_dir = create_temp_dir(app, "ffmpeg_btbn")?;
    let archive_path: PathBuf = match archive_type {
        crate::tools::ffmpeg::download::archive::ArchiveType::Zip => temp_dir.join("ffmpeg.zip"),
        crate::tools::ffmpeg::download::archive::ArchiveType::TarXz => {
            temp_dir.join("ffmpeg.tar.xz")
        }
    };
    download_to_file(
        app,
        &client,
        &url,
        &archive_path,
        &mut tracker,
        "Downloading FFmpeg...",
    )
    .await?;

    let extract_dir = temp_dir.join("extracted");
    emit_download_progress(app, 92.0, "Extracting archive...");
    extract_archive(archive_path, extract_dir.clone(), archive_type).await?;

    let ffmpeg_name = binary_file_name("ffmpeg");
    let ffprobe_name = binary_file_name("ffprobe");
    let (ffmpeg_src, ffprobe_src) = tokio::task::spawn_blocking(move || {
        let ffmpeg_src = find_binary_path(&extract_dir, &ffmpeg_name)?;
        let ffprobe_src = find_binary_path(&extract_dir, &ffprobe_name)?;
        Ok::<_, String>((ffmpeg_src, ffprobe_src))
    })
    .await
    .map_err(|e| format!("Failed to locate FFmpeg binaries: {}", e))??;

    emit_download_progress(app, 96.0, "Installing binaries...");
    let (ffmpeg_dest, ffprobe_dest) = install_binaries(app, &ffmpeg_src, &ffprobe_src).await?;
    emit_download_progress(app, 100.0, "FFmpeg installed");

    Ok(super::DownloadResult {
        ffmpeg_path: ffmpeg_dest.to_string_lossy().to_string(),
        ffprobe_path: ffprobe_dest.to_string_lossy().to_string(),
        warning: None,
    })
}
