use crate::shared::process::tokio_command;
use crate::shared::store::{
    BinaryPathSource, resolve_ffmpeg_path, resolve_ffmpeg_path_with_source, resolve_ffprobe_path,
    resolve_ffprobe_path_with_source,
};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FfmpegInfo {
    pub(crate) ffmpeg_path: String,
    pub(crate) ffprobe_path: String,
    pub(crate) source: BinaryPathSource,
    pub(crate) ffmpeg_source: BinaryPathSource,
    pub(crate) ffprobe_source: BinaryPathSource,
    pub(crate) version: String,
}

fn parse_ffmpeg_version(stdout: &[u8]) -> Option<String> {
    let version_str = String::from_utf8_lossy(stdout);
    version_str
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(2))
        .map(|version| version.to_string())
}

async fn check_ffmpeg_paths(ffprobe_path: &str, ffmpeg_path: &str) -> Result<bool, String> {
    let ffprobe_check = tokio_command(ffprobe_path).arg("-version").output().await;
    let ffmpeg_check = tokio_command(ffmpeg_path).arg("-version").output().await;

    match (ffprobe_check, ffmpeg_check) {
        (Ok(probe), Ok(mpeg)) if probe.status.success() && mpeg.status.success() => Ok(true),
        _ => Ok(false),
    }
}

async fn get_ffmpeg_version_from_path(ffmpeg_path: &str) -> Result<String, String> {
    let output = tokio_command(ffmpeg_path)
        .arg("-version")
        .output()
        .await
        .map_err(|e| format!("Failed to get FFmpeg version: {}", e))?;

    if output.status.success() {
        Ok(parse_ffmpeg_version(&output.stdout).unwrap_or_else(|| "Unknown".to_string()))
    } else {
        Err("FFmpeg not found".to_string())
    }
}

async fn get_ffmpeg_info_from_paths(
    ffmpeg_path: &str,
    ffprobe_path: &str,
    ffmpeg_source: BinaryPathSource,
    ffprobe_source: BinaryPathSource,
) -> Result<FfmpegInfo, String> {
    let available = check_ffmpeg_paths(ffprobe_path, ffmpeg_path).await?;
    if !available {
        return Err("FFmpeg or FFprobe not found".to_string());
    }

    let version = get_ffmpeg_version_from_path(ffmpeg_path).await?;
    Ok(FfmpegInfo {
        ffmpeg_path: ffmpeg_path.to_string(),
        ffprobe_path: ffprobe_path.to_string(),
        source: ffmpeg_source,
        ffmpeg_source,
        ffprobe_source,
        version,
    })
}

/// Check if ffmpeg and ffprobe are available
#[tauri::command]
pub(crate) async fn check_ffmpeg(app: tauri::AppHandle) -> Result<bool, String> {
    let ffprobe_path = resolve_ffprobe_path(&app)?;
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    check_ffmpeg_paths(&ffprobe_path, &ffmpeg_path).await
}

/// Get FFmpeg version string
#[tauri::command]
pub(crate) async fn get_ffmpeg_version(app: tauri::AppHandle) -> Result<String, String> {
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    get_ffmpeg_version_from_path(&ffmpeg_path).await
}

/// Get the active FFmpeg/FFprobe paths, version, and source.
#[tauri::command]
pub(crate) async fn get_ffmpeg_info(app: tauri::AppHandle) -> Result<FfmpegInfo, String> {
    let ffmpeg = resolve_ffmpeg_path_with_source(&app)?;
    let ffprobe = resolve_ffprobe_path_with_source(&app)?;
    get_ffmpeg_info_from_paths(&ffmpeg.path, &ffprobe.path, ffmpeg.source, ffprobe.source).await
}

#[cfg(test)]
mod tests {
    use crate::shared::store::BinaryPathSource;

    use super::{
        check_ffmpeg_paths, get_ffmpeg_info_from_paths, get_ffmpeg_version_from_path,
        parse_ffmpeg_version,
    };

    #[test]
    fn parse_ffmpeg_version_extracts_version_from_first_line() {
        let output = b"ffmpeg version 7.1.1 Copyright\nbuilt with clang";
        let parsed = parse_ffmpeg_version(output);
        assert_eq!(parsed, Some("7.1.1".to_string()));
    }

    #[test]
    fn parse_ffmpeg_version_returns_none_for_unexpected_output() {
        let output = b"unexpected";
        let parsed = parse_ffmpeg_version(output);
        assert_eq!(parsed, None);
    }

    #[tokio::test]
    async fn ffmpeg_commands_detect_installed_ffmpeg() {
        let available = check_ffmpeg_paths(
            crate::test_support::ffmpeg::ffprobe_path(),
            crate::test_support::ffmpeg::ffmpeg_path(),
        )
        .await
        .expect("check_ffmpeg command should succeed");
        assert!(available);

        let version = get_ffmpeg_version_from_path(crate::test_support::ffmpeg::ffmpeg_path())
            .await
            .expect("get_ffmpeg_version command should succeed");
        assert!(!version.trim().is_empty());
    }

    #[tokio::test]
    async fn ffmpeg_info_reports_source_and_version() {
        let info = get_ffmpeg_info_from_paths(
            crate::test_support::ffmpeg::ffmpeg_path(),
            crate::test_support::ffmpeg::ffprobe_path(),
            BinaryPathSource::System,
            BinaryPathSource::System,
        )
        .await
        .expect("ffmpeg info should be available");

        assert_eq!(info.source, BinaryPathSource::System);
        assert!(!info.version.trim().is_empty());
    }
}
