use std::path::Path;
use std::process::Stdio;

use crate::shared::process::{tokio_command, wait_with_output_progress_watchdog};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::shared::ffmpeg_progress::{FfmpegProgressTracker, LONG_FFMPEG_PROGRESS_TIMEOUT};
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::store::{resolve_ffmpeg_path, resolve_ffprobe_path};
use crate::shared::validation::{validate_media_path, validate_output_path};
use crate::tools::ffprobe::{parse_duration_us_from_probe_json, probe::probe_file_with_ffprobe};
use crate::tools::media_metadata::{
    MediaMetadataRequest, OutputStreamMetadata, apply_metadata_args,
    output_stream_metadata_from_request,
};

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeProgressEvent {
    pub(crate) input_path: String,
    pub(crate) output_path: String,
    pub(crate) progress: i32,
    pub(crate) speed_bytes_per_sec: Option<f64>,
    pub(crate) current_frame: Option<u64>,
    pub(crate) total_frames: Option<u64>,
    pub(crate) frames_per_second: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeAdditionalArg {
    #[serde(rename = "id")]
    pub(crate) _id: Option<String>,
    pub(crate) flag: String,
    pub(crate) value: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeVideoSettings {
    pub(crate) mode: String,
    pub(crate) encoder_id: Option<String>,
    pub(crate) profile: Option<String>,
    pub(crate) level: Option<String>,
    pub(crate) pixel_format: Option<String>,
    pub(crate) quality_mode: Option<String>,
    pub(crate) crf: Option<f64>,
    pub(crate) qp: Option<i32>,
    pub(crate) bitrate_kbps: Option<u32>,
    pub(crate) preset: Option<String>,
    #[serde(default)]
    pub(crate) additional_args: Vec<TranscodeAdditionalArg>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeAudioTrackOverride {
    pub(crate) track_id: usize,
    pub(crate) mode: String,
    pub(crate) encoder_id: Option<String>,
    pub(crate) bitrate_kbps: Option<u32>,
    pub(crate) channels: Option<u8>,
    pub(crate) sample_rate: Option<u32>,
    #[serde(default)]
    pub(crate) additional_args: Vec<TranscodeAdditionalArg>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeAudioSettings {
    pub(crate) mode: String,
    pub(crate) encoder_id: Option<String>,
    pub(crate) bitrate_kbps: Option<u32>,
    pub(crate) channels: Option<u8>,
    pub(crate) sample_rate: Option<u32>,
    #[serde(default)]
    pub(crate) additional_args: Vec<TranscodeAdditionalArg>,
    #[serde(default)]
    pub(crate) track_overrides: Vec<TranscodeAudioTrackOverride>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeSubtitleSettings {
    pub(crate) mode: String,
    pub(crate) encoder_id: Option<String>,
    #[serde(default)]
    pub(crate) additional_args: Vec<TranscodeAdditionalArg>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeRequest {
    pub(crate) input_path: String,
    pub(crate) output_path: String,
    pub(crate) container_id: String,
    pub(crate) video: TranscodeVideoSettings,
    pub(crate) audio: TranscodeAudioSettings,
    pub(crate) subtitles: TranscodeSubtitleSettings,
    #[serde(default)]
    pub(crate) metadata: MediaMetadataRequest,
}

#[derive(Debug, Clone)]
struct StreamInfo {
    stream_index: usize,
    relative_index: usize,
    codec_name: String,
    channels: u64,
    channel_layout: Option<String>,
    probe_stream: Value,
}

#[derive(Debug, Clone)]
struct ResolvedAudioSettings {
    mode: String,
    encoder_id: Option<String>,
    bitrate_kbps: Option<u32>,
    channels: Option<u8>,
    sample_rate: Option<u32>,
    additional_args: Vec<TranscodeAdditionalArg>,
}

fn emit_transcode_progress(
    app: &tauri::AppHandle,
    input_path: &str,
    output_path: &str,
    progress: i32,
    speed_bytes_per_sec: Option<f64>,
    current_frame: Option<u64>,
    total_frames: Option<u64>,
    frames_per_second: Option<f64>,
) {
    let _ = app.emit(
        "media-transcode-progress",
        serde_json::json!({
            "inputPath": input_path,
            "outputPath": output_path,
            "progress": progress,
            "speedBytesPerSec": speed_bytes_per_sec,
            "currentFrame": current_frame,
            "totalFrames": total_frames,
            "framesPerSecond": frames_per_second
        }),
    );
}

fn is_text_subtitle_codec(codec: &str) -> bool {
    matches!(
        codec,
        "ass"
            | "ssa"
            | "srt"
            | "subrip"
            | "mov_text"
            | "text"
            | "ttml"
            | "webvtt"
            | "jacosub"
            | "microdvd"
    )
}

fn can_copy_subtitle_codec(container_id: &str, codec: &str) -> bool {
    matches!(
        (container_id, codec),
        ("mp4", "mov_text" | "tx3g")
            | ("mov", "mov_text" | "tx3g")
            | (
                "mkv",
                "ass" | "dvd_subtitle" | "hdmv_pgs_subtitle" | "ssa" | "srt" | "subrip" | "webvtt"
            )
            | ("webm", "webvtt")
    )
}

fn can_copy_video_codec(container_id: &str, codec: &str) -> bool {
    matches!(
        (container_id, codec),
        (
            "mp4",
            "av1" | "h264" | "hevc" | "mjpeg" | "mpeg4" | "prores"
        ) | (
            "mov",
            "av1" | "dvvideo" | "h264" | "hevc" | "mjpeg" | "mpeg4" | "prores"
        ) | (
            "mkv",
            "av1"
                | "ffv1"
                | "h264"
                | "hevc"
                | "mjpeg"
                | "mpeg2video"
                | "mpeg4"
                | "prores"
                | "theora"
                | "vp8"
                | "vp9"
        ) | ("webm", "av1" | "vp8" | "vp9")
    )
}

fn can_copy_audio_codec(container_id: &str, codec: &str) -> bool {
    matches!(
        (container_id, codec),
        (
            "mov",
            "aac"
                | "ac3"
                | "alac"
                | "eac3"
                | "mp3"
                | "pcm_f32le"
                | "pcm_f64le"
                | "pcm_s16le"
                | "pcm_s24le"
                | "pcm_s32le"
        ) | ("mp4", "aac" | "ac3" | "alac" | "eac3" | "mp3")
            | (
                "mkv",
                "aac"
                    | "ac3"
                    | "alac"
                    | "dts"
                    | "eac3"
                    | "flac"
                    | "mp2"
                    | "mp3"
                    | "opus"
                    | "pcm_f32le"
                    | "pcm_f64le"
                    | "pcm_s16le"
                    | "pcm_s24le"
                    | "pcm_s32le"
                    | "truehd"
                    | "vorbis"
            )
            | ("webm", "opus" | "vorbis")
            | ("aac", "aac")
            | ("mp3", "mp3")
            | ("flac", "flac")
            | ("opus", "opus")
            | ("ogg", "flac" | "opus" | "vorbis")
            | (
                "wav",
                "pcm_alaw"
                    | "pcm_f32le"
                    | "pcm_f64le"
                    | "pcm_mulaw"
                    | "pcm_s16le"
                    | "pcm_s24le"
                    | "pcm_s32le"
                    | "pcm_u8"
            )
    )
}

fn validate_output_path_matches_container(request: &TranscodeRequest) -> Result<(), String> {
    let Some(expected_extension) =
        super::capabilities::container_extension_for_id(&request.container_id)
    else {
        return Ok(());
    };

    let actual_extension = Path::new(&request.output_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value.to_lowercase()))
        .unwrap_or_default();

    if actual_extension != expected_extension {
        return Err(format!(
            "Output path extension {} does not match the selected container {} (expected {}). Update the output filename in the Output tab.",
            if actual_extension.is_empty() {
                "(none)"
            } else {
                actual_extension.as_str()
            },
            request.container_id.to_uppercase(),
            expected_extension
        ));
    }

    Ok(())
}

fn extract_streams_by_type(streams: &[Value], codec_type: &str) -> Vec<StreamInfo> {
    streams
        .iter()
        .filter(|stream| {
            stream
                .get("codec_type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == codec_type)
        })
        .enumerate()
        .map(|(relative_index, stream)| StreamInfo {
            stream_index: stream
                .get("index")
                .and_then(|value| value.as_u64())
                .unwrap_or(relative_index as u64) as usize,
            relative_index,
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
            probe_stream: stream.clone(),
        })
        .collect()
}

fn parse_positive_u64_value(value: Option<&Value>) -> Option<u64> {
    match value? {
        Value::Number(number) => number.as_u64().filter(|value| *value > 0),
        Value::String(value) => value.trim().parse::<u64>().ok().filter(|value| *value > 0),
        _ => None,
    }
}

fn parse_frame_rate_ratio(value: Option<&Value>) -> Option<f64> {
    let raw = value?.as_str()?.trim();
    if raw.is_empty() || raw == "0/0" || raw.eq_ignore_ascii_case("n/a") {
        return None;
    }

    if let Some((numerator, denominator)) = raw.split_once('/') {
        let numerator = numerator.trim().parse::<f64>().ok()?;
        let denominator = denominator.trim().parse::<f64>().ok()?;
        if denominator <= 0.0 {
            return None;
        }

        let rate = numerator / denominator;
        return rate.is_finite().then_some(rate).filter(|rate| *rate > 0.0);
    }

    raw.parse::<f64>()
        .ok()
        .filter(|rate| rate.is_finite() && *rate > 0.0)
}

fn resolve_primary_video_total_frames(streams: &[Value], duration_us: Option<u64>) -> Option<u64> {
    let stream = streams.iter().find(|stream| {
        stream
            .get("codec_type")
            .and_then(|value| value.as_str())
            .is_some_and(|value| value == "video")
    })?;

    parse_positive_u64_value(stream.get("nb_frames"))
        .or_else(|| {
            stream
                .get("tags")
                .and_then(|tags| parse_positive_u64_value(tags.get("NUMBER_OF_FRAMES")))
        })
        .or_else(|| {
            let duration_seconds = duration_us? as f64 / 1_000_000.0;
            let frame_rate = parse_frame_rate_ratio(stream.get("avg_frame_rate"))
                .or_else(|| parse_frame_rate_ratio(stream.get("r_frame_rate")))?;
            let total_frames = (duration_seconds * frame_rate).round();
            total_frames
                .is_finite()
                .then_some(total_frames as u64)
                .filter(|value| *value > 0)
        })
}

fn has_enabled_additional_arg(additional_args: &[TranscodeAdditionalArg], flag: &str) -> bool {
    additional_args
        .iter()
        .any(|additional_arg| additional_arg.enabled && additional_arg.flag.trim() == flag)
}

fn libopus_uses_default_mapping_family(channel_layout: &str) -> bool {
    matches!(
        channel_layout,
        "mono" | "stereo" | "3.0" | "quad" | "5.0" | "5.1" | "6.1" | "7.1"
    )
}

fn resolve_audio_settings_for_stream(
    request: &TranscodeRequest,
    stream: &StreamInfo,
) -> ResolvedAudioSettings {
    let track_override = request
        .audio
        .track_overrides
        .iter()
        .find(|track_override| track_override.track_id == stream.stream_index);

    ResolvedAudioSettings {
        mode: track_override
            .map(|track_override| track_override.mode.clone())
            .unwrap_or_else(|| request.audio.mode.clone()),
        encoder_id: track_override
            .and_then(|track_override| track_override.encoder_id.clone())
            .or_else(|| request.audio.encoder_id.clone()),
        bitrate_kbps: track_override
            .and_then(|track_override| track_override.bitrate_kbps)
            .or(request.audio.bitrate_kbps),
        channels: track_override
            .and_then(|track_override| track_override.channels)
            .or(request.audio.channels),
        sample_rate: track_override
            .and_then(|track_override| track_override.sample_rate)
            .or(request.audio.sample_rate),
        additional_args: {
            let mut additional_args = request.audio.additional_args.clone();
            if let Some(track_override) = track_override {
                additional_args.extend(track_override.additional_args.clone());
            }
            additional_args
        },
    }
}

fn should_force_libopus_mapping_family_255(
    settings: &ResolvedAudioSettings,
    stream: &StreamInfo,
    additional_args: &[TranscodeAdditionalArg],
) -> bool {
    if settings.encoder_id.as_deref() != Some("libopus")
        || settings.channels.is_some()
        || has_enabled_additional_arg(additional_args, "-mapping_family")
    {
        return false;
    }

    let channel_layout = stream.channel_layout.as_deref().unwrap_or_default();

    stream.channels > 2
        && !channel_layout.is_empty()
        && !libopus_uses_default_mapping_family(channel_layout)
        && !has_enabled_additional_arg(additional_args, "-mapping_family")
}

fn qualify_stream_option(flag: &str, stream_specifier: Option<&str>) -> String {
    if let Some(stream_specifier) = stream_specifier {
        if flag.contains(':') {
            return flag.to_string();
        }

        return format!("{}:{}", flag, stream_specifier);
    }

    flag.to_string()
}

fn apply_safe_additional_args(
    args: &mut Vec<String>,
    additional_args: &[TranscodeAdditionalArg],
    stream_specifier: Option<&str>,
) -> Result<(), String> {
    const BLOCKED_FLAGS: &[&str] = &[
        "-i",
        "-map",
        "-progress",
        "-f",
        "-y",
        "-n",
        "-filter_complex",
        "-filter_script",
        "-vf",
        "-af",
    ];

    for additional_arg in additional_args {
        if !additional_arg.enabled {
            continue;
        }

        let flag = additional_arg.flag.trim();
        if !flag.starts_with('-') {
            return Err(format!("Invalid additional argument flag: {}", flag));
        }
        if BLOCKED_FLAGS.contains(&flag) {
            return Err(format!("Additional argument is not allowed here: {}", flag));
        }

        args.push(qualify_stream_option(flag, stream_specifier));
        if let Some(value) = additional_arg.value.as_deref() {
            if !value.trim().is_empty() {
                args.push(value.trim().to_string());
            }
        }
    }

    Ok(())
}

fn cpu_used_preset_max(encoder_id: &str) -> Option<u8> {
    match encoder_id {
        "libaom-av1" | "libvpx-vp9" => Some(8),
        "libvpx" => Some(16),
        _ => None,
    }
}

fn validate_cpu_used_preset(encoder_id: &str, preset: &str, max_value: u8) -> Result<(), String> {
    let error_message = || {
        format!(
            "{} preset must be an integer from 0 to {}",
            encoder_id, max_value
        )
    };
    let parsed = preset.parse::<u8>().map_err(|_| error_message())?;

    if parsed > max_value {
        return Err(error_message());
    }

    Ok(())
}

fn apply_video_preset_arg(
    args: &mut Vec<String>,
    encoder_id: &str,
    preset: &str,
) -> Result<(), String> {
    if let Some(max_value) = cpu_used_preset_max(encoder_id) {
        validate_cpu_used_preset(encoder_id, preset, max_value)?;
        args.push("-cpu-used".to_string());
        args.push(preset.to_string());
        return Ok(());
    }

    args.push("-preset".to_string());
    args.push(preset.to_string());
    Ok(())
}

fn build_transcode_args(
    request: &TranscodeRequest,
    streams: &[Value],
    duration_us: Option<u64>,
) -> Result<Vec<String>, String> {
    let video_streams = extract_streams_by_type(streams, "video");
    let audio_streams = extract_streams_by_type(streams, "audio");
    let subtitle_streams = extract_streams_by_type(streams, "subtitle");

    let mut args = vec![
        "-hide_banner".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        request.input_path.clone(),
    ];

    let mut mapped_any_stream = false;
    let mut output_metadata = Vec::<OutputStreamMetadata>::new();

    if !video_streams.is_empty() && request.video.mode != "disable" {
        args.push("-map".to_string());
        args.push("0:v:0".to_string());
        output_metadata.push(output_stream_metadata_from_request(
            output_metadata.len(),
            &video_streams[0].probe_stream,
            &request.metadata,
        ));
        mapped_any_stream = true;
    }

    let mut mapped_audio_streams = Vec::new();
    if !audio_streams.is_empty() {
        for audio_stream in &audio_streams {
            let resolved_settings = resolve_audio_settings_for_stream(request, audio_stream);
            if resolved_settings.mode == "disable" {
                continue;
            }

            args.push("-map".to_string());
            args.push(format!("0:a:{}", audio_stream.relative_index));
            output_metadata.push(output_stream_metadata_from_request(
                output_metadata.len(),
                &audio_stream.probe_stream,
                &request.metadata,
            ));
            mapped_any_stream = true;
            mapped_audio_streams.push((
                mapped_audio_streams.len(),
                audio_stream.clone(),
                resolved_settings,
            ));
        }
    }

    let mut mapped_subtitle_output_indices = Vec::new();
    if !subtitle_streams.is_empty() && request.subtitles.mode != "disable" {
        for subtitle_stream in &subtitle_streams {
            args.push("-map".to_string());
            args.push(format!("0:s:{}", subtitle_stream.relative_index));
            output_metadata.push(output_stream_metadata_from_request(
                output_metadata.len(),
                &subtitle_stream.probe_stream,
                &request.metadata,
            ));
            mapped_subtitle_output_indices.push(subtitle_stream.codec_name.clone());
            mapped_any_stream = true;
        }
    }

    if !mapped_any_stream {
        return Err("No streams selected for output".to_string());
    }

    if !video_streams.is_empty() {
        match request.video.mode.as_str() {
            "copy" => {
                if let Some(unsupported_codec) = video_streams
                    .first()
                    .map(|stream| stream.codec_name.as_str())
                    .filter(|codec| !can_copy_video_codec(&request.container_id, codec))
                {
                    return Err(format!(
                        "Container {} cannot copy video codec {}. Choose video transcoding or a compatible container.",
                        request.container_id.to_uppercase(),
                        unsupported_codec
                    ));
                }

                args.push("-c:v".to_string());
                args.push("copy".to_string());
            }
            "transcode" => {
                let Some(encoder_id) = request.video.encoder_id.as_deref() else {
                    return Err(
                        "A video encoder is required when video transcoding is enabled".to_string(),
                    );
                };

                args.push("-c:v".to_string());
                args.push(encoder_id.to_string());

                if let Some(profile) = request.video.profile.as_deref() {
                    if !profile.trim().is_empty() {
                        args.push("-profile:v".to_string());
                        args.push(profile.trim().to_string());
                    }
                }

                if let Some(level) = request.video.level.as_deref() {
                    if !level.trim().is_empty() {
                        args.push("-level:v".to_string());
                        args.push(level.trim().to_string());
                    }
                }

                if let Some(pixel_format) = request.video.pixel_format.as_deref() {
                    if !pixel_format.trim().is_empty() {
                        args.push("-pix_fmt".to_string());
                        args.push(pixel_format.trim().to_string());
                    }
                }

                match request.video.quality_mode.as_deref().unwrap_or("crf") {
                    "crf" => {
                        if let Some(crf) = request.video.crf {
                            args.push("-crf".to_string());
                            args.push(crf.to_string());
                        }
                    }
                    "qp" => {
                        if let Some(qp) = request.video.qp {
                            args.push("-qp".to_string());
                            args.push(qp.to_string());
                        }
                    }
                    "bitrate" => {
                        if let Some(bitrate_kbps) = request.video.bitrate_kbps {
                            args.push("-b:v".to_string());
                            args.push(format!("{}k", bitrate_kbps));
                        }
                    }
                    _ => {}
                }

                if let Some(preset) = request.video.preset.as_deref() {
                    if !preset.trim().is_empty() {
                        apply_video_preset_arg(&mut args, encoder_id, preset.trim())?;
                    }
                }

                if matches!(request.container_id.as_str(), "mp4" | "mov")
                    && encoder_id.starts_with("hevc")
                {
                    args.push("-tag:v".to_string());
                    args.push("hvc1".to_string());
                }

                if request.container_id == "mp4" {
                    args.push("-movflags".to_string());
                    args.push("+faststart".to_string());
                }

                apply_safe_additional_args(&mut args, &request.video.additional_args, None)?;
            }
            "disable" => {}
            other => return Err(format!("Unsupported video mode: {}", other)),
        }
    }

    if !mapped_audio_streams.is_empty() {
        for (output_index, source_stream, resolved_settings) in &mapped_audio_streams {
            match resolved_settings.mode.as_str() {
                "copy" => {
                    if !can_copy_audio_codec(&request.container_id, &source_stream.codec_name) {
                        return Err(format!(
                            "Container {} cannot copy audio codec {}. Choose audio transcoding or a compatible container.",
                            request.container_id.to_uppercase(),
                            source_stream.codec_name
                        ));
                    }

                    args.push(format!("-c:a:{}", output_index));
                    args.push("copy".to_string());
                }
                "transcode" => {
                    let Some(encoder_id) = resolved_settings.encoder_id.as_deref() else {
                        return Err(
                            "An audio encoder is required when audio transcoding is enabled"
                                .to_string(),
                        );
                    };

                    args.push(format!("-c:a:{}", output_index));
                    args.push(encoder_id.to_string());

                    if should_force_libopus_mapping_family_255(
                        resolved_settings,
                        source_stream,
                        &resolved_settings.additional_args,
                    ) {
                        args.push(format!("-mapping_family:a:{}", output_index));
                        args.push("255".to_string());
                    }

                    if let Some(bitrate_kbps) = resolved_settings.bitrate_kbps {
                        args.push(format!("-b:a:{}", output_index));
                        args.push(format!("{}k", bitrate_kbps));
                    }

                    if let Some(channels) =
                        resolved_settings.channels.filter(|channels| *channels > 0)
                    {
                        args.push(format!("-ac:a:{}", output_index));
                        args.push(channels.to_string());
                    }

                    if let Some(sample_rate) = resolved_settings
                        .sample_rate
                        .filter(|sample_rate| *sample_rate > 0)
                    {
                        args.push(format!("-ar:a:{}", output_index));
                        args.push(sample_rate.to_string());
                    }

                    apply_safe_additional_args(
                        &mut args,
                        &resolved_settings.additional_args,
                        Some(&format!("a:{}", output_index)),
                    )?;
                }
                "disable" => {}
                other => return Err(format!("Unsupported audio mode: {}", other)),
            }
        }
    }

    if !mapped_subtitle_output_indices.is_empty() {
        match request.subtitles.mode.as_str() {
            "copy" => {
                if let Some(unsupported_codec) = mapped_subtitle_output_indices
                    .iter()
                    .find(|codec| !can_copy_subtitle_codec(&request.container_id, codec))
                {
                    return Err(format!(
                        "Container {} cannot copy subtitle codec {}. Choose subtitle conversion or disable subtitles for this output format.",
                        request.container_id.to_uppercase(),
                        unsupported_codec
                    ));
                }

                for output_index in 0..mapped_subtitle_output_indices.len() {
                    args.push(format!("-c:s:{}", output_index));
                    args.push("copy".to_string());
                }
            }
            "convert_text" => {
                let Some(encoder_id) = request.subtitles.encoder_id.as_deref() else {
                    return Err(
                        "A subtitle encoder is required when subtitle conversion is enabled"
                            .to_string(),
                    );
                };

                for (output_index, codec_name) in mapped_subtitle_output_indices.iter().enumerate()
                {
                    if !is_text_subtitle_codec(codec_name)
                        && !can_copy_subtitle_codec(&request.container_id, codec_name)
                    {
                        return Err(format!(
                            "Container {} cannot keep subtitle codec {} while converting text subtitles. Disable subtitles or choose a compatible container.",
                            request.container_id.to_uppercase(),
                            codec_name
                        ));
                    }

                    args.push(format!("-c:s:{}", output_index));
                    if is_text_subtitle_codec(codec_name) {
                        args.push(encoder_id.to_string());
                    } else {
                        args.push("copy".to_string());
                    }
                }

                apply_safe_additional_args(&mut args, &request.subtitles.additional_args, None)?;
            }
            "disable" => {}
            other => return Err(format!("Unsupported subtitle mode: {}", other)),
        }
    }

    apply_metadata_args(
        &mut args,
        &request.container_id,
        Some(&request.metadata),
        &output_metadata,
    );

    if let Some(duration_us) = duration_us {
        if duration_us > 0 {
            let duration_seconds = duration_us as f64 / 1_000_000.0;
            args.push("-metadata".to_string());
            args.push(format!(
                "mediaflow.duration_seconds={:.3}",
                duration_seconds
            ));
        }
    }

    args.push("-progress".to_string());
    args.push("pipe:1".to_string());
    args.push(request.output_path.clone());

    Ok(args)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn transcode_media_with_bins(
    ffmpeg_path: &str,
    ffprobe_path: &str,
    request: &TranscodeRequest,
) -> Result<String, String> {
    validate_media_path(&request.input_path)?;
    validate_output_path(&request.output_path)?;
    validate_output_path_matches_container(request)?;

    let probe_json = probe_file_with_ffprobe(ffprobe_path, &request.input_path).await?;
    let probe_value: Value = serde_json::from_str(&probe_json)
        .map_err(|error| format!("Invalid probe JSON: {}", error))?;
    let streams = probe_value
        .get("streams")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let duration_us = parse_duration_us_from_probe_json(&probe_json)
        .ok()
        .flatten();

    let args = build_transcode_args(request, &streams, duration_us)?;

    let mut child = tokio_command(ffmpeg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to execute ffmpeg: {}", error))?;

    let (activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();
    if let Some(stdout) = child.stdout.take() {
        let activity_tx_for_progress = activity_tx.clone();
        tokio::spawn(async move {
            let mut tracker = FfmpegProgressTracker::new(duration_us);
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if tracker
                    .handle_line(&line)
                    .is_some_and(|update| update.advanced)
                {
                    let _ = activity_tx_for_progress.send(());
                }
            }
        });
    }
    drop(activity_tx);

    let output = wait_with_output_progress_watchdog(
        child,
        "Transcode",
        activity_rx,
        LONG_FFMPEG_PROGRESS_TIMEOUT,
    )
    .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Transcode failed: {}", stderr.trim()));
    }

    if !Path::new(&request.output_path).exists() {
        return Err("Transcode failed: output file not created".to_string());
    }

    Ok(request.output_path.clone())
}

#[tauri::command]
pub(crate) async fn transcode_media(
    app: tauri::AppHandle,
    request: TranscodeRequest,
) -> Result<String, String> {
    validate_media_path(&request.input_path)?;
    validate_output_path(&request.output_path)?;
    validate_output_path_matches_container(&request)?;

    let _sleep_guard = SleepInhibitGuard::try_acquire("Media transcoding").ok();
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let ffprobe_path = resolve_ffprobe_path(&app)?;

    let probe_json = probe_file_with_ffprobe(&ffprobe_path, &request.input_path).await?;
    let probe_value: Value = serde_json::from_str(&probe_json)
        .map_err(|error| format!("Invalid probe JSON: {}", error))?;
    let streams = probe_value
        .get("streams")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let duration_us = parse_duration_us_from_probe_json(&probe_json)
        .ok()
        .flatten();
    let total_frames = (request.video.mode != "disable")
        .then(|| resolve_primary_video_total_frames(&streams, duration_us))
        .flatten();
    let args = build_transcode_args(&request, &streams, duration_us)?;

    let mut child = tokio_command(&ffmpeg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start ffmpeg: {}", error))?;

    emit_transcode_progress(
        &app,
        &request.input_path,
        &request.output_path,
        0,
        None,
        None,
        total_frames,
        None,
    );

    if let Some(pid) = child.id() {
        if let Ok(mut guard) = super::state::TRANSCODE_PROCESS_IDS.lock() {
            guard.insert(request.input_path.clone(), pid);
        }
    }

    if let Ok(mut guard) = super::state::TRANSCODE_OUTPUT_PATHS.lock() {
        guard.insert(request.input_path.clone(), request.output_path.clone());
    }

    let (activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();

    if let Some(stdout) = child.stdout.take() {
        let app_for_progress = app.clone();
        let input_path_for_progress = request.input_path.clone();
        let output_path_for_progress = request.output_path.clone();
        let activity_tx_for_progress = activity_tx.clone();

        tokio::spawn(async move {
            let mut tracker = FfmpegProgressTracker::with_total_frames(duration_us, total_frames);
            let mut last_progress = 0;
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(update) = tracker.handle_line(&line) {
                    if update.advanced {
                        let _ = activity_tx_for_progress.send(());
                    }

                    if let Some(progress) = update.progress {
                        last_progress = progress;
                    }

                    emit_transcode_progress(
                        &app_for_progress,
                        &input_path_for_progress,
                        &output_path_for_progress,
                        last_progress,
                        update.speed_bytes_per_sec,
                        update.current_frame,
                        update.total_frames,
                        update.frames_per_second,
                    );
                }
            }
        });
    }

    drop(activity_tx);

    let input_path_for_cleanup = request.input_path.clone();
    let output_path_for_cleanup = request.output_path.clone();
    let output = wait_with_output_progress_watchdog(
        child,
        "Transcode",
        activity_rx,
        LONG_FFMPEG_PROGRESS_TIMEOUT,
    )
    .await
    .map_err(|error| {
        if let Ok(mut guard) = super::state::TRANSCODE_PROCESS_IDS.lock() {
            guard.remove(&input_path_for_cleanup);
        }
        if let Ok(mut guard) = super::state::TRANSCODE_OUTPUT_PATHS.lock() {
            guard.remove(&input_path_for_cleanup);
        }
        let _ = std::fs::remove_file(&output_path_for_cleanup);
        error
    })?;

    if let Ok(mut guard) = super::state::TRANSCODE_PROCESS_IDS.lock() {
        guard.remove(&request.input_path);
    }
    if let Ok(mut guard) = super::state::TRANSCODE_OUTPUT_PATHS.lock() {
        guard.remove(&request.input_path);
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = std::fs::remove_file(&request.output_path);
        return Err(format!("Transcode failed: {}", stderr.trim()));
    }

    if !Path::new(&request.output_path).exists() {
        return Err("Transcode failed: output file not created".to_string());
    }

    emit_transcode_progress(
        &app,
        &request.input_path,
        &request.output_path,
        100,
        None,
        total_frames,
        total_frames,
        None,
    );

    Ok(request.output_path)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::{Value, json};

    use crate::test_support::audio::{
        ProbedAudioStream, generate_silence_wav, probe_audio_encoder_runtime_info,
        probe_primary_audio_stream,
    };
    use crate::test_support::ffmpeg::{ffmpeg_path, ffprobe_path};
    use crate::test_support::paths::new_temp_dir;
    use crate::test_support::video::{
        MediaStreamCounts, ProbedVideoStream, generate_test_pattern_av_mp4,
        generate_test_pattern_video, probe_media_stream_counts, probe_primary_video_stream,
    };
    use crate::tools::ffprobe::probe::probe_file_with_ffprobe;
    use crate::tools::transcode::capabilities::{
        TranscodeAudioEncoderCapability, TranscodeCapabilities, TranscodeContainerCapability,
        TranscodeVideoEncoderCapability, get_transcode_capabilities_with_ffmpeg_path,
    };

    use crate::tools::media_metadata::{
        MediaMetadataRequest, TrackMetadataEdit, metadata_schema_for_container,
    };

    use super::{
        TranscodeAdditionalArg, TranscodeAudioSettings, TranscodeAudioTrackOverride,
        TranscodeRequest, TranscodeSubtitleSettings, TranscodeVideoSettings, build_transcode_args,
        cpu_used_preset_max, resolve_primary_video_total_frames, transcode_media_with_bins,
    };

    const AUDIO_LAYOUT_CASES: &[(&str, u64)] = &[
        ("mono", 1),
        ("stereo", 2),
        ("4.0", 4),
        ("5.1", 6),
        ("5.1(side)", 6),
        ("7.1", 8),
        ("7.1(wide-side)", 8),
    ];
    const VIDEO_TEST_WIDTH: u64 = 160;
    const VIDEO_TEST_HEIGHT: u64 = 90;

    fn build_request(output_path: &str) -> TranscodeRequest {
        TranscodeRequest {
            input_path: "/tmp/input.mp4".to_string(),
            output_path: output_path.to_string(),
            container_id: "mp4".to_string(),
            video: TranscodeVideoSettings {
                mode: "transcode".to_string(),
                encoder_id: Some("libx264".to_string()),
                profile: Some("high".to_string()),
                level: Some("4.1".to_string()),
                pixel_format: Some("yuv420p".to_string()),
                quality_mode: Some("crf".to_string()),
                crf: Some(20.0),
                qp: None,
                bitrate_kbps: None,
                preset: Some("medium".to_string()),
                additional_args: Vec::new(),
            },
            audio: TranscodeAudioSettings {
                mode: "transcode".to_string(),
                encoder_id: Some("aac".to_string()),
                bitrate_kbps: Some(160),
                channels: Some(2),
                sample_rate: Some(48000),
                additional_args: Vec::new(),
                track_overrides: Vec::new(),
            },
            subtitles: TranscodeSubtitleSettings {
                mode: "convert_text".to_string(),
                encoder_id: Some("mov_text".to_string()),
                additional_args: Vec::new(),
            },
            metadata: MediaMetadataRequest::default(),
        }
    }

    fn build_audio_only_request(
        input_path: &Path,
        output_path: &Path,
        container_id: &str,
        encoder: &TranscodeAudioEncoderCapability,
    ) -> TranscodeRequest {
        let mut request = build_request(output_path.to_string_lossy().as_ref());
        request.input_path = input_path.to_string_lossy().to_string();
        request.output_path = output_path.to_string_lossy().to_string();
        request.container_id = container_id.to_string();

        request.video.mode = "disable".to_string();
        request.video.encoder_id = None;
        request.video.profile = None;
        request.video.level = None;
        request.video.pixel_format = None;
        request.video.quality_mode = None;
        request.video.crf = None;
        request.video.qp = None;
        request.video.bitrate_kbps = None;
        request.video.preset = None;
        request.video.additional_args = Vec::new();

        apply_audio_transcode_settings(&mut request, encoder);

        request.subtitles.mode = "disable".to_string();
        request.subtitles.encoder_id = None;
        request.subtitles.additional_args = Vec::new();

        request
    }

    fn build_video_only_request(
        input_path: &Path,
        output_path: &Path,
        container_id: &str,
        encoder: &TranscodeVideoEncoderCapability,
        scenario: &VideoRuntimeScenario,
    ) -> TranscodeRequest {
        let mut request = build_request(output_path.to_string_lossy().as_ref());
        request.input_path = input_path.to_string_lossy().to_string();
        request.output_path = output_path.to_string_lossy().to_string();
        request.container_id = container_id.to_string();

        apply_video_transcode_settings(&mut request, encoder, scenario);

        request.audio.mode = "disable".to_string();
        request.audio.encoder_id = None;
        request.audio.bitrate_kbps = None;
        request.audio.channels = None;
        request.audio.sample_rate = None;
        request.audio.additional_args = Vec::new();
        request.audio.track_overrides = Vec::new();

        request.subtitles.mode = "disable".to_string();
        request.subtitles.encoder_id = None;
        request.subtitles.additional_args = Vec::new();

        request
    }

    fn build_av_request(
        input_path: &Path,
        output_path: &Path,
        container_id: &str,
    ) -> TranscodeRequest {
        let mut request = build_request(output_path.to_string_lossy().as_ref());
        request.input_path = input_path.to_string_lossy().to_string();
        request.output_path = output_path.to_string_lossy().to_string();
        request.container_id = container_id.to_string();
        request.subtitles.mode = "disable".to_string();
        request.subtitles.encoder_id = None;
        request.subtitles.additional_args = Vec::new();
        request
    }

    fn apply_video_transcode_settings(
        request: &mut TranscodeRequest,
        encoder: &TranscodeVideoEncoderCapability,
        scenario: &VideoRuntimeScenario,
    ) {
        request.video.mode = "transcode".to_string();
        request.video.encoder_id = Some(encoder.id.clone());
        request.video.profile = scenario.profile.clone();
        request.video.level = scenario.level.clone();
        request.video.pixel_format = scenario
            .pixel_format
            .clone()
            .or_else(|| preferred_video_pixel_format(encoder));
        request.video.quality_mode = scenario.quality_mode.map(|value| value.to_string());
        request.video.crf = scenario.crf;
        request.video.qp = scenario.qp;
        request.video.bitrate_kbps = scenario.bitrate_kbps;
        request.video.preset = scenario.preset.as_ref().map(|value| value.to_string());
        request.video.additional_args = scenario.additional_args.clone();
    }

    fn apply_audio_transcode_settings(
        request: &mut TranscodeRequest,
        encoder: &TranscodeAudioEncoderCapability,
    ) {
        request.audio.mode = "transcode".to_string();
        request.audio.encoder_id = Some(encoder.id.clone());
        request.audio.bitrate_kbps = audio_bitrate_for_encoder(&encoder.id);
        request.audio.channels = None;
        request.audio.sample_rate = None;
        request.audio.additional_args = Vec::new();
        request.audio.track_overrides = Vec::new();
    }

    fn audio_bitrate_for_encoder(encoder_id: &str) -> Option<u32> {
        match encoder_id {
            "flac" | "pcm_s16le" => None,
            "libmp3lame" => Some(192),
            _ => Some(160),
        }
    }

    fn pick_audio_test_container_id(
        capabilities: &TranscodeCapabilities,
        encoder_id: &str,
    ) -> Option<String> {
        let preferred_container_id = match encoder_id {
            "aac" | "aac_at" => Some("aac"),
            "libopus" => Some("opus"),
            "libvorbis" => Some("ogg"),
            "libmp3lame" => Some("mp3"),
            "flac" => Some("flac"),
            "pcm_s16le" => Some("wav"),
            _ => None,
        };

        if let Some(container_id) = preferred_container_id.filter(|container_id| {
            capabilities.containers.iter().any(|container| {
                container.kind == "audio"
                    && container.id == *container_id
                    && container
                        .supported_audio_encoder_ids
                        .iter()
                        .any(|supported_id| supported_id == encoder_id)
            })
        }) {
            return Some(container_id.to_string());
        }

        capabilities
            .containers
            .iter()
            .find(|container| {
                container.kind == "audio"
                    && container
                        .supported_audio_encoder_ids
                        .iter()
                        .any(|supported_id| supported_id == encoder_id)
            })
            .map(|container| container.id.clone())
    }

    fn pick_video_test_container_id(
        capabilities: &TranscodeCapabilities,
        encoder_id: &str,
    ) -> Option<String> {
        let preferred_container_id = match encoder_id {
            "libx264" | "h264_videotoolbox" => Some("mp4"),
            "libx265" | "hevc_videotoolbox" => Some("mp4"),
            "libsvtav1" | "libaom-av1" | "libvpx" | "libvpx-vp9" => Some("webm"),
            "prores_ks" | "prores_videotoolbox" => Some("mov"),
            _ => None,
        };

        if let Some(container_id) = preferred_container_id.filter(|container_id| {
            capabilities.containers.iter().any(|container| {
                container.kind == "video"
                    && container.id == *container_id
                    && container
                        .supported_video_encoder_ids
                        .iter()
                        .any(|supported_id| supported_id == encoder_id)
            })
        }) {
            return Some(container_id.to_string());
        }

        capabilities
            .containers
            .iter()
            .find(|container| {
                container.kind == "video"
                    && container
                        .supported_video_encoder_ids
                        .iter()
                        .any(|supported_id| supported_id == encoder_id)
            })
            .map(|container| container.id.clone())
    }

    fn sanitize_case_id(value: &str) -> String {
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

    fn expected_output_channels(encoder_id: &str, input_channels: u64) -> u64 {
        if encoder_id == "libmp3lame" && input_channels > 2 {
            2
        } else {
            input_channels
        }
    }

    fn expected_audio_codec_name(encoder_id: &str) -> &'static str {
        match encoder_id {
            "aac" | "aac_at" => "aac",
            "libopus" => "opus",
            "libvorbis" => "vorbis",
            "libmp3lame" => "mp3",
            "flac" => "flac",
            "pcm_s16le" => "pcm_s16le",
            _ => "",
        }
    }

    fn validate_transcoded_audio_stream(
        encoder_id: &str,
        input_channels: u64,
        probed_stream: &ProbedAudioStream,
    ) -> Option<String> {
        let expected_codec_name = expected_audio_codec_name(encoder_id);
        if !expected_codec_name.is_empty() && probed_stream.codec_name != expected_codec_name {
            return Some(format!(
                "expected codec {}, got {}",
                expected_codec_name, probed_stream.codec_name
            ));
        }

        let expected_channels = expected_output_channels(encoder_id, input_channels);
        if probed_stream.channels != expected_channels {
            return Some(format!(
                "expected {} channels, got {}",
                expected_channels, probed_stream.channels
            ));
        }

        None
    }

    fn pick_audio_override_sample_rate(
        encoder_id: &str,
        supported_sample_rates: &[u32],
    ) -> Option<u32> {
        let preferred = if encoder_id == "libopus" {
            &[24_000, 16_000, 12_000, 8_000][..]
        } else {
            &[44_100, 32_000, 24_000, 22_050, 16_000][..]
        };

        preferred.iter().copied().find(|rate| {
            *rate != 48_000
                && (supported_sample_rates.is_empty() || supported_sample_rates.contains(rate))
        })
    }

    fn expected_output_sample_rate(encoder_id: &str, requested_sample_rate: u32) -> u32 {
        if encoder_id == "libopus" {
            48_000
        } else {
            requested_sample_rate
        }
    }

    fn pick_preferred_audio_encoders<'a>(
        capabilities: &'a TranscodeCapabilities,
    ) -> Vec<&'a TranscodeAudioEncoderCapability> {
        let preferred_ids = [
            "aac",
            "aac_at",
            "libopus",
            "libvorbis",
            "flac",
            "pcm_s16le",
            "libmp3lame",
        ];

        preferred_ids
            .iter()
            .filter_map(|encoder_id| {
                capabilities
                    .audio_encoders
                    .iter()
                    .find(|encoder| encoder.id == *encoder_id)
            })
            .collect()
    }

    async fn collect_probe_streams(path: &Path) -> Result<Vec<Value>, String> {
        let probe_json =
            probe_file_with_ffprobe(ffprobe_path(), path.to_string_lossy().as_ref()).await?;
        let probe_value: Value = serde_json::from_str(&probe_json)
            .map_err(|error| format!("Invalid probe JSON: {}", error))?;

        Ok(probe_value
            .get("streams")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default())
    }

    fn args_contain_pair(args: &[String], flag: &str, value: &str) -> bool {
        args.windows(2)
            .any(|window| window[0] == flag && window[1] == value)
    }

    fn expect_arg_pair(args: &[String], flag: &str, value: &str) -> Option<String> {
        if args_contain_pair(args, flag, value) {
            None
        } else {
            Some(format!(
                "expected ffmpeg args to contain `{}` `{}`",
                flag, value
            ))
        }
    }

    fn expect_flag(args: &[String], flag: &str) -> Option<String> {
        if args.iter().any(|arg| arg == flag) {
            None
        } else {
            Some(format!("expected ffmpeg args to contain `{}`", flag))
        }
    }

    fn collect_audio_request_arg_failures(
        args: &[String],
        request: &TranscodeRequest,
    ) -> Vec<String> {
        let mut failures = Vec::new();

        if let Some(bitrate_kbps) = request.audio.bitrate_kbps {
            if let Some(error) = expect_arg_pair(args, "-b:a:0", &format!("{}k", bitrate_kbps)) {
                failures.push(error);
            }
        }

        if let Some(channels) = request.audio.channels.filter(|channels| *channels > 0) {
            if let Some(error) = expect_arg_pair(args, "-ac:a:0", &channels.to_string()) {
                failures.push(error);
            }
        }

        if let Some(sample_rate) = request
            .audio
            .sample_rate
            .filter(|sample_rate| *sample_rate > 0)
        {
            if let Some(error) = expect_arg_pair(args, "-ar:a:0", &sample_rate.to_string()) {
                failures.push(error);
            }
        }

        failures
    }

    fn collect_video_request_arg_failures(
        args: &[String],
        request: &TranscodeRequest,
        encoder: &TranscodeVideoEncoderCapability,
    ) -> Vec<String> {
        let mut failures = Vec::new();

        if let Some(profile) = request
            .video
            .profile
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            if let Some(error) = expect_arg_pair(args, "-profile:v", profile.trim()) {
                failures.push(error);
            }
        }

        if let Some(level) = request
            .video
            .level
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            if let Some(error) = expect_arg_pair(args, "-level:v", level.trim()) {
                failures.push(error);
            }
        }

        if let Some(pixel_format) = request
            .video
            .pixel_format
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            if let Some(error) = expect_arg_pair(args, "-pix_fmt", pixel_format.trim()) {
                failures.push(error);
            }
        }

        match request.video.quality_mode.as_deref() {
            Some("crf") => {
                if let Some(crf) = request.video.crf {
                    if let Some(error) = expect_arg_pair(args, "-crf", &crf.to_string()) {
                        failures.push(error);
                    }
                }
            }
            Some("qp") => {
                if let Some(qp) = request.video.qp {
                    if let Some(error) = expect_arg_pair(args, "-qp", &qp.to_string()) {
                        failures.push(error);
                    }
                }
            }
            Some("bitrate") => {
                if let Some(bitrate_kbps) = request.video.bitrate_kbps {
                    if let Some(error) =
                        expect_arg_pair(args, "-b:v", &format!("{}k", bitrate_kbps))
                    {
                        failures.push(error);
                    }
                }
            }
            _ => {}
        }

        if let Some(preset) = request
            .video
            .preset
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            let preset_flag = if cpu_used_preset_max(&encoder.id).is_some() {
                "-cpu-used"
            } else {
                "-preset"
            };
            if let Some(error) = expect_arg_pair(args, preset_flag, preset.trim()) {
                failures.push(error);
            }
        }

        for additional_arg in request
            .video
            .additional_args
            .iter()
            .filter(|arg| arg.enabled)
        {
            match additional_arg.value.as_deref() {
                Some(value) => {
                    if let Some(error) = expect_arg_pair(args, &additional_arg.flag, value) {
                        failures.push(error);
                    }
                }
                None => {
                    if let Some(error) = expect_flag(args, &additional_arg.flag) {
                        failures.push(error);
                    }
                }
            }
        }

        if matches!(request.container_id.as_str(), "mp4" | "mov") && encoder.id.starts_with("hevc")
        {
            if let Some(error) = expect_arg_pair(args, "-tag:v", "hvc1") {
                failures.push(error);
            }
        }

        if request.container_id == "mp4" {
            if let Some(error) = expect_arg_pair(args, "-movflags", "+faststart") {
                failures.push(error);
            }
        }

        failures
    }

    fn normalize_comparable_value(value: &str) -> String {
        value
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .map(|character| character.to_ascii_lowercase())
            .collect()
    }

    #[derive(Debug, Clone)]
    struct VideoRuntimeScenario {
        name: &'static str,
        quality_mode: Option<&'static str>,
        crf: Option<f64>,
        qp: Option<i32>,
        bitrate_kbps: Option<u32>,
        preset: Option<&'static str>,
        profile: Option<String>,
        level: Option<String>,
        pixel_format: Option<String>,
        additional_args: Vec<TranscodeAdditionalArg>,
    }

    fn preferred_video_pixel_format(encoder: &TranscodeVideoEncoderCapability) -> Option<String> {
        encoder
            .supported_pixel_formats
            .iter()
            .find(|pixel_format| {
                matches!(
                    pixel_format.as_str(),
                    "yuv420p" | "nv12" | "yuv420p10le" | "p010le"
                )
            })
            .cloned()
            .or_else(|| encoder.supported_pixel_formats.first().cloned())
    }

    fn preferred_video_preset(encoder_id: &str) -> Option<&'static str> {
        match encoder_id {
            "libx264" | "libx265" => Some("fast"),
            "libsvtav1" => Some("10"),
            "libaom-av1" => Some("8"),
            _ => None,
        }
    }

    fn preferred_video_crf(codec: &str) -> f64 {
        match codec {
            "av1" => 35.0,
            "hevc" => 30.0,
            "vp9" => 32.0,
            _ => 28.0,
        }
    }

    fn preferred_video_qp(codec: &str) -> i32 {
        match codec {
            "av1" => 36,
            "hevc" => 30,
            "vp9" => 32,
            _ => 28,
        }
    }

    fn preferred_video_bitrate_kbps(codec: &str) -> u32 {
        match codec {
            "prores" => 1500,
            "av1" => 500,
            "vp9" => 500,
            _ => 700,
        }
    }

    fn build_primary_video_scenario(
        encoder: &TranscodeVideoEncoderCapability,
    ) -> VideoRuntimeScenario {
        let quality_mode = if encoder.supports_crf {
            Some("crf")
        } else if encoder.supports_qp {
            Some("qp")
        } else if encoder.supports_bitrate {
            Some("bitrate")
        } else {
            None
        };

        VideoRuntimeScenario {
            name: "primary",
            quality_mode,
            crf: quality_mode
                .filter(|mode| *mode == "crf")
                .map(|_| preferred_video_crf(&encoder.codec)),
            qp: quality_mode
                .filter(|mode| *mode == "qp")
                .map(|_| preferred_video_qp(&encoder.codec)),
            bitrate_kbps: quality_mode
                .filter(|mode| *mode == "bitrate")
                .map(|_| preferred_video_bitrate_kbps(&encoder.codec)),
            preset: encoder
                .supports_preset
                .then(|| preferred_video_preset(&encoder.id))
                .flatten(),
            profile: None,
            level: None,
            pixel_format: None,
            additional_args: Vec::new(),
        }
    }

    fn build_secondary_video_scenario(
        encoder: &TranscodeVideoEncoderCapability,
    ) -> Option<VideoRuntimeScenario> {
        if encoder.id == "libaom-av1" {
            return None;
        }

        if encoder.supports_bitrate {
            return Some(VideoRuntimeScenario {
                name: "bitrate_gop",
                quality_mode: Some("bitrate"),
                crf: None,
                qp: None,
                bitrate_kbps: Some(preferred_video_bitrate_kbps(&encoder.codec)),
                preset: encoder
                    .supports_preset
                    .then(|| preferred_video_preset(&encoder.id))
                    .flatten(),
                profile: None,
                level: None,
                pixel_format: None,
                additional_args: vec![TranscodeAdditionalArg {
                    _id: Some("gop".to_string()),
                    flag: "-g".to_string(),
                    value: Some("12".to_string()),
                    enabled: true,
                }],
            });
        }

        if encoder.supports_qp && !encoder.supports_crf {
            return Some(VideoRuntimeScenario {
                name: "qp_gop",
                quality_mode: Some("qp"),
                crf: None,
                qp: Some(preferred_video_qp(&encoder.codec)),
                bitrate_kbps: None,
                preset: encoder
                    .supports_preset
                    .then(|| preferred_video_preset(&encoder.id))
                    .flatten(),
                profile: None,
                level: None,
                pixel_format: None,
                additional_args: vec![TranscodeAdditionalArg {
                    _id: Some("gop".to_string()),
                    flag: "-g".to_string(),
                    value: Some("12".to_string()),
                    enabled: true,
                }],
            });
        }

        None
    }

    fn build_representative_video_scenarios(
        encoder: &TranscodeVideoEncoderCapability,
    ) -> Vec<VideoRuntimeScenario> {
        let mut scenarios = vec![build_primary_video_scenario(encoder)];
        if let Some(secondary) = build_secondary_video_scenario(encoder) {
            scenarios.push(secondary);
        }
        scenarios
    }

    fn preferred_profile_value(encoder: &TranscodeVideoEncoderCapability) -> Option<String> {
        let preferred = match encoder.codec.as_str() {
            "h264" => &["high", "main", "baseline"][..],
            "hevc" => &["main", "main10"][..],
            "av1" => &["main"][..],
            "prores" => &["standard", "hq", "proxy"][..],
            _ => &[][..],
        };

        preferred
            .iter()
            .find_map(|candidate| {
                encoder
                    .supported_profiles
                    .iter()
                    .find(|value| value.eq_ignore_ascii_case(candidate))
                    .cloned()
            })
            .or_else(|| encoder.supported_profiles.first().cloned())
    }

    fn preferred_level_value(encoder: &TranscodeVideoEncoderCapability) -> Option<String> {
        let preferred = ["4.1", "4.0", "5.0", "3.1", "3.0"];

        preferred
            .iter()
            .find_map(|candidate| {
                encoder
                    .supported_levels
                    .iter()
                    .find(|value| value == candidate)
                    .cloned()
            })
            .or_else(|| encoder.supported_levels.first().cloned())
    }

    fn preferred_10bit_pixel_format(encoder: &TranscodeVideoEncoderCapability) -> Option<String> {
        ["yuv420p10le", "p010le", "x2rgb10le", "ayuv64le"]
            .iter()
            .find_map(|candidate| {
                encoder
                    .supported_pixel_formats
                    .iter()
                    .find(|value| value.as_str() == *candidate)
                    .cloned()
            })
    }

    fn build_advanced_video_capability_scenarios(
        encoder: &TranscodeVideoEncoderCapability,
    ) -> Vec<VideoRuntimeScenario> {
        let mut scenarios = Vec::new();

        if !encoder.is_hardware
            && (!encoder.supported_profiles.is_empty() || !encoder.supported_levels.is_empty())
        {
            let mut scenario = build_primary_video_scenario(encoder);
            scenario.name = "profile_level";
            scenario.profile = preferred_profile_value(encoder);
            scenario.level = preferred_level_value(encoder);
            if scenario.profile.is_some() || scenario.level.is_some() {
                scenarios.push(scenario);
            }
        }

        if !encoder.is_hardware {
            if let Some(pixel_format) = preferred_10bit_pixel_format(encoder) {
                let mut scenario = build_primary_video_scenario(encoder);
                scenario.name = "ten_bit";
                scenario.pixel_format = Some(pixel_format);
                scenario.profile = preferred_profile_value(encoder);
                scenarios.push(scenario);
            }
        }

        scenarios
    }

    fn expected_video_codec_name(encoder_id: &str) -> &'static str {
        match encoder_id {
            "libx264" | "h264_videotoolbox" => "h264",
            "libx265" | "hevc_videotoolbox" => "hevc",
            "libsvtav1" | "libaom-av1" => "av1",
            "libvpx-vp9" => "vp9",
            "prores_ks" | "prores_videotoolbox" => "prores",
            _ => "",
        }
    }

    fn validate_transcoded_video_stream(
        encoder_id: &str,
        probed_stream: &ProbedVideoStream,
    ) -> Option<String> {
        let expected_codec_name = expected_video_codec_name(encoder_id);
        if !expected_codec_name.is_empty() && probed_stream.codec_name != expected_codec_name {
            return Some(format!(
                "expected codec {}, got {}",
                expected_codec_name, probed_stream.codec_name
            ));
        }

        if probed_stream.width != VIDEO_TEST_WIDTH || probed_stream.height != VIDEO_TEST_HEIGHT {
            return Some(format!(
                "expected resolution {}x{}, got {}x{}",
                VIDEO_TEST_WIDTH, VIDEO_TEST_HEIGHT, probed_stream.width, probed_stream.height
            ));
        }

        None
    }

    fn validate_transcoded_video_output(
        encoder: &TranscodeVideoEncoderCapability,
        container_id: &str,
        scenario: &VideoRuntimeScenario,
        probed_stream: &ProbedVideoStream,
    ) -> Option<String> {
        if let Some(error) = validate_transcoded_video_stream(&encoder.id, probed_stream) {
            return Some(error);
        }

        if let Some(expected_profile) = scenario.profile.as_deref() {
            let Some(actual_profile) = probed_stream.profile.as_deref() else {
                return Some(format!(
                    "expected profile {}, but ffprobe did not report one",
                    expected_profile
                ));
            };

            if normalize_comparable_value(actual_profile)
                != normalize_comparable_value(expected_profile)
            {
                return Some(format!(
                    "expected profile {}, got {}",
                    expected_profile, actual_profile
                ));
            }
        }

        if let Some(expected_pixel_format) = scenario.pixel_format.as_deref() {
            if probed_stream.pixel_format.as_deref() != Some(expected_pixel_format) {
                return Some(format!(
                    "expected pixel format {}, got {:?}",
                    expected_pixel_format, probed_stream.pixel_format
                ));
            }
        }

        if matches!(container_id, "mp4" | "mov") && encoder.id.starts_with("hevc") {
            if probed_stream.codec_tag_string.as_deref() != Some("hvc1") {
                return Some(format!(
                    "expected codec tag hvc1, got {:?}",
                    probed_stream.codec_tag_string
                ));
            }
        }

        None
    }

    fn select_representative_video_encoders<'a>(
        capabilities: &'a TranscodeCapabilities,
    ) -> Vec<&'a TranscodeVideoEncoderCapability> {
        let preferred_ids = [
            "libx264",
            "h264_videotoolbox",
            "libx265",
            "hevc_videotoolbox",
            "libsvtav1",
            "libaom-av1",
            "libvpx",
            "libvpx-vp9",
            "prores_ks",
            "prores_videotoolbox",
        ];

        preferred_ids
            .iter()
            .filter_map(|encoder_id| {
                capabilities
                    .video_encoders
                    .iter()
                    .find(|encoder| encoder.id == *encoder_id)
            })
            .filter(|encoder| !should_skip_runtime_video_encoder(&encoder.id))
            .collect()
    }

    fn should_skip_runtime_video_encoder(encoder_id: &str) -> bool {
        should_skip_videotoolbox_encoder_in_ci(encoder_id, ci_env_enabled())
    }

    fn should_skip_videotoolbox_encoder_in_ci(encoder_id: &str, ci_enabled: bool) -> bool {
        ci_enabled && is_videotoolbox_encoder(encoder_id)
    }

    fn is_videotoolbox_encoder(encoder_id: &str) -> bool {
        matches!(
            encoder_id,
            "h264_videotoolbox" | "hevc_videotoolbox" | "prores_videotoolbox"
        )
    }

    fn ci_env_enabled() -> bool {
        std::env::var("CI").is_ok_and(|value| value.eq_ignore_ascii_case("true"))
    }

    fn select_runtime_video_encoder_for_container<'a>(
        capabilities: &'a TranscodeCapabilities,
        container: &TranscodeContainerCapability,
    ) -> Option<&'a TranscodeVideoEncoderCapability> {
        select_runtime_video_encoder_for_container_with_ci(
            capabilities,
            container,
            ci_env_enabled(),
        )
    }

    fn select_runtime_video_encoder_for_container_with_ci<'a>(
        capabilities: &'a TranscodeCapabilities,
        container: &TranscodeContainerCapability,
        ci_enabled: bool,
    ) -> Option<&'a TranscodeVideoEncoderCapability> {
        let is_supported = |encoder: &&TranscodeVideoEncoderCapability| {
            container
                .supported_video_encoder_ids
                .iter()
                .any(|supported_id| supported_id == &encoder.id)
        };

        capabilities
            .video_encoders
            .iter()
            .find(|encoder| {
                Some(&encoder.id) == container.default_video_encoder_id.as_ref()
                    && !should_skip_videotoolbox_encoder_in_ci(&encoder.id, ci_enabled)
            })
            .or_else(|| {
                capabilities.video_encoders.iter().find(|encoder| {
                    is_supported(encoder)
                        && !should_skip_videotoolbox_encoder_in_ci(&encoder.id, ci_enabled)
                })
            })
    }

    fn test_video_encoder(id: &str, is_hardware: bool) -> TranscodeVideoEncoderCapability {
        TranscodeVideoEncoderCapability {
            id: id.to_string(),
            codec: "h264".to_string(),
            label: id.to_string(),
            is_hardware,
            supported_pixel_formats: Vec::new(),
            supported_profiles: Vec::new(),
            supported_levels: Vec::new(),
            supported_bit_depths: Vec::new(),
            supports_preset: false,
            supports_crf: false,
            supports_qp: false,
            supports_bitrate: false,
            options: Vec::new(),
        }
    }

    fn test_video_container(
        default_video_encoder_id: Option<&str>,
        supported_video_encoder_ids: &[&str],
    ) -> TranscodeContainerCapability {
        TranscodeContainerCapability {
            id: "mkv".to_string(),
            label: "MKV".to_string(),
            extension: ".mkv".to_string(),
            kind: "video".to_string(),
            muxer_name: "matroska".to_string(),
            supported_video_encoder_ids: supported_video_encoder_ids
                .iter()
                .map(|id| id.to_string())
                .collect(),
            supported_audio_encoder_ids: Vec::new(),
            supported_subtitle_encoder_ids: Vec::new(),
            supported_subtitle_modes: Vec::new(),
            default_video_encoder_id: default_video_encoder_id.map(str::to_string),
            default_audio_encoder_id: None,
            default_subtitle_encoder_id: None,
            metadata_schema: metadata_schema_for_container("mkv"),
        }
    }

    #[test]
    fn resolve_primary_video_total_frames_reads_nb_frames() {
        let streams = vec![
            json!({
                "codec_type": "audio",
                "nb_frames": "500"
            }),
            json!({
                "codec_type": "video",
                "nb_frames": "1440"
            }),
        ];

        assert_eq!(
            resolve_primary_video_total_frames(&streams, None),
            Some(1440)
        );
    }

    #[test]
    fn resolve_primary_video_total_frames_estimates_from_average_frame_rate() {
        let streams = vec![json!({
            "codec_type": "video",
            "avg_frame_rate": "30000/1001"
        })];

        assert_eq!(
            resolve_primary_video_total_frames(&streams, Some(10_010_000)),
            Some(300),
        );
    }

    #[test]
    fn videotoolbox_skip_predicate_only_applies_in_ci() {
        assert!(should_skip_videotoolbox_encoder_in_ci(
            "h264_videotoolbox",
            true
        ));
        assert!(!should_skip_videotoolbox_encoder_in_ci(
            "h264_videotoolbox",
            false
        ));
        assert!(!should_skip_videotoolbox_encoder_in_ci("libx264", true));
    }

    #[test]
    fn runtime_video_encoder_selection_prefers_software_when_default_is_skipped() {
        let capabilities = TranscodeCapabilities {
            ffmpeg_version: "8.1".to_string(),
            hwaccels: Vec::new(),
            containers: Vec::new(),
            video_encoders: vec![
                test_video_encoder("hevc_videotoolbox", true),
                test_video_encoder("libx264", false),
            ],
            audio_encoders: Vec::new(),
            subtitle_encoders: Vec::new(),
            default_analysis_frame_count: 6,
        };
        let container =
            test_video_container(Some("hevc_videotoolbox"), &["hevc_videotoolbox", "libx264"]);

        assert!(should_skip_videotoolbox_encoder_in_ci(
            "hevc_videotoolbox",
            true
        ));
        let selected =
            select_runtime_video_encoder_for_container_with_ci(&capabilities, &container, true)
                .expect("software fallback should be selected");

        assert_eq!(selected.id, "libx264");
    }

    fn assert_media_counts(
        counts: &MediaStreamCounts,
        expected_video_streams: usize,
        expected_audio_streams: usize,
    ) -> Option<String> {
        if counts.video_streams != expected_video_streams
            || counts.audio_streams != expected_audio_streams
        {
            return Some(format!(
                "expected {} video and {} audio streams, got {} video and {} audio streams",
                expected_video_streams,
                expected_audio_streams,
                counts.video_streams,
                counts.audio_streams
            ));
        }

        None
    }

    fn should_skip_audio_matrix_case(
        encoder_id: &str,
        layout: &str,
        input_channels: u64,
    ) -> Option<&'static str> {
        if encoder_id == "libvorbis" && input_channels > 6 {
            return Some("libvorbis does not support more than 6 channels in this FFmpeg build");
        }

        if encoder_id == "aac_at" && layout == "7.1" {
            return Some(
                "AudioToolbox AAC exposes 7.1(wide) instead of standard 7.1 on this platform",
            );
        }

        None
    }

    #[test]
    fn build_transcode_args_includes_main_video_audio_and_safe_subtitle_handling() {
        let mut request = build_request("/tmp/output.mkv");
        request.container_id = "mkv".to_string();
        request.subtitles.encoder_id = Some("srt".to_string());
        let streams = vec![
            json!({ "codec_type": "video", "codec_name": "h264" }),
            json!({ "codec_type": "audio", "codec_name": "aac" }),
            json!({ "codec_type": "subtitle", "codec_name": "subrip" }),
            json!({ "codec_type": "subtitle", "codec_name": "hdmv_pgs_subtitle" }),
        ];

        let args =
            build_transcode_args(&request, &streams, Some(10_000_000)).expect("args should build");

        assert!(args.windows(2).any(|window| window == ["-c:v", "libx264"]));
        assert!(args.windows(2).any(|window| window == ["-c:a:0", "aac"]));
        assert!(args.windows(2).any(|window| window == ["-c:s:0", "srt"]));
        assert!(args.windows(2).any(|window| window == ["-c:s:1", "copy"]));
        assert!(
            args.windows(2)
                .any(|window| window == ["-progress", "pipe:1"])
        );
    }

    #[test]
    fn build_transcode_args_rejects_blocked_additional_args() {
        let mut request = build_request("/tmp/output.mp4");
        request.video.additional_args = vec![TranscodeAdditionalArg {
            _id: None,
            flag: "-map".to_string(),
            value: Some("0".to_string()),
            enabled: true,
        }];
        let streams = vec![json!({ "codec_type": "video", "codec_name": "h264" })];

        let error =
            build_transcode_args(&request, &streams, None).expect_err("blocked arg should fail");
        assert!(error.contains("not allowed"));
    }

    #[test]
    fn build_transcode_args_rejects_copying_subrip_subtitles_into_mp4() {
        let mut request = build_request("/tmp/output.mp4");
        request.subtitles.mode = "copy".to_string();
        request.subtitles.encoder_id = None;
        let streams = vec![
            json!({ "codec_type": "video", "codec_name": "h264" }),
            json!({ "codec_type": "subtitle", "codec_name": "subrip" }),
        ];

        let error = build_transcode_args(&request, &streams, None)
            .expect_err("subrip copy to mp4 should fail");
        assert!(error.contains("cannot copy subtitle codec"));
    }

    #[test]
    fn build_transcode_args_rejects_copying_h264_video_into_webm() {
        let mut request = build_request("/tmp/output.webm");
        request.container_id = "webm".to_string();
        request.video.mode = "copy".to_string();
        request.audio.mode = "disable".to_string();
        request.subtitles.mode = "disable".to_string();
        let streams = vec![json!({ "codec_type": "video", "codec_name": "h264" })];

        let error = build_transcode_args(&request, &streams, None)
            .expect_err("h264 copy to webm should fail");
        assert!(error.contains("cannot copy video codec"));
    }

    #[test]
    fn build_transcode_args_rejects_copying_aac_audio_into_webm() {
        let mut request = build_request("/tmp/output.webm");
        request.container_id = "webm".to_string();
        request.video.mode = "disable".to_string();
        request.audio.mode = "copy".to_string();
        request.subtitles.mode = "disable".to_string();
        let streams = vec![json!({ "codec_type": "audio", "codec_name": "aac" })];

        let error = build_transcode_args(&request, &streams, None)
            .expect_err("aac copy to webm should fail");
        assert!(error.contains("cannot copy audio codec"));
    }

    #[test]
    fn build_transcode_args_maps_libaom_preset_to_cpu_used() {
        let mut request = build_request("/tmp/output.mkv");
        request.container_id = "mkv".to_string();
        request.video.encoder_id = Some("libaom-av1".to_string());
        request.video.preset = Some("4".to_string());
        let streams = vec![json!({ "codec_type": "video", "codec_name": "h264" })];

        let args =
            build_transcode_args(&request, &streams, None).expect("libaom args should build");

        assert!(args.windows(2).any(|window| window == ["-cpu-used", "4"]));
        assert!(!args.iter().any(|arg| arg == "-preset"));
    }

    #[test]
    fn build_transcode_args_rejects_invalid_libaom_preset() {
        let mut request = build_request("/tmp/output.mkv");
        request.container_id = "mkv".to_string();
        request.video.encoder_id = Some("libaom-av1".to_string());
        request.video.preset = Some("9".to_string());
        let streams = vec![json!({ "codec_type": "video", "codec_name": "h264" })];

        let error = build_transcode_args(&request, &streams, None)
            .expect_err("invalid libaom preset should fail");

        assert!(error.contains("libaom-av1 preset must be an integer from 0 to 8"));
    }

    #[test]
    fn build_transcode_args_maps_libvpx_preset_to_cpu_used() {
        let mut request = build_request("/tmp/output.webm");
        request.container_id = "webm".to_string();
        request.video.encoder_id = Some("libvpx".to_string());
        request.video.preset = Some("16".to_string());
        let streams = vec![json!({ "codec_type": "video", "codec_name": "h264" })];

        let args =
            build_transcode_args(&request, &streams, None).expect("libvpx args should build");

        assert!(args.windows(2).any(|window| window == ["-cpu-used", "16"]));
        assert!(!args.iter().any(|arg| arg == "-preset"));
    }

    #[test]
    fn build_transcode_args_maps_libvpx_vp9_preset_to_cpu_used() {
        let mut request = build_request("/tmp/output.webm");
        request.container_id = "webm".to_string();
        request.video.encoder_id = Some("libvpx-vp9".to_string());
        request.video.preset = Some("8".to_string());
        let streams = vec![json!({ "codec_type": "video", "codec_name": "h264" })];

        let args =
            build_transcode_args(&request, &streams, None).expect("libvpx-vp9 args should build");

        assert!(args.windows(2).any(|window| window == ["-cpu-used", "8"]));
        assert!(!args.iter().any(|arg| arg == "-preset"));
    }

    #[test]
    fn build_transcode_args_rejects_invalid_libvpx_preset() {
        let mut request = build_request("/tmp/output.webm");
        request.container_id = "webm".to_string();
        request.video.encoder_id = Some("libvpx".to_string());
        request.video.preset = Some("17".to_string());
        let streams = vec![json!({ "codec_type": "video", "codec_name": "h264" })];

        let error = build_transcode_args(&request, &streams, None)
            .expect_err("invalid libvpx preset should fail");

        assert!(error.contains("libvpx preset must be an integer from 0 to 16"));
    }

    #[test]
    fn build_transcode_args_rejects_invalid_libvpx_vp9_preset() {
        let mut request = build_request("/tmp/output.webm");
        request.container_id = "webm".to_string();
        request.video.encoder_id = Some("libvpx-vp9".to_string());
        request.video.preset = Some("9".to_string());
        let streams = vec![json!({ "codec_type": "video", "codec_name": "h264" })];

        let error = build_transcode_args(&request, &streams, None)
            .expect_err("invalid libvpx-vp9 preset should fail");

        assert!(error.contains("libvpx-vp9 preset must be an integer from 0 to 8"));
    }

    #[test]
    fn build_transcode_args_sets_mapping_family_255_for_unsupported_libopus_layouts() {
        let mut request = build_request("/tmp/output.opus");
        request.container_id = "opus".to_string();
        request.video.mode = "disable".to_string();
        request.audio.encoder_id = Some("libopus".to_string());
        request.subtitles.mode = "disable".to_string();
        request.audio.channels = None;

        let streams = vec![json!({
            "codec_type": "audio",
            "codec_name": "flac",
            "channels": 6,
            "channel_layout": "5.1(side)"
        })];

        let args =
            build_transcode_args(&request, &streams, None).expect("libopus args should build");

        assert!(
            args.windows(2)
                .any(|window| window == ["-mapping_family:a:0", "255"])
        );
    }

    #[test]
    fn build_transcode_args_keeps_default_mapping_family_for_supported_libopus_layouts() {
        let mut request = build_request("/tmp/output.opus");
        request.container_id = "opus".to_string();
        request.video.mode = "disable".to_string();
        request.audio.encoder_id = Some("libopus".to_string());
        request.subtitles.mode = "disable".to_string();
        request.audio.channels = None;

        let streams = vec![json!({
            "codec_type": "audio",
            "codec_name": "flac",
            "channels": 6,
            "channel_layout": "5.1"
        })];

        let args =
            build_transcode_args(&request, &streams, None).expect("libopus args should build");

        assert!(!args.iter().any(|arg| arg.starts_with("-mapping_family")));
    }

    #[test]
    fn build_transcode_args_does_not_force_mapping_family_when_channels_are_overridden() {
        let mut request = build_request("/tmp/output.opus");
        request.container_id = "opus".to_string();
        request.video.mode = "disable".to_string();
        request.audio.encoder_id = Some("libopus".to_string());
        request.subtitles.mode = "disable".to_string();
        request.audio.channels = Some(6);

        let streams = vec![json!({
            "codec_type": "audio",
            "codec_name": "flac",
            "channels": 6,
            "channel_layout": "5.1(side)"
        })];

        let args =
            build_transcode_args(&request, &streams, None).expect("libopus args should build");

        assert!(!args.iter().any(|arg| arg.starts_with("-mapping_family")));
        assert!(args.windows(2).any(|window| window == ["-ac:a:0", "6"]));
    }

    #[test]
    fn build_transcode_args_maps_audio_tracks_per_override_and_scopes_additional_args() {
        let mut request = build_request("/tmp/output.mkv");
        request.container_id = "mkv".to_string();
        request.video.mode = "disable".to_string();
        request.subtitles.mode = "disable".to_string();
        request.audio.mode = "copy".to_string();
        request.audio.encoder_id = None;
        request.audio.bitrate_kbps = None;
        request.audio.channels = None;
        request.audio.sample_rate = None;
        request.audio.additional_args = vec![TranscodeAdditionalArg {
            _id: Some("application".to_string()),
            flag: "-application".to_string(),
            value: Some("audio".to_string()),
            enabled: true,
        }];
        request.audio.track_overrides = vec![
            TranscodeAudioTrackOverride {
                track_id: 4,
                mode: "transcode".to_string(),
                encoder_id: Some("libopus".to_string()),
                bitrate_kbps: Some(96),
                channels: None,
                sample_rate: Some(48_000),
                additional_args: vec![TranscodeAdditionalArg {
                    _id: Some("cutoff".to_string()),
                    flag: "-cutoff".to_string(),
                    value: Some("18000".to_string()),
                    enabled: true,
                }],
            },
            TranscodeAudioTrackOverride {
                track_id: 6,
                mode: "disable".to_string(),
                encoder_id: None,
                bitrate_kbps: None,
                channels: None,
                sample_rate: None,
                additional_args: Vec::new(),
            },
        ];
        let streams = vec![
            json!({ "index": 2, "codec_type": "audio", "codec_name": "flac" }),
            json!({ "index": 4, "codec_type": "audio", "codec_name": "ac3", "channels": 2, "channel_layout": "stereo" }),
            json!({ "index": 6, "codec_type": "audio", "codec_name": "aac" }),
        ];

        let args = build_transcode_args(&request, &streams, None)
            .expect("mixed audio override args should build");

        assert!(args.windows(2).any(|window| window == ["-map", "0:a:0"]));
        assert!(args.windows(2).any(|window| window == ["-map", "0:a:1"]));
        assert!(!args.windows(2).any(|window| window == ["-map", "0:a:2"]));
        assert!(args.windows(2).any(|window| window == ["-c:a:0", "copy"]));
        assert!(
            args.windows(2)
                .any(|window| window == ["-c:a:1", "libopus"])
        );
        assert!(args.windows(2).any(|window| window == ["-b:a:1", "96k"]));
        assert!(args.windows(2).any(|window| window == ["-ar:a:1", "48000"]));
        assert!(
            args.windows(2)
                .any(|window| window == ["-application:a:1", "audio"])
        );
        assert!(
            args.windows(2)
                .any(|window| window == ["-cutoff:a:1", "18000"])
        );
        assert!(!args.iter().any(|arg| arg == "-application:a:0"));
        assert!(!args.iter().any(|arg| arg == "-cutoff:a:0"));
    }

    #[test]
    fn build_transcode_args_rejects_incompatible_copy_for_one_audio_track() {
        let mut request = build_request("/tmp/output.webm");
        request.container_id = "webm".to_string();
        request.video.mode = "disable".to_string();
        request.subtitles.mode = "disable".to_string();
        request.audio.mode = "copy".to_string();
        request.audio.encoder_id = None;
        request.audio.bitrate_kbps = None;
        request.audio.channels = None;
        request.audio.sample_rate = None;
        request.audio.track_overrides = Vec::new();

        let streams = vec![
            json!({ "index": 1, "codec_type": "audio", "codec_name": "aac" }),
            json!({ "index": 2, "codec_type": "audio", "codec_name": "opus" }),
        ];

        let error = build_transcode_args(&request, &streams, None)
            .expect_err("aac copy to webm should fail when one track is incompatible");

        assert!(error.contains("cannot copy audio codec aac"));
    }

    #[test]
    fn build_transcode_args_preserves_audio_order_after_disabling_tracks() {
        let mut request = build_request("/tmp/output.mkv");
        request.container_id = "mkv".to_string();
        request.video.mode = "disable".to_string();
        request.subtitles.mode = "disable".to_string();
        request.audio.mode = "copy".to_string();
        request.audio.encoder_id = None;
        request.audio.bitrate_kbps = None;
        request.audio.channels = None;
        request.audio.sample_rate = None;
        request.audio.track_overrides = vec![TranscodeAudioTrackOverride {
            track_id: 3,
            mode: "disable".to_string(),
            encoder_id: None,
            bitrate_kbps: None,
            channels: None,
            sample_rate: None,
            additional_args: Vec::new(),
        }];
        let streams = vec![
            json!({ "index": 3, "codec_type": "audio", "codec_name": "flac" }),
            json!({ "index": 5, "codec_type": "audio", "codec_name": "ac3" }),
            json!({ "index": 7, "codec_type": "audio", "codec_name": "mp3" }),
        ];

        let args = build_transcode_args(&request, &streams, None)
            .expect("copy args should build when first track is disabled");

        let mapped_streams = args
            .windows(2)
            .filter(|window| window[0] == "-map")
            .map(|window| window[1].clone())
            .collect::<Vec<_>>();

        assert_eq!(
            mapped_streams,
            vec!["0:a:1".to_string(), "0:a:2".to_string()]
        );
        assert!(!args.windows(2).any(|window| window == ["-map", "0:a:0"]));
    }

    #[test]
    fn build_transcode_args_applies_metadata_to_output_indices_after_disabled_tracks() {
        let mut request = build_request("/tmp/output.mkv");
        request.container_id = "mkv".to_string();
        request.video.mode = "disable".to_string();
        request.subtitles.mode = "disable".to_string();
        request.audio.mode = "copy".to_string();
        request.audio.encoder_id = None;
        request.audio.bitrate_kbps = None;
        request.audio.channels = None;
        request.audio.sample_rate = None;
        request.audio.track_overrides = vec![TranscodeAudioTrackOverride {
            track_id: 3,
            mode: "disable".to_string(),
            encoder_id: None,
            bitrate_kbps: None,
            channels: None,
            sample_rate: None,
            additional_args: Vec::new(),
        }];
        request.metadata = MediaMetadataRequest {
            container_title: None,
            track_edits: vec![
                TrackMetadataEdit {
                    source_track_id: 5,
                    title: Some("Second audio".to_string()),
                    language: Some("eng".to_string()),
                    default: Some(true),
                    forced: Some(false),
                },
                TrackMetadataEdit {
                    source_track_id: 7,
                    title: Some("Third audio".to_string()),
                    language: Some("jpn".to_string()),
                    default: Some(false),
                    forced: Some(true),
                },
            ],
        };
        let streams = vec![
            json!({ "index": 3, "codec_type": "audio", "codec_name": "flac" }),
            json!({ "index": 5, "codec_type": "audio", "codec_name": "ac3" }),
            json!({ "index": 7, "codec_type": "audio", "codec_name": "mp3" }),
        ];

        let args = build_transcode_args(&request, &streams, None)
            .expect("metadata args should build after disabling the first track");

        assert!(args.windows(2).any(|window| window == ["-map", "0:a:1"]));
        assert!(args.windows(2).any(|window| window == ["-map", "0:a:2"]));
        assert!(
            args.windows(2)
                .any(|window| window == ["-metadata:s:0", "title=Second audio"])
        );
        assert!(
            args.windows(2)
                .any(|window| window == ["-metadata:s:0", "language=eng"])
        );
        assert!(
            args.windows(2)
                .any(|window| window == ["-disposition:0", "default"])
        );
        assert!(
            args.windows(2)
                .any(|window| window == ["-metadata:s:1", "title=Third audio"])
        );
        assert!(
            args.windows(2)
                .any(|window| window == ["-metadata:s:1", "language=jpn"])
        );
        assert!(
            args.windows(2)
                .any(|window| window == ["-disposition:1", "forced"])
        );
        assert!(!args.iter().any(|arg| arg == "-metadata:s:5"));
        assert!(!args.iter().any(|arg| arg == "-metadata:s:7"));
    }

    #[test]
    fn build_transcode_args_rejects_audio_only_output_when_all_tracks_are_disabled() {
        let mut request = build_request("/tmp/output.mka");
        request.container_id = "mkv".to_string();
        request.video.mode = "disable".to_string();
        request.subtitles.mode = "disable".to_string();
        request.audio.mode = "disable".to_string();
        request.audio.track_overrides = Vec::new();

        let streams = vec![
            json!({ "index": 1, "codec_type": "audio", "codec_name": "flac" }),
            json!({ "index": 2, "codec_type": "audio", "codec_name": "aac" }),
        ];

        let error = build_transcode_args(&request, &streams, None)
            .expect_err("all disabled audio-only output should fail");

        assert!(error.contains("No streams selected for output"));
    }

    #[test]
    fn build_transcode_args_keeps_svtav1_preset_mapping() {
        let mut request = build_request("/tmp/output.mkv");
        request.container_id = "mkv".to_string();
        request.video.encoder_id = Some("libsvtav1".to_string());
        request.video.preset = Some("6".to_string());
        let streams = vec![json!({ "codec_type": "video", "codec_name": "h264" })];

        let args =
            build_transcode_args(&request, &streams, None).expect("svtav1 args should build");

        assert!(args.windows(2).any(|window| window == ["-preset", "6"]));
        assert!(!args.iter().any(|arg| arg == "-cpu-used"));
    }

    #[test]
    fn transcode_request_rejects_output_extension_mismatch() {
        let request = build_request("/tmp/output.mkv");

        let error = super::validate_output_path_matches_container(&request)
            .expect_err("container and extension mismatch should fail");
        assert!(error.contains("does not match the selected container"));
    }

    #[tokio::test]
    async fn transcode_media_with_bins_generates_output_file() {
        let input = crate::test_support::assets::ensure_sample_video()
            .await
            .expect("failed to load local sample video");
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("sample-transcoded.mp4");

        let mut request = build_request(output.to_string_lossy().as_ref());
        request.input_path = input.to_string_lossy().to_string();

        let result_path = transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &request)
            .await
            .expect("transcode should succeed");

        assert_eq!(result_path, output.to_string_lossy().to_string());
        assert!(output.exists());
    }

    #[tokio::test]
    async fn transcode_audio_matrix_succeeds_for_available_encoders_and_layouts() {
        let capabilities = get_transcode_capabilities_with_ffmpeg_path(ffmpeg_path())
            .await
            .expect("failed to query transcode capabilities");

        assert!(
            !capabilities.audio_encoders.is_empty(),
            "expected at least one audio encoder"
        );

        let mut failures = Vec::new();

        for (layout, expected_input_channels) in AUDIO_LAYOUT_CASES {
            let fixture = generate_silence_wav(layout)
                .await
                .unwrap_or_else(|error| panic!("failed to generate {} fixture: {}", layout, error));
            let fixture_streams =
                collect_probe_streams(&fixture.path)
                    .await
                    .unwrap_or_else(|error| {
                        panic!("failed to probe {} fixture streams: {}", layout, error)
                    });

            assert_eq!(
                fixture.channels, *expected_input_channels,
                "unexpected channel count for generated {} fixture",
                layout
            );

            for encoder in &capabilities.audio_encoders {
                if should_skip_audio_matrix_case(&encoder.id, layout, *expected_input_channels)
                    .is_some()
                {
                    continue;
                }

                let Some(container_id) = pick_audio_test_container_id(&capabilities, &encoder.id)
                else {
                    failures.push(format!(
                        "encoder={} layout={}: no compatible audio container found",
                        encoder.id, layout
                    ));
                    continue;
                };

                let extension =
                    super::super::capabilities::container_extension_for_id(&container_id)
                        .unwrap_or(".bin");
                let temp_dir = new_temp_dir(&format!(
                    "audio-transcode-{}-",
                    sanitize_case_id(&encoder.id)
                ));
                let output_path = temp_dir.path().join(format!(
                    "{}_{}{}",
                    sanitize_case_id(&encoder.id),
                    sanitize_case_id(layout),
                    extension
                ));
                let request =
                    build_audio_only_request(&fixture.path, &output_path, &container_id, encoder);
                for error in collect_audio_request_arg_failures(
                    &build_transcode_args(&request, &fixture_streams, None)
                        .expect("audio request args should build"),
                    &request,
                ) {
                    failures.push(format!(
                        "encoder={} layout={}: {}",
                        encoder.id, layout, error
                    ));
                }

                match transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &request).await {
                    Ok(result_path) => {
                        match probe_primary_audio_stream(ffprobe_path(), Path::new(&result_path))
                            .await
                        {
                            Ok(probed_stream) => {
                                if let Some(error) = validate_transcoded_audio_stream(
                                    &encoder.id,
                                    *expected_input_channels,
                                    &probed_stream,
                                ) {
                                    failures.push(format!(
                                        "encoder={} layout={}: {}",
                                        encoder.id, layout, error
                                    ));
                                }
                            }
                            Err(error) => failures.push(format!(
                                "encoder={} layout={}: failed to probe output: {}",
                                encoder.id, layout, error
                            )),
                        }
                    }
                    Err(error) => failures.push(format!(
                        "encoder={} layout={}: transcode failed: {}",
                        encoder.id, layout, error
                    )),
                }
            }
        }

        assert!(
            failures.is_empty(),
            "audio transcode matrix failures:\n{}",
            failures.join("\n")
        );
    }

    #[tokio::test]
    async fn transcode_audio_libopus_handles_multichannel_as_source_layouts() {
        let capabilities = get_transcode_capabilities_with_ffmpeg_path(ffmpeg_path())
            .await
            .expect("failed to query transcode capabilities");
        let Some(libopus) = capabilities
            .audio_encoders
            .iter()
            .find(|encoder| encoder.id == "libopus")
        else {
            return;
        };
        let container_id = pick_audio_test_container_id(&capabilities, &libopus.id)
            .expect("expected an audio container for libopus");
        let extension = super::super::capabilities::container_extension_for_id(&container_id)
            .unwrap_or(".opus");
        let mut failures = Vec::new();

        for (layout, expected_channels) in [("4.0", 4_u64), ("5.1(side)", 6), ("7.1(wide-side)", 8)]
        {
            let fixture = generate_silence_wav(layout)
                .await
                .unwrap_or_else(|error| panic!("failed to generate {} fixture: {}", layout, error));
            let temp_dir = new_temp_dir(&format!("libopus-{}-", sanitize_case_id(layout)));
            let output_path =
                temp_dir
                    .path()
                    .join(format!("libopus_{}{}", sanitize_case_id(layout), extension));
            let request =
                build_audio_only_request(&fixture.path, &output_path, &container_id, libopus);

            match transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &request).await {
                Ok(result_path) => {
                    match probe_primary_audio_stream(ffprobe_path(), Path::new(&result_path)).await
                    {
                        Ok(probed_stream) => {
                            if probed_stream.codec_name != "opus" {
                                failures.push(format!(
                                    "layout={}: expected opus codec, got {}",
                                    layout, probed_stream.codec_name
                                ));
                            } else if probed_stream.channels != expected_channels {
                                failures.push(format!(
                                    "layout={}: expected {} channels, got {}",
                                    layout, expected_channels, probed_stream.channels
                                ));
                            }
                        }
                        Err(error) => failures.push(format!(
                            "layout={}: failed to probe output: {}",
                            layout, error
                        )),
                    }
                }
                Err(error) => {
                    failures.push(format!("layout={}: transcode failed: {}", layout, error))
                }
            }
        }

        assert!(
            failures.is_empty(),
            "libopus multichannel transcode failures:\n{}",
            failures.join("\n")
        );
    }

    #[tokio::test]
    async fn transcode_audio_overrides_cover_channels_sample_rate_and_bitrate() {
        let capabilities = get_transcode_capabilities_with_ffmpeg_path(ffmpeg_path())
            .await
            .expect("failed to query transcode capabilities");
        let stereo_fixture = generate_silence_wav("stereo")
            .await
            .expect("failed to generate stereo fixture");
        let surround_fixture = generate_silence_wav("5.1(side)")
            .await
            .expect("failed to generate surround fixture");
        let stereo_streams = collect_probe_streams(&stereo_fixture.path)
            .await
            .expect("failed to probe stereo fixture streams");
        let surround_streams = collect_probe_streams(&surround_fixture.path)
            .await
            .expect("failed to probe surround fixture streams");
        let representative_encoders = pick_preferred_audio_encoders(&capabilities);

        assert!(
            !representative_encoders.is_empty(),
            "expected at least one representative audio encoder"
        );

        let mut failures = Vec::new();

        for encoder in representative_encoders {
            let Some(container_id) = pick_audio_test_container_id(&capabilities, &encoder.id)
            else {
                failures.push(format!(
                    "encoder={}: no compatible audio container found",
                    encoder.id
                ));
                continue;
            };
            let extension = super::super::capabilities::container_extension_for_id(&container_id)
                .unwrap_or(".bin");

            let temp_dir = new_temp_dir(&format!(
                "audio-override-{}-",
                sanitize_case_id(&encoder.id)
            ));
            let bitrate_output = temp_dir.path().join(format!(
                "{}_bitrate{}",
                sanitize_case_id(&encoder.id),
                extension
            ));
            let mut bitrate_request = build_audio_only_request(
                &stereo_fixture.path,
                &bitrate_output,
                &container_id,
                encoder,
            );
            if encoder.id != "flac" && encoder.id != "pcm_s16le" {
                bitrate_request.audio.bitrate_kbps = Some(match encoder.id.as_str() {
                    "libopus" => 96,
                    "libmp3lame" => 128,
                    _ => 112,
                });
                let args = build_transcode_args(&bitrate_request, &stereo_streams, None)
                    .expect("bitrate request args should build");
                for error in collect_audio_request_arg_failures(&args, &bitrate_request) {
                    failures.push(format!(
                        "encoder={} scenario=bitrate: {}",
                        encoder.id, error
                    ));
                }

                match transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &bitrate_request)
                    .await
                {
                    Ok(result_path) => {
                        match probe_primary_audio_stream(ffprobe_path(), Path::new(&result_path))
                            .await
                        {
                            Ok(probed_stream) => {
                                if let Some(error) =
                                    validate_transcoded_audio_stream(&encoder.id, 2, &probed_stream)
                                {
                                    failures.push(format!(
                                        "encoder={} scenario=bitrate: {}",
                                        encoder.id, error
                                    ));
                                }
                            }
                            Err(error) => failures.push(format!(
                                "encoder={} scenario=bitrate: failed to probe output: {}",
                                encoder.id, error
                            )),
                        }
                    }
                    Err(error) => failures.push(format!(
                        "encoder={} scenario=bitrate: transcode failed: {}",
                        encoder.id, error
                    )),
                }
            }

            let runtime_info = probe_audio_encoder_runtime_info(ffmpeg_path(), &encoder.id)
                .await
                .unwrap_or_else(|_| crate::test_support::audio::AudioEncoderRuntimeInfo {
                    supported_sample_rates: Vec::new(),
                });
            if let Some(sample_rate) =
                pick_audio_override_sample_rate(&encoder.id, &runtime_info.supported_sample_rates)
            {
                let sample_rate_output = temp_dir.path().join(format!(
                    "{}_sample_rate{}",
                    sanitize_case_id(&encoder.id),
                    extension
                ));
                let mut sample_rate_request = build_audio_only_request(
                    &stereo_fixture.path,
                    &sample_rate_output,
                    &container_id,
                    encoder,
                );
                sample_rate_request.audio.sample_rate = Some(sample_rate);
                let args = build_transcode_args(&sample_rate_request, &stereo_streams, None)
                    .expect("sample rate request args should build");
                for error in collect_audio_request_arg_failures(&args, &sample_rate_request) {
                    failures.push(format!(
                        "encoder={} scenario=sample_rate: {}",
                        encoder.id, error
                    ));
                }

                match transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &sample_rate_request)
                    .await
                {
                    Ok(result_path) => {
                        match probe_primary_audio_stream(ffprobe_path(), Path::new(&result_path))
                            .await
                        {
                            Ok(probed_stream) => {
                                if let Some(error) =
                                    validate_transcoded_audio_stream(&encoder.id, 2, &probed_stream)
                                {
                                    failures.push(format!(
                                        "encoder={} scenario=sample_rate: {}",
                                        encoder.id, error
                                    ));
                                } else if probed_stream.sample_rate
                                    != Some(expected_output_sample_rate(&encoder.id, sample_rate))
                                {
                                    failures.push(format!(
                                        "encoder={} scenario=sample_rate: expected {} Hz, got {:?}",
                                        encoder.id,
                                        expected_output_sample_rate(&encoder.id, sample_rate),
                                        probed_stream.sample_rate
                                    ));
                                }
                            }
                            Err(error) => failures.push(format!(
                                "encoder={} scenario=sample_rate: failed to probe output: {}",
                                encoder.id, error
                            )),
                        }
                    }
                    Err(error) => failures.push(format!(
                        "encoder={} scenario=sample_rate: transcode failed: {}",
                        encoder.id, error
                    )),
                }
            }

            let channels_output = temp_dir.path().join(format!(
                "{}_downmix{}",
                sanitize_case_id(&encoder.id),
                extension
            ));
            let mut channels_request = build_audio_only_request(
                &surround_fixture.path,
                &channels_output,
                &container_id,
                encoder,
            );
            channels_request.audio.channels = Some(2);
            let args = build_transcode_args(&channels_request, &surround_streams, None)
                .expect("channel override request args should build");
            for error in collect_audio_request_arg_failures(&args, &channels_request) {
                failures.push(format!(
                    "encoder={} scenario=downmix: {}",
                    encoder.id, error
                ));
            }

            match transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &channels_request).await
            {
                Ok(result_path) => {
                    match probe_primary_audio_stream(ffprobe_path(), Path::new(&result_path)).await
                    {
                        Ok(probed_stream) => {
                            if let Some(error) =
                                validate_transcoded_audio_stream(&encoder.id, 2, &probed_stream)
                            {
                                failures.push(format!(
                                    "encoder={} scenario=downmix: {}",
                                    encoder.id, error
                                ));
                            }
                        }
                        Err(error) => failures.push(format!(
                            "encoder={} scenario=downmix: failed to probe output: {}",
                            encoder.id, error
                        )),
                    }
                }
                Err(error) => failures.push(format!(
                    "encoder={} scenario=downmix: transcode failed: {}",
                    encoder.id, error
                )),
            }
        }

        assert!(
            failures.is_empty(),
            "audio override failures:\n{}",
            failures.join("\n")
        );
    }

    #[tokio::test]
    async fn transcode_video_matrix_succeeds_for_available_encoders() {
        let capabilities = get_transcode_capabilities_with_ffmpeg_path(ffmpeg_path())
            .await
            .expect("failed to query transcode capabilities");
        let fixture = generate_test_pattern_video(VIDEO_TEST_WIDTH, VIDEO_TEST_HEIGHT)
            .await
            .expect("failed to generate video fixture");
        let fixture_streams = collect_probe_streams(&fixture.path)
            .await
            .expect("failed to probe video fixture streams");

        assert_eq!(fixture.width, VIDEO_TEST_WIDTH);
        assert_eq!(fixture.height, VIDEO_TEST_HEIGHT);

        let mut failures = Vec::new();

        for encoder in &capabilities.video_encoders {
            if should_skip_runtime_video_encoder(&encoder.id) {
                continue;
            }

            let Some(container_id) = pick_video_test_container_id(&capabilities, &encoder.id)
            else {
                failures.push(format!(
                    "encoder={}: no compatible video container found",
                    encoder.id
                ));
                continue;
            };

            let extension = super::super::capabilities::container_extension_for_id(&container_id)
                .unwrap_or(".bin");
            let temp_dir = new_temp_dir(&format!(
                "video-transcode-{}-",
                sanitize_case_id(&encoder.id)
            ));
            let output_path = temp_dir.path().join(format!(
                "{}_primary{}",
                sanitize_case_id(&encoder.id),
                extension
            ));
            let scenario = build_primary_video_scenario(encoder);
            let request = build_video_only_request(
                &fixture.path,
                &output_path,
                &container_id,
                encoder,
                &scenario,
            );
            for error in collect_video_request_arg_failures(
                &build_transcode_args(&request, &fixture_streams, None)
                    .expect("video request args should build"),
                &request,
                encoder,
            ) {
                failures.push(format!("encoder={}: {}", encoder.id, error));
            }

            match transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &request).await {
                Ok(result_path) => {
                    match probe_primary_video_stream(ffprobe_path(), Path::new(&result_path)).await
                    {
                        Ok(probed_stream) => {
                            if let Some(error) =
                                validate_transcoded_video_stream(&encoder.id, &probed_stream)
                            {
                                failures.push(format!("encoder={}: {}", encoder.id, error));
                            }
                        }
                        Err(error) => failures.push(format!(
                            "encoder={}: failed to probe output: {}",
                            encoder.id, error
                        )),
                    }
                }
                Err(error) => failures.push(format!(
                    "encoder={}: transcode failed: {}",
                    encoder.id, error
                )),
            }
        }

        assert!(
            failures.is_empty(),
            "video transcode matrix failures:\n{}",
            failures.join("\n")
        );
    }

    #[tokio::test]
    async fn transcode_video_quality_modes_presets_and_params_cover_representative_codecs() {
        let capabilities = get_transcode_capabilities_with_ffmpeg_path(ffmpeg_path())
            .await
            .expect("failed to query transcode capabilities");
        let fixture = generate_test_pattern_video(VIDEO_TEST_WIDTH, VIDEO_TEST_HEIGHT)
            .await
            .expect("failed to generate video fixture");
        let fixture_streams = collect_probe_streams(&fixture.path)
            .await
            .expect("failed to probe representative video fixture streams");
        let representative_encoders = select_representative_video_encoders(&capabilities);

        assert!(
            !representative_encoders.is_empty(),
            "expected at least one representative video encoder"
        );

        let mut failures = Vec::new();

        for encoder in representative_encoders {
            let Some(container_id) = pick_video_test_container_id(&capabilities, &encoder.id)
            else {
                failures.push(format!(
                    "encoder={}: no compatible video container found",
                    encoder.id
                ));
                continue;
            };
            let extension = super::super::capabilities::container_extension_for_id(&container_id)
                .unwrap_or(".bin");

            for scenario in build_representative_video_scenarios(encoder) {
                let temp_dir = new_temp_dir(&format!(
                    "video-scenario-{}-{}-",
                    sanitize_case_id(&encoder.id),
                    sanitize_case_id(scenario.name)
                ));
                let output_path = temp_dir.path().join(format!(
                    "{}_{}{}",
                    sanitize_case_id(&encoder.id),
                    sanitize_case_id(scenario.name),
                    extension
                ));
                let request = build_video_only_request(
                    &fixture.path,
                    &output_path,
                    &container_id,
                    encoder,
                    &scenario,
                );
                for error in collect_video_request_arg_failures(
                    &build_transcode_args(&request, &fixture_streams, None)
                        .expect("representative video request args should build"),
                    &request,
                    encoder,
                ) {
                    failures.push(format!(
                        "encoder={} scenario={}: {}",
                        encoder.id, scenario.name, error
                    ));
                }

                match transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &request).await {
                    Ok(result_path) => {
                        match probe_primary_video_stream(ffprobe_path(), Path::new(&result_path))
                            .await
                        {
                            Ok(probed_stream) => {
                                if let Some(error) = validate_transcoded_video_output(
                                    encoder,
                                    &container_id,
                                    &scenario,
                                    &probed_stream,
                                ) {
                                    failures.push(format!(
                                        "encoder={} scenario={}: {}",
                                        encoder.id, scenario.name, error
                                    ));
                                }
                            }
                            Err(error) => failures.push(format!(
                                "encoder={} scenario={}: failed to probe output: {}",
                                encoder.id, scenario.name, error
                            )),
                        }
                    }
                    Err(error) => failures.push(format!(
                        "encoder={} scenario={}: transcode failed: {}",
                        encoder.id, scenario.name, error
                    )),
                }
            }
        }

        assert!(
            failures.is_empty(),
            "representative video transcode failures:\n{}",
            failures.join("\n")
        );
    }

    #[tokio::test]
    async fn transcode_video_advanced_capabilities_cover_profiles_levels_and_ten_bit() {
        let capabilities = get_transcode_capabilities_with_ffmpeg_path(ffmpeg_path())
            .await
            .expect("failed to query transcode capabilities");
        let fixture = generate_test_pattern_video(VIDEO_TEST_WIDTH, VIDEO_TEST_HEIGHT)
            .await
            .expect("failed to generate video fixture");
        let fixture_streams = collect_probe_streams(&fixture.path)
            .await
            .expect("failed to probe advanced video fixture streams");
        let representative_encoders = select_representative_video_encoders(&capabilities);

        let mut failures = Vec::new();
        let mut executed_scenarios = 0usize;

        for encoder in representative_encoders {
            let Some(container_id) = pick_video_test_container_id(&capabilities, &encoder.id)
            else {
                continue;
            };
            let extension = super::super::capabilities::container_extension_for_id(&container_id)
                .unwrap_or(".bin");

            for scenario in build_advanced_video_capability_scenarios(encoder) {
                executed_scenarios += 1;
                let temp_dir = new_temp_dir(&format!(
                    "video-advanced-{}-{}-",
                    sanitize_case_id(&encoder.id),
                    sanitize_case_id(scenario.name)
                ));
                let output_path = temp_dir.path().join(format!(
                    "{}_{}{}",
                    sanitize_case_id(&encoder.id),
                    sanitize_case_id(scenario.name),
                    extension
                ));
                let request = build_video_only_request(
                    &fixture.path,
                    &output_path,
                    &container_id,
                    encoder,
                    &scenario,
                );
                for error in collect_video_request_arg_failures(
                    &build_transcode_args(&request, &fixture_streams, None)
                        .expect("advanced video request args should build"),
                    &request,
                    encoder,
                ) {
                    failures.push(format!(
                        "encoder={} scenario={}: {}",
                        encoder.id, scenario.name, error
                    ));
                }

                match transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &request).await {
                    Ok(result_path) => {
                        match probe_primary_video_stream(ffprobe_path(), Path::new(&result_path))
                            .await
                        {
                            Ok(probed_stream) => {
                                if let Some(error) = validate_transcoded_video_output(
                                    encoder,
                                    &container_id,
                                    &scenario,
                                    &probed_stream,
                                ) {
                                    failures.push(format!(
                                        "encoder={} scenario={}: {}",
                                        encoder.id, scenario.name, error
                                    ));
                                }
                            }
                            Err(error) => failures.push(format!(
                                "encoder={} scenario={}: failed to probe output: {}",
                                encoder.id, scenario.name, error
                            )),
                        }
                    }
                    Err(error) => failures.push(format!(
                        "encoder={} scenario={}: transcode failed: {}",
                        encoder.id, scenario.name, error
                    )),
                }
            }
        }

        if executed_scenarios == 0 {
            return;
        }

        assert!(
            failures.is_empty(),
            "advanced video capability failures:\n{}",
            failures.join("\n")
        );
    }

    #[tokio::test]
    async fn transcode_av_copy_and_mixed_modes_preserve_expected_streams() {
        let capabilities = get_transcode_capabilities_with_ffmpeg_path(ffmpeg_path())
            .await
            .expect("failed to query transcode capabilities");
        let fixture = generate_test_pattern_av_mp4()
            .await
            .expect("failed to generate AV fixture");
        let mkv_container = capabilities
            .containers
            .iter()
            .find(|container| container.id == "mkv")
            .expect("expected MKV container");
        let video_encoder =
            select_runtime_video_encoder_for_container(&capabilities, mkv_container)
                .expect("expected a CI-testable video encoder for MKV");
        let audio_encoder = capabilities
            .audio_encoders
            .iter()
            .find(|encoder| Some(&encoder.id) == mkv_container.default_audio_encoder_id.as_ref())
            .or_else(|| {
                capabilities.audio_encoders.iter().find(|encoder| {
                    mkv_container
                        .supported_audio_encoder_ids
                        .iter()
                        .any(|supported_id| supported_id == &encoder.id)
                })
            })
            .expect("expected an audio encoder for MKV");
        let mut failures = Vec::new();

        {
            let temp_dir = new_temp_dir("av-copy-copy-");
            let output_path = temp_dir.path().join("copy_copy.mkv");
            let mut request = build_av_request(&fixture.path, &output_path, "mkv");
            request.video.mode = "copy".to_string();
            request.video.encoder_id = None;
            request.video.profile = None;
            request.video.level = None;
            request.video.pixel_format = None;
            request.video.quality_mode = None;
            request.video.crf = None;
            request.video.qp = None;
            request.video.bitrate_kbps = None;
            request.video.preset = None;
            request.video.additional_args = Vec::new();
            request.audio.mode = "copy".to_string();
            request.audio.encoder_id = None;
            request.audio.bitrate_kbps = None;
            request.audio.channels = None;
            request.audio.sample_rate = None;
            request.audio.additional_args = Vec::new();
            request.audio.track_overrides = Vec::new();

            match transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &request).await {
                Ok(result_path) => {
                    let counts = probe_media_stream_counts(ffprobe_path(), Path::new(&result_path))
                        .await
                        .expect("failed to probe copy-copy output");
                    if let Some(error) = assert_media_counts(&counts, 1, 1) {
                        failures.push(format!("scenario=copy_copy: {}", error));
                    }
                }
                Err(error) => {
                    failures.push(format!("scenario=copy_copy: transcode failed: {}", error))
                }
            }
        }

        {
            let temp_dir = new_temp_dir("av-video-transcode-audio-copy-");
            let output_path = temp_dir.path().join("video_transcode_audio_copy.mkv");
            let mut request = build_av_request(&fixture.path, &output_path, "mkv");
            apply_video_transcode_settings(
                &mut request,
                video_encoder,
                &build_primary_video_scenario(video_encoder),
            );
            request.audio.mode = "copy".to_string();
            request.audio.encoder_id = None;
            request.audio.bitrate_kbps = None;
            request.audio.channels = None;
            request.audio.sample_rate = None;
            request.audio.additional_args = Vec::new();
            request.audio.track_overrides = Vec::new();

            match transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &request).await {
                Ok(result_path) => {
                    let counts = probe_media_stream_counts(ffprobe_path(), Path::new(&result_path))
                        .await
                        .expect("failed to probe mixed output");
                    if let Some(error) = assert_media_counts(&counts, 1, 1) {
                        failures.push(format!("scenario=video_transcode_audio_copy: {}", error));
                    } else if let Ok(probed_stream) =
                        probe_primary_video_stream(ffprobe_path(), Path::new(&result_path)).await
                    {
                        if let Some(error) =
                            validate_transcoded_video_stream(&video_encoder.id, &probed_stream)
                        {
                            failures
                                .push(format!("scenario=video_transcode_audio_copy: {}", error));
                        }
                    }
                }
                Err(error) => failures.push(format!(
                    "scenario=video_transcode_audio_copy: transcode failed: {}",
                    error
                )),
            }
        }

        {
            let temp_dir = new_temp_dir("av-video-copy-audio-transcode-");
            let output_path = temp_dir.path().join("video_copy_audio_transcode.mkv");
            let mut request = build_av_request(&fixture.path, &output_path, "mkv");
            request.video.mode = "copy".to_string();
            request.video.encoder_id = None;
            request.video.profile = None;
            request.video.level = None;
            request.video.pixel_format = None;
            request.video.quality_mode = None;
            request.video.crf = None;
            request.video.qp = None;
            request.video.bitrate_kbps = None;
            request.video.preset = None;
            request.video.additional_args = Vec::new();
            apply_audio_transcode_settings(&mut request, audio_encoder);

            match transcode_media_with_bins(ffmpeg_path(), ffprobe_path(), &request).await {
                Ok(result_path) => {
                    let counts = probe_media_stream_counts(ffprobe_path(), Path::new(&result_path))
                        .await
                        .expect("failed to probe mixed output");
                    if let Some(error) = assert_media_counts(&counts, 1, 1) {
                        failures.push(format!("scenario=video_copy_audio_transcode: {}", error));
                    } else if let Ok(probed_stream) =
                        probe_primary_audio_stream(ffprobe_path(), Path::new(&result_path)).await
                    {
                        if let Some(error) =
                            validate_transcoded_audio_stream(&audio_encoder.id, 2, &probed_stream)
                        {
                            failures
                                .push(format!("scenario=video_copy_audio_transcode: {}", error));
                        }
                    }
                }
                Err(error) => failures.push(format!(
                    "scenario=video_copy_audio_transcode: transcode failed: {}",
                    error
                )),
            }
        }

        assert!(
            failures.is_empty(),
            "AV mixed mode failures:\n{}",
            failures.join("\n")
        );
    }
}
