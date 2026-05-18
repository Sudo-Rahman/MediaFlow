#![allow(dead_code)]

use std::path::{Path, PathBuf};

use crate::shared::process::tokio_command;
use serde_json::Value;

use crate::test_support::paths::new_temp_dir;
use crate::tools::ffprobe::probe::probe_file_with_ffprobe;

#[derive(Debug)]
pub(crate) struct GeneratedVideoFixture {
    _temp_dir: tempfile::TempDir,
    pub(crate) path: PathBuf,
    pub(crate) width: u64,
    pub(crate) height: u64,
}

#[derive(Debug)]
pub(crate) struct GeneratedAvFixture {
    _temp_dir: tempfile::TempDir,
    pub(crate) path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProbedVideoStream {
    pub(crate) codec_name: String,
    pub(crate) width: u64,
    pub(crate) height: u64,
    pub(crate) pixel_format: Option<String>,
    pub(crate) profile: Option<String>,
    pub(crate) codec_tag_string: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MediaStreamCounts {
    pub(crate) video_streams: usize,
    pub(crate) audio_streams: usize,
}

pub(crate) async fn generate_test_pattern_video(
    width: u64,
    height: u64,
) -> Result<GeneratedVideoFixture, String> {
    let temp_dir = new_temp_dir("video-fixture-");
    let path = temp_dir.path().join("testsrc.mkv");
    let filter = format!("testsrc2=size={}x{}:rate=12:duration=0.24", width, height);

    let output = tokio_command(crate::test_support::ffmpeg::ffmpeg_path())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            &filter,
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "ffv1",
            path.to_string_lossy().as_ref(),
        ])
        .output()
        .await
        .map_err(|error| format!("Failed to generate video fixture: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Failed to generate video fixture: {}",
            stderr.trim()
        ));
    }

    let probe =
        probe_primary_video_stream(crate::test_support::ffmpeg::ffprobe_path(), &path).await?;

    Ok(GeneratedVideoFixture {
        _temp_dir: temp_dir,
        path,
        width: probe.width,
        height: probe.height,
    })
}

pub(crate) async fn generate_test_pattern_av_mp4() -> Result<GeneratedAvFixture, String> {
    let temp_dir = new_temp_dir("av-fixture-");
    let path = temp_dir.path().join("test_av.mp4");

    let output = tokio_command(crate::test_support::ffmpeg::ffmpeg_path())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=160x90:rate=12:duration=0.24",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo",
            "-shortest",
            "-c:v",
            "mpeg4",
            "-q:v",
            "5",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            path.to_string_lossy().as_ref(),
        ])
        .output()
        .await
        .map_err(|error| format!("Failed to generate AV fixture: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to generate AV fixture: {}", stderr.trim()));
    }

    Ok(GeneratedAvFixture {
        _temp_dir: temp_dir,
        path,
    })
}

pub(crate) async fn probe_primary_video_stream(
    ffprobe_path: &str,
    path: &Path,
) -> Result<ProbedVideoStream, String> {
    let probe_json = probe_file_with_ffprobe(ffprobe_path, path.to_string_lossy().as_ref()).await?;
    let probe_value: Value = serde_json::from_str(&probe_json)
        .map_err(|error| format!("Invalid probe JSON: {}", error))?;
    let streams = probe_value
        .get("streams")
        .and_then(|value| value.as_array())
        .ok_or_else(|| {
            format!(
                "Probe output did not contain streams for {}",
                path.display()
            )
        })?;

    let stream = streams
        .iter()
        .find(|stream| {
            stream
                .get("codec_type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "video")
        })
        .ok_or_else(|| format!("No video stream found in {}", path.display()))?;

    Ok(ProbedVideoStream {
        codec_name: stream
            .get("codec_name")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        width: stream
            .get("width")
            .and_then(|value| value.as_u64())
            .unwrap_or_default(),
        height: stream
            .get("height")
            .and_then(|value| value.as_u64())
            .unwrap_or_default(),
        pixel_format: stream
            .get("pix_fmt")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        profile: stream
            .get("profile")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        codec_tag_string: stream
            .get("codec_tag_string")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
    })
}

pub(crate) async fn probe_media_stream_counts(
    ffprobe_path: &str,
    path: &Path,
) -> Result<MediaStreamCounts, String> {
    let probe_json = probe_file_with_ffprobe(ffprobe_path, path.to_string_lossy().as_ref()).await?;
    let probe_value: Value = serde_json::from_str(&probe_json)
        .map_err(|error| format!("Invalid probe JSON: {}", error))?;
    let streams = probe_value
        .get("streams")
        .and_then(|value| value.as_array())
        .ok_or_else(|| {
            format!(
                "Probe output did not contain streams for {}",
                path.display()
            )
        })?;

    let video_streams = streams
        .iter()
        .filter(|stream| {
            stream
                .get("codec_type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "video")
        })
        .count();
    let audio_streams = streams
        .iter()
        .filter(|stream| {
            stream
                .get("codec_type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "audio")
        })
        .count();

    Ok(MediaStreamCounts {
        video_streams,
        audio_streams,
    })
}
