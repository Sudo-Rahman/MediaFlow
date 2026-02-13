use crate::tools::ffmpeg::download::archive::{
    ArchiveType, binary_file_name, extract_archive, find_binary_path,
};
use crate::tools::ffmpeg::download::progress::{DownloadTracker, emit_download_progress};
use crate::tools::ffmpeg::download::{
    create_temp_dir, download_to_file, http_client, install_binaries,
};

/// Official download sources
const EVERMEET_RELEASE_FFMPEG_URL: &str = "https://evermeet.cx/ffmpeg/getrelease/zip";
const EVERMEET_RELEASE_FFPROBE_URL: &str = "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip";

pub(super) async fn download_from_evermeet(
    app: &tauri::AppHandle,
    arch: &str,
) -> Result<super::DownloadResult, String> {
    let temp_dir = create_temp_dir(app, "ffmpeg_evermeet")?;
    let client = http_client()?;
    let mut tracker = DownloadTracker::default();

    emit_download_progress(app, 0.0, "Preparing download...");

    let ffmpeg_archive = temp_dir.join("ffmpeg.zip");
    let ffprobe_archive = temp_dir.join("ffprobe.zip");
    download_to_file(
        app,
        &client,
        EVERMEET_RELEASE_FFMPEG_URL,
        &ffmpeg_archive,
        &mut tracker,
        "Downloading FFmpeg...",
    )
    .await?;
    download_to_file(
        app,
        &client,
        EVERMEET_RELEASE_FFPROBE_URL,
        &ffprobe_archive,
        &mut tracker,
        "Downloading FFprobe...",
    )
    .await?;

    let ffmpeg_extract = temp_dir.join("ffmpeg");
    let ffprobe_extract = temp_dir.join("ffprobe");
    emit_download_progress(app, 92.0, "Extracting archives...");
    extract_archive(ffmpeg_archive, ffmpeg_extract.clone(), ArchiveType::Zip).await?;
    extract_archive(ffprobe_archive, ffprobe_extract.clone(), ArchiveType::Zip).await?;

    let ffmpeg_name = binary_file_name("ffmpeg");
    let ffprobe_name = binary_file_name("ffprobe");
    let (ffmpeg_src, ffprobe_src) = tokio::task::spawn_blocking(move || {
        let ffmpeg_src = find_binary_path(&ffmpeg_extract, &ffmpeg_name)?;
        let ffprobe_src = find_binary_path(&ffprobe_extract, &ffprobe_name)?;
        Ok::<_, String>((ffmpeg_src, ffprobe_src))
    })
    .await
    .map_err(|e| format!("Failed to locate FFmpeg binaries: {}", e))??;

    emit_download_progress(app, 96.0, "Installing binaries...");
    let (ffmpeg_dest, ffprobe_dest) = install_binaries(app, &ffmpeg_src, &ffprobe_src).await?;
    emit_download_progress(app, 100.0, "FFmpeg installed");

    let warning = if arch == "aarch64" {
        Some(
            "Evermeet does not provide native Apple Silicon builds. The Intel binary may require Rosetta."
                .to_string(),
        )
    } else {
        None
    };

    Ok(super::DownloadResult {
        ffmpeg_path: ffmpeg_dest.to_string_lossy().to_string(),
        ffprobe_path: ffprobe_dest.to_string_lossy().to_string(),
        warning,
    })
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    #[ignore = "network integration test; run explicitly when internet is available"]
    async fn evermeet_release_endpoints_are_reachable() {
        let client = reqwest::Client::builder()
            .user_agent("RsExtractor-Tests/1.0")
            .no_proxy()
            .build()
            .expect("failed to create client");

        async fn fetch_head_status(client: &reqwest::Client, url: &str) -> Result<reqwest::StatusCode, String> {
            let mut last_error = String::new();
            for _ in 0..2 {
                let response = tokio::time::timeout(
                    std::time::Duration::from_secs(20),
                    client.head(url).send(),
                )
                .await;

                match response {
                    Ok(Ok(resp)) => return Ok(resp.status()),
                    Ok(Err(e)) => last_error = format!("request failed: {}", e),
                    Err(_) => last_error = "request timed out".to_string(),
                }
            }

            Err(last_error)
        }

        let ffmpeg_status = fetch_head_status(&client, super::EVERMEET_RELEASE_FFMPEG_URL)
            .await
            .expect("failed to query ffmpeg endpoint");
        let ffprobe_status = fetch_head_status(&client, super::EVERMEET_RELEASE_FFPROBE_URL)
            .await
            .expect("failed to query ffprobe endpoint");

        assert!(ffmpeg_status.is_success() || ffmpeg_status.is_redirection());
        assert!(ffprobe_status.is_success() || ffprobe_status.is_redirection());
    }
}
