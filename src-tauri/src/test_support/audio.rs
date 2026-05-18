#![allow(dead_code)]

use std::path::{Path, PathBuf};

use crate::shared::process::tokio_command;
use serde_json::Value;

use crate::test_support::paths::new_temp_dir;
use crate::tools::ffprobe::probe::probe_file_with_ffprobe;

#[derive(Debug)]
pub(crate) struct GeneratedAudioFixture {
    _temp_dir: tempfile::TempDir,
    pub(crate) path: PathBuf,
    pub(crate) channels: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProbedAudioStream {
    pub(crate) codec_name: String,
    pub(crate) channels: u64,
    pub(crate) channel_layout: Option<String>,
    pub(crate) sample_rate: Option<u32>,
    pub(crate) bit_rate: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AudioEncoderRuntimeInfo {
    pub(crate) supported_sample_rates: Vec<u32>,
}

pub(crate) async fn generate_silence_wav(
    channel_layout: &str,
) -> Result<GeneratedAudioFixture, String> {
    let layout_id = sanitize_for_file_name(channel_layout);
    let temp_dir = new_temp_dir(&format!("audio-fixture-{}-", layout_id));
    let path = temp_dir.path().join(format!("{}.wav", layout_id));

    let output = tokio_command(crate::test_support::ffmpeg::ffmpeg_path())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-t",
            "0.12",
            "-i",
            &format!("anullsrc=r=48000:cl={}", channel_layout),
            "-c:a",
            "pcm_s16le",
            path.to_string_lossy().as_ref(),
        ])
        .output()
        .await
        .map_err(|error| {
            format!(
                "Failed to generate {} test fixture: {}",
                channel_layout, error
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Failed to generate {} test fixture: {}",
            channel_layout,
            stderr.trim()
        ));
    }

    let probe =
        probe_primary_audio_stream(crate::test_support::ffmpeg::ffprobe_path(), &path).await?;

    Ok(GeneratedAudioFixture {
        _temp_dir: temp_dir,
        path,
        channels: probe.channels,
    })
}

pub(crate) async fn probe_primary_audio_stream(
    ffprobe_path: &str,
    path: &Path,
) -> Result<ProbedAudioStream, String> {
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
                .is_some_and(|value| value == "audio")
        })
        .ok_or_else(|| format!("No audio stream found in {}", path.display()))?;

    Ok(ProbedAudioStream {
        codec_name: stream
            .get("codec_name")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        channels: stream
            .get("channels")
            .and_then(|value| value.as_u64())
            .unwrap_or_default(),
        channel_layout: stream
            .get("channel_layout")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        sample_rate: stream
            .get("sample_rate")
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse::<u32>().ok()),
        bit_rate: stream
            .get("bit_rate")
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse::<u64>().ok()),
    })
}

pub(crate) async fn probe_audio_encoder_runtime_info(
    ffmpeg_path: &str,
    encoder_id: &str,
) -> Result<AudioEncoderRuntimeInfo, String> {
    let output = tokio_command(ffmpeg_path)
        .args(["-hide_banner", "-h", &format!("encoder={}", encoder_id)])
        .output()
        .await
        .map_err(|error| format!("Failed to probe encoder {}: {}", encoder_id, error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Failed to probe encoder {}: {}",
            encoder_id,
            stderr.trim()
        ));
    }

    let help = String::from_utf8_lossy(&output.stdout);

    Ok(AudioEncoderRuntimeInfo {
        supported_sample_rates: parse_supported_sample_rates(&help),
    })
}

fn parse_supported_sample_rates(help: &str) -> Vec<u32> {
    help.lines()
        .find_map(|line| {
            line.split_once("Supported sample rates:")
                .map(|(_, values)| {
                    values
                        .split_whitespace()
                        .filter_map(|value| value.parse::<u32>().ok())
                        .collect::<Vec<_>>()
                })
        })
        .unwrap_or_default()
}

fn sanitize_for_file_name(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect()
}
