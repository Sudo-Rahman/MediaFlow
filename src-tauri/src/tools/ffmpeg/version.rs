use crate::shared::store::{resolve_ffmpeg_path, resolve_ffprobe_path};
use tokio::process::Command;

fn parse_ffmpeg_version(stdout: &[u8]) -> Option<String> {
    let version_str = String::from_utf8_lossy(stdout);
    version_str
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(2))
        .map(|version| version.to_string())
}

async fn check_ffmpeg_paths(ffprobe_path: &str, ffmpeg_path: &str) -> Result<bool, String> {
    let ffprobe_check = Command::new(ffprobe_path).arg("-version").output().await;
    let ffmpeg_check = Command::new(ffmpeg_path).arg("-version").output().await;

    match (ffprobe_check, ffmpeg_check) {
        (Ok(probe), Ok(mpeg)) if probe.status.success() && mpeg.status.success() => Ok(true),
        _ => Ok(false),
    }
}

async fn get_ffmpeg_version_from_path(ffmpeg_path: &str) -> Result<String, String> {
    let output = Command::new(ffmpeg_path)
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

#[cfg(test)]
mod tests {
    use super::{check_ffmpeg_paths, get_ffmpeg_version_from_path, parse_ffmpeg_version};

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

        let available = check_ffmpeg_paths("ffprobe", "ffmpeg")
            .await
            .expect("check_ffmpeg command should succeed");
        assert!(available);

        let version = get_ffmpeg_version_from_path("ffmpeg")
            .await
            .expect("get_ffmpeg_version command should succeed");
        assert!(!version.trim().is_empty());
    }
}
