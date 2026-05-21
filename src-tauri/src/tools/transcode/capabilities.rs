use std::collections::{BTreeSet, HashSet};

use crate::shared::process::tokio_command;
use serde::{Deserialize, Serialize};

use crate::shared::store::resolve_ffmpeg_path;
use crate::tools::media_metadata::{ContainerMetadataSchema, metadata_schema_for_container};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeCapabilities {
    pub(crate) ffmpeg_version: String,
    pub(crate) hwaccels: Vec<String>,
    pub(crate) containers: Vec<TranscodeContainerCapability>,
    pub(crate) video_encoders: Vec<TranscodeVideoEncoderCapability>,
    pub(crate) audio_encoders: Vec<TranscodeAudioEncoderCapability>,
    pub(crate) subtitle_encoders: Vec<TranscodeSubtitleEncoderCapability>,
    pub(crate) default_analysis_frame_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeContainerCapability {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) extension: String,
    pub(crate) kind: String,
    pub(crate) muxer_name: String,
    pub(crate) supported_video_encoder_ids: Vec<String>,
    pub(crate) supported_audio_encoder_ids: Vec<String>,
    pub(crate) supported_subtitle_encoder_ids: Vec<String>,
    pub(crate) supported_subtitle_modes: Vec<String>,
    pub(crate) default_video_encoder_id: Option<String>,
    pub(crate) default_audio_encoder_id: Option<String>,
    pub(crate) default_subtitle_encoder_id: Option<String>,
    pub(crate) metadata_schema: ContainerMetadataSchema,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeVideoEncoderCapability {
    pub(crate) id: String,
    pub(crate) codec: String,
    pub(crate) label: String,
    pub(crate) is_hardware: bool,
    pub(crate) supported_pixel_formats: Vec<String>,
    pub(crate) supported_profiles: Vec<String>,
    pub(crate) supported_levels: Vec<String>,
    pub(crate) supported_bit_depths: Vec<u8>,
    pub(crate) supports_preset: bool,
    pub(crate) supports_crf: bool,
    pub(crate) supports_qp: bool,
    pub(crate) supports_bitrate: bool,
    pub(crate) options: Vec<TranscodeEncoderOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeAudioEncoderCapability {
    pub(crate) id: String,
    pub(crate) codec: String,
    pub(crate) label: String,
    pub(crate) supports_bitrate: bool,
    pub(crate) supports_channels: bool,
    pub(crate) supports_sample_rate: bool,
    pub(crate) options: Vec<TranscodeEncoderOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeSubtitleEncoderCapability {
    pub(crate) id: String,
    pub(crate) codec: String,
    pub(crate) label: String,
    pub(crate) kind: String,
    pub(crate) options: Vec<TranscodeEncoderOption>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TranscodeEncoderOptionValueKind {
    Boolean,
    Int,
    Float,
    String,
    Dictionary,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeEncoderOptionChoice {
    pub(crate) value: String,
    pub(crate) description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeEncoderOption {
    pub(crate) flag: String,
    pub(crate) value_kind: TranscodeEncoderOptionValueKind,
    pub(crate) description: String,
    pub(crate) default_value: Option<String>,
    pub(crate) min: Option<f64>,
    pub(crate) max: Option<f64>,
    pub(crate) choices: Vec<TranscodeEncoderOptionChoice>,
}

#[derive(Debug, Clone, Copy)]
struct KnownVideoEncoder {
    id: &'static str,
    codec: &'static str,
    label: &'static str,
    is_hardware: bool,
    supported_container_ids: &'static [&'static str],
}

#[derive(Debug, Clone, Copy)]
struct KnownAudioEncoder {
    id: &'static str,
    codec: &'static str,
    label: &'static str,
    supported_container_ids: &'static [&'static str],
}

#[derive(Debug, Clone, Copy)]
struct KnownSubtitleEncoder {
    id: &'static str,
    codec: &'static str,
    label: &'static str,
    kind: &'static str,
    supported_container_ids: &'static [&'static str],
}

#[derive(Debug, Clone, Copy)]
struct KnownContainer {
    id: &'static str,
    label: &'static str,
    extension: &'static str,
    kind: &'static str,
    muxer_name: &'static str,
    default_video_encoder_priority: &'static [&'static str],
    default_audio_encoder_priority: &'static [&'static str],
    default_subtitle_encoder_priority: &'static [&'static str],
}

const DEFAULT_ANALYSIS_FRAME_COUNT: usize = 6;

const KNOWN_VIDEO_ENCODERS: &[KnownVideoEncoder] = &[
    KnownVideoEncoder {
        id: "h264_videotoolbox",
        codec: "h264",
        label: "H.264 (VideoToolbox)",
        is_hardware: true,
        supported_container_ids: &["mp4", "mkv", "mov"],
    },
    KnownVideoEncoder {
        id: "hevc_videotoolbox",
        codec: "hevc",
        label: "HEVC (VideoToolbox)",
        is_hardware: true,
        supported_container_ids: &["mp4", "mkv", "mov"],
    },
    KnownVideoEncoder {
        id: "libx264",
        codec: "h264",
        label: "H.264 (libx264)",
        is_hardware: false,
        supported_container_ids: &["mp4", "mkv", "mov"],
    },
    KnownVideoEncoder {
        id: "libx265",
        codec: "hevc",
        label: "HEVC (libx265)",
        is_hardware: false,
        supported_container_ids: &["mp4", "mkv", "mov"],
    },
    KnownVideoEncoder {
        id: "libsvtav1",
        codec: "av1",
        label: "AV1 (SVT-AV1)",
        is_hardware: false,
        supported_container_ids: &["mp4", "mkv", "webm"],
    },
    KnownVideoEncoder {
        id: "libaom-av1",
        codec: "av1",
        label: "AV1 (libaom)",
        is_hardware: false,
        supported_container_ids: &["mp4", "mkv", "webm"],
    },
    KnownVideoEncoder {
        id: "libvpx",
        codec: "vp8",
        label: "VP8 (libvpx)",
        is_hardware: false,
        supported_container_ids: &["webm", "mkv"],
    },
    KnownVideoEncoder {
        id: "libvpx-vp9",
        codec: "vp9",
        label: "VP9 (libvpx)",
        is_hardware: false,
        supported_container_ids: &["webm", "mkv"],
    },
    KnownVideoEncoder {
        id: "prores_ks",
        codec: "prores",
        label: "Apple ProRes (prores_ks)",
        is_hardware: false,
        supported_container_ids: &["mov", "mkv"],
    },
    KnownVideoEncoder {
        id: "prores_videotoolbox",
        codec: "prores",
        label: "Apple ProRes (VideoToolbox)",
        is_hardware: true,
        supported_container_ids: &["mov"],
    },
];

const KNOWN_AUDIO_ENCODERS: &[KnownAudioEncoder] = &[
    KnownAudioEncoder {
        id: "aac",
        codec: "aac",
        label: "AAC",
        supported_container_ids: &["mp4", "mkv", "mov", "aac"],
    },
    KnownAudioEncoder {
        id: "aac_at",
        codec: "aac",
        label: "AAC (AudioToolbox)",
        supported_container_ids: &["mp4", "mkv", "mov", "aac"],
    },
    KnownAudioEncoder {
        id: "libopus",
        codec: "opus",
        label: "Opus",
        supported_container_ids: &["mkv", "webm", "opus", "ogg"],
    },
    KnownAudioEncoder {
        id: "libvorbis",
        codec: "vorbis",
        label: "Vorbis (libvorbis)",
        supported_container_ids: &["mkv", "webm", "ogg"],
    },
    KnownAudioEncoder {
        id: "libmp3lame",
        codec: "mp3",
        label: "MP3 (LAME)",
        supported_container_ids: &["mkv", "mp3"],
    },
    KnownAudioEncoder {
        id: "flac",
        codec: "flac",
        label: "FLAC",
        supported_container_ids: &["mkv", "flac"],
    },
    KnownAudioEncoder {
        id: "pcm_s16le",
        codec: "pcm_s16le",
        label: "PCM 16-bit",
        supported_container_ids: &["mkv", "wav"],
    },
];

const KNOWN_SUBTITLE_ENCODERS: &[KnownSubtitleEncoder] = &[
    KnownSubtitleEncoder {
        id: "mov_text",
        codec: "mov_text",
        label: "MP4 Timed Text",
        kind: "text",
        supported_container_ids: &["mp4", "mov"],
    },
    KnownSubtitleEncoder {
        id: "srt",
        codec: "srt",
        label: "SubRip (SRT)",
        kind: "text",
        supported_container_ids: &["mkv"],
    },
    KnownSubtitleEncoder {
        id: "ass",
        codec: "ass",
        label: "ASS",
        kind: "text",
        supported_container_ids: &["mkv"],
    },
    KnownSubtitleEncoder {
        id: "webvtt",
        codec: "webvtt",
        label: "WebVTT",
        kind: "text",
        supported_container_ids: &["webm"],
    },
];

const KNOWN_CONTAINERS: &[KnownContainer] = &[
    KnownContainer {
        id: "mp4",
        label: "MP4",
        extension: ".mp4",
        kind: "video",
        muxer_name: "mp4",
        default_video_encoder_priority: &[
            "hevc_videotoolbox",
            "h264_videotoolbox",
            "libx265",
            "libx264",
        ],
        default_audio_encoder_priority: &["aac_at", "aac"],
        default_subtitle_encoder_priority: &["mov_text"],
    },
    KnownContainer {
        id: "mkv",
        label: "MKV",
        extension: ".mkv",
        kind: "video",
        muxer_name: "matroska",
        default_video_encoder_priority: &[
            "hevc_videotoolbox",
            "h264_videotoolbox",
            "libx265",
            "libx264",
            "libsvtav1",
            "libaom-av1",
            "libvpx",
            "libvpx-vp9",
        ],
        default_audio_encoder_priority: &[
            "libopus",
            "flac",
            "libvorbis",
            "aac_at",
            "aac",
            "libmp3lame",
        ],
        default_subtitle_encoder_priority: &["srt", "ass"],
    },
    KnownContainer {
        id: "mov",
        label: "MOV",
        extension: ".mov",
        kind: "video",
        muxer_name: "mov",
        default_video_encoder_priority: &[
            "hevc_videotoolbox",
            "h264_videotoolbox",
            "libx265",
            "libx264",
            "prores_videotoolbox",
            "prores_ks",
        ],
        default_audio_encoder_priority: &["aac_at", "aac"],
        default_subtitle_encoder_priority: &["mov_text"],
    },
    KnownContainer {
        id: "webm",
        label: "WebM",
        extension: ".webm",
        kind: "video",
        muxer_name: "webm",
        default_video_encoder_priority: &["libvpx-vp9", "libsvtav1", "libaom-av1", "libvpx"],
        default_audio_encoder_priority: &["libopus", "libvorbis"],
        default_subtitle_encoder_priority: &["webvtt"],
    },
    KnownContainer {
        id: "aac",
        label: "AAC",
        extension: ".aac",
        kind: "audio",
        muxer_name: "adts",
        default_video_encoder_priority: &[],
        default_audio_encoder_priority: &["aac_at", "aac"],
        default_subtitle_encoder_priority: &[],
    },
    KnownContainer {
        id: "mp3",
        label: "MP3",
        extension: ".mp3",
        kind: "audio",
        muxer_name: "mp3",
        default_video_encoder_priority: &[],
        default_audio_encoder_priority: &["libmp3lame"],
        default_subtitle_encoder_priority: &[],
    },
    KnownContainer {
        id: "flac",
        label: "FLAC",
        extension: ".flac",
        kind: "audio",
        muxer_name: "flac",
        default_video_encoder_priority: &[],
        default_audio_encoder_priority: &["flac"],
        default_subtitle_encoder_priority: &[],
    },
    KnownContainer {
        id: "opus",
        label: "Opus",
        extension: ".opus",
        kind: "audio",
        muxer_name: "opus",
        default_video_encoder_priority: &[],
        default_audio_encoder_priority: &["libopus"],
        default_subtitle_encoder_priority: &[],
    },
    KnownContainer {
        id: "ogg",
        label: "Ogg",
        extension: ".ogg",
        kind: "audio",
        muxer_name: "ogg",
        default_video_encoder_priority: &[],
        default_audio_encoder_priority: &["libvorbis", "libopus"],
        default_subtitle_encoder_priority: &[],
    },
    KnownContainer {
        id: "wav",
        label: "WAV",
        extension: ".wav",
        kind: "audio",
        muxer_name: "wav",
        default_video_encoder_priority: &[],
        default_audio_encoder_priority: &["pcm_s16le"],
        default_subtitle_encoder_priority: &[],
    },
];

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn container_extension_for_id(container_id: &str) -> Option<&'static str> {
    KNOWN_CONTAINERS
        .iter()
        .find(|container| container.id == container_id)
        .map(|container| container.extension)
}

async fn run_ffmpeg_command(ffmpeg_path: &str, args: &[&str]) -> Result<String, String> {
    let output = tokio_command(ffmpeg_path)
        .args(args)
        .output()
        .await
        .map_err(|error| format!("Failed to run ffmpeg {}: {}", args.join(" "), error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffmpeg {} failed: {}",
            args.join(" "),
            stderr.trim()
        ));
    }

    let mut combined = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    Ok(combined)
}

fn parse_ffmpeg_version(output: &str) -> String {
    output
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(2))
        .unwrap_or("Unknown")
        .to_string()
}

pub(crate) fn parse_ffmpeg_encoder_names(output: &str) -> HashSet<String> {
    let mut encoders = HashSet::new();

    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let Some(flags) = parts.next() else {
            continue;
        };
        let Some(name) = parts.next() else {
            continue;
        };

        if flags.len() == 6 && name != "=" {
            encoders.insert(name.to_string());
        }
    }

    encoders
}

pub(crate) fn parse_ffmpeg_muxer_names(output: &str) -> HashSet<String> {
    let mut muxers = HashSet::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('-') || trimmed.starts_with("Formats:") {
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let Some(flags) = parts.next() else {
            continue;
        };
        if !flags.contains('E') {
            continue;
        }

        if let Some(name) = parts.next() {
            if let Some(primary) = name.split(',').next() {
                muxers.insert(primary.to_string());
            }
        }
    }

    muxers
}

pub(crate) fn parse_ffmpeg_hwaccel_names(output: &str) -> Vec<String> {
    output
        .lines()
        .skip_while(|line| !line.trim().starts_with("Hardware acceleration methods:"))
        .skip(1)
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            Some(trimmed.to_string())
        })
        .collect()
}

fn parse_supported_pixel_formats(output: &str) -> Vec<String> {
    output
        .lines()
        .find_map(|line| {
            line.split_once("Supported pixel formats:")
                .map(|(_, values)| {
                    values
                        .split_whitespace()
                        .map(str::trim)
                        .filter(|value| is_selectable_output_pixel_format(value))
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
        })
        .unwrap_or_default()
}

fn is_selectable_output_pixel_format(pixel_format: &str) -> bool {
    !matches!(
        pixel_format,
        "videotoolbox_vld"
            | "d3d11"
            | "d3d11va_vld"
            | "dxva2_vld"
            | "vdpau"
            | "cuda"
            | "qsv"
            | "vaapi"
            | "drm_prime"
            | "opencl"
            | "vulkan"
            | "mediacodec"
    )
}

fn parse_option_enum_values(output: &str, option_name: &str) -> Vec<String> {
    let mut results = Vec::new();
    let mut in_option = false;
    let option_prefix = format!("-{}", option_name);

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if in_option {
                break;
            }
            continue;
        }

        if trimmed.starts_with('-') {
            if trimmed.starts_with(&option_prefix) {
                in_option = true;
                continue;
            }

            if in_option {
                break;
            }
            continue;
        }

        if in_option {
            let mut parts = trimmed.split_whitespace();
            if let Some(value) = parts.next() {
                results.push(value.to_string());
            }
        }
    }

    results
}

fn value_kind_from_ffmpeg_type(value_type: &str) -> TranscodeEncoderOptionValueKind {
    match value_type.trim_matches(['<', '>']) {
        "boolean" => TranscodeEncoderOptionValueKind::Boolean,
        "int" => TranscodeEncoderOptionValueKind::Int,
        "float" | "double" => TranscodeEncoderOptionValueKind::Float,
        "string" => TranscodeEncoderOptionValueKind::String,
        "dictionary" => TranscodeEncoderOptionValueKind::Dictionary,
        _ => TranscodeEncoderOptionValueKind::Unknown,
    }
}

fn looks_like_ffmpeg_option_caps(value: &str) -> bool {
    value.len() >= 4
        && value.contains('.')
        && value
            .chars()
            .all(|character| character == '.' || character.is_ascii_uppercase())
}

fn find_parenthesized_segment<'a>(input: &'a str, prefix: &str) -> Option<&'a str> {
    let mut rest = input;

    while let Some(start) = rest.find('(') {
        let after_open = &rest[start + 1..];
        let Some(end) = after_open.find(')') else {
            break;
        };

        let segment = &after_open[..end];
        if let Some(value) = segment.strip_prefix(prefix) {
            return Some(value.trim());
        }

        rest = &after_open[end + 1..];
    }

    None
}

fn parse_numeric_option_bound(value: &str) -> Option<f64> {
    let parsed = value.trim().parse::<f64>().ok()?;
    parsed.is_finite().then_some(parsed)
}

fn parse_option_range(description: &str) -> (Option<f64>, Option<f64>) {
    let Some(range) = find_parenthesized_segment(description, "from ") else {
        return (None, None);
    };
    let Some((min, max)) = range.split_once(" to ") else {
        return (None, None);
    };

    (
        parse_numeric_option_bound(min),
        parse_numeric_option_bound(max),
    )
}

fn parse_option_default_value(description: &str) -> Option<String> {
    find_parenthesized_segment(description, "default ").map(|value| {
        value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string()
    })
}

fn strip_option_metadata_segments(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut rest = input;

    while let Some(start) = rest.find('(') {
        output.push_str(&rest[..start]);
        let after_open = &rest[start + 1..];
        let Some(end) = after_open.find(')') else {
            output.push_str(&rest[start..]);
            return output.split_whitespace().collect::<Vec<_>>().join(" ");
        };

        let segment = &after_open[..end];
        if !(segment.starts_with("from ") || segment.starts_with("default ")) {
            output.push('(');
            output.push_str(segment);
            output.push(')');
        }

        rest = &after_open[end + 1..];
    }

    output.push_str(rest);
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_encoder_option_line(line: &str) -> Option<TranscodeEncoderOption> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with('-') {
        return None;
    }

    let mut parts = trimmed.split_whitespace();
    let flag = parts.next()?;
    let value_type = parts.next()?;
    if !value_type.starts_with('<') || !value_type.ends_with('>') {
        return None;
    }

    let _caps = parts.next()?;
    let raw_description = parts.collect::<Vec<_>>().join(" ");
    let (min, max) = parse_option_range(&raw_description);

    Some(TranscodeEncoderOption {
        flag: flag.to_string(),
        value_kind: value_kind_from_ffmpeg_type(value_type),
        description: strip_option_metadata_segments(&raw_description),
        default_value: parse_option_default_value(&raw_description),
        min,
        max,
        choices: Vec::new(),
    })
}

fn parse_encoder_option_choice_line(line: &str) -> Option<TranscodeEncoderOptionChoice> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return None;
    }

    let tokens = trimmed.split_whitespace().collect::<Vec<_>>();
    let value = tokens.first()?;
    let caps_index = tokens
        .iter()
        .position(|token| looks_like_ffmpeg_option_caps(token))?;
    let description = tokens.get(caps_index + 1..).unwrap_or_default().join(" ");

    Some(TranscodeEncoderOptionChoice {
        value: (*value).to_string(),
        description,
    })
}

pub(crate) fn parse_encoder_options(output: &str) -> Vec<TranscodeEncoderOption> {
    let mut options = Vec::new();
    let mut in_avoptions = false;

    for line in output.lines() {
        let trimmed = line.trim();

        if trimmed.ends_with("AVOptions:") {
            in_avoptions = true;
            continue;
        }

        if !in_avoptions {
            continue;
        }

        if trimmed.is_empty() || trimmed.starts_with("Exiting with exit code") {
            continue;
        }

        if let Some(option) = parse_encoder_option_line(line) {
            options.push(option);
            continue;
        }

        if let Some(choice) = parse_encoder_option_choice_line(line) {
            if let Some(option) = options.last_mut() {
                option.choices.push(choice);
            }
        }
    }

    options
}

fn help_supports_flag(output: &str, flag: &str) -> bool {
    output.lines().any(|line| line.contains(flag))
}

fn video_encoder_supports_bitrate(help: &str) -> bool {
    ["-crf", "-qp", "-constant_bit_rate"]
        .iter()
        .any(|flag| help_supports_flag(help, flag))
}

pub(crate) fn derive_bit_depths_from_pixel_formats(pixel_formats: &[String]) -> Vec<u8> {
    let mut depths = BTreeSet::new();

    for pixel_format in pixel_formats {
        if pixel_format.contains("p010") || pixel_format.contains("10") {
            depths.insert(10);
            continue;
        }
        if pixel_format.contains("12") {
            depths.insert(12);
            continue;
        }
        depths.insert(8);
    }

    depths.into_iter().collect()
}

async fn build_video_encoder_capabilities(
    ffmpeg_path: &str,
    available_encoders: &HashSet<String>,
) -> Vec<TranscodeVideoEncoderCapability> {
    let mut capabilities = Vec::new();

    for encoder in KNOWN_VIDEO_ENCODERS {
        if !available_encoders.contains(encoder.id) {
            continue;
        }

        let help = run_ffmpeg_command(
            ffmpeg_path,
            &["-hide_banner", "-h", &format!("encoder={}", encoder.id)],
        )
        .await
        .unwrap_or_default();
        let supported_pixel_formats = parse_supported_pixel_formats(&help);
        let supported_profiles = parse_option_enum_values(&help, "profile");
        let supported_levels = parse_option_enum_values(&help, "level");
        let supports_crf = help_supports_flag(&help, "-crf");
        let supports_qp = help_supports_flag(&help, "-qp");
        let options = parse_encoder_options(&help);

        capabilities.push(TranscodeVideoEncoderCapability {
            id: encoder.id.to_string(),
            codec: encoder.codec.to_string(),
            label: encoder.label.to_string(),
            is_hardware: encoder.is_hardware,
            supported_pixel_formats: supported_pixel_formats.clone(),
            supported_profiles,
            supported_levels,
            supported_bit_depths: derive_bit_depths_from_pixel_formats(&supported_pixel_formats),
            supports_preset: help_supports_flag(&help, "-preset"),
            supports_crf,
            supports_qp,
            supports_bitrate: video_encoder_supports_bitrate(&help),
            options,
        });
    }

    capabilities
}

async fn build_audio_encoder_capabilities(
    ffmpeg_path: &str,
    available_encoders: &HashSet<String>,
) -> Vec<TranscodeAudioEncoderCapability> {
    let mut capabilities = Vec::new();

    for encoder in KNOWN_AUDIO_ENCODERS {
        if !available_encoders.contains(encoder.id) {
            continue;
        }

        let help = run_ffmpeg_command(
            ffmpeg_path,
            &["-hide_banner", "-h", &format!("encoder={}", encoder.id)],
        )
        .await
        .unwrap_or_default();
        let options = parse_encoder_options(&help);

        capabilities.push(TranscodeAudioEncoderCapability {
            id: encoder.id.to_string(),
            codec: encoder.codec.to_string(),
            label: encoder.label.to_string(),
            supports_bitrate: encoder.codec != "pcm_s16le",
            supports_channels: true,
            supports_sample_rate: true,
            options,
        });
    }

    capabilities
}

async fn build_subtitle_encoder_capabilities(
    ffmpeg_path: &str,
    available_encoders: &HashSet<String>,
) -> Vec<TranscodeSubtitleEncoderCapability> {
    let mut capabilities = Vec::new();

    for encoder in KNOWN_SUBTITLE_ENCODERS {
        if !available_encoders.contains(encoder.id) {
            continue;
        }

        let help = run_ffmpeg_command(
            ffmpeg_path,
            &["-hide_banner", "-h", &format!("encoder={}", encoder.id)],
        )
        .await
        .unwrap_or_default();
        let options = parse_encoder_options(&help);

        capabilities.push(TranscodeSubtitleEncoderCapability {
            id: encoder.id.to_string(),
            codec: encoder.codec.to_string(),
            label: encoder.label.to_string(),
            kind: encoder.kind.to_string(),
            options,
        });
    }

    capabilities
}

fn select_default_encoder_id<'a>(
    available_ids: &'a HashSet<String>,
    priorities: &[&str],
) -> Option<String> {
    priorities
        .iter()
        .find(|candidate| available_ids.contains(**candidate))
        .map(|candidate| (*candidate).to_string())
}

fn build_container_capabilities(
    available_muxers: &HashSet<String>,
    video_encoders: &[TranscodeVideoEncoderCapability],
    audio_encoders: &[TranscodeAudioEncoderCapability],
    subtitle_encoders: &[TranscodeSubtitleEncoderCapability],
) -> Vec<TranscodeContainerCapability> {
    let video_encoder_ids = video_encoders
        .iter()
        .map(|encoder| encoder.id.clone())
        .collect::<HashSet<_>>();
    let audio_encoder_ids = audio_encoders
        .iter()
        .map(|encoder| encoder.id.clone())
        .collect::<HashSet<_>>();
    let subtitle_encoder_ids = subtitle_encoders
        .iter()
        .map(|encoder| encoder.id.clone())
        .collect::<HashSet<_>>();

    KNOWN_CONTAINERS
        .iter()
        .filter(|container| available_muxers.contains(container.muxer_name))
        .map(|container| {
            let supported_video_encoder_ids = KNOWN_VIDEO_ENCODERS
                .iter()
                .filter(|encoder| {
                    encoder.supported_container_ids.contains(&container.id)
                        && video_encoder_ids.contains(encoder.id)
                })
                .map(|encoder| encoder.id.to_string())
                .collect::<Vec<_>>();
            let supported_audio_encoder_ids = KNOWN_AUDIO_ENCODERS
                .iter()
                .filter(|encoder| {
                    encoder.supported_container_ids.contains(&container.id)
                        && audio_encoder_ids.contains(encoder.id)
                })
                .map(|encoder| encoder.id.to_string())
                .collect::<Vec<_>>();
            let supported_subtitle_encoder_ids = KNOWN_SUBTITLE_ENCODERS
                .iter()
                .filter(|encoder| {
                    encoder.supported_container_ids.contains(&container.id)
                        && subtitle_encoder_ids.contains(encoder.id)
                })
                .map(|encoder| encoder.id.to_string())
                .collect::<Vec<_>>();

            let mut supported_subtitle_modes = vec!["disable".to_string()];
            if container.kind == "video" {
                supported_subtitle_modes.push("copy".to_string());
                if !supported_subtitle_encoder_ids.is_empty() {
                    supported_subtitle_modes.push("convert_text".to_string());
                }
            }

            TranscodeContainerCapability {
                id: container.id.to_string(),
                label: container.label.to_string(),
                extension: container.extension.to_string(),
                kind: container.kind.to_string(),
                muxer_name: container.muxer_name.to_string(),
                supported_video_encoder_ids: supported_video_encoder_ids.clone(),
                supported_audio_encoder_ids: supported_audio_encoder_ids.clone(),
                supported_subtitle_encoder_ids: supported_subtitle_encoder_ids.clone(),
                supported_subtitle_modes,
                default_video_encoder_id: select_default_encoder_id(
                    &supported_video_encoder_ids
                        .iter()
                        .cloned()
                        .collect::<HashSet<_>>(),
                    container.default_video_encoder_priority,
                ),
                default_audio_encoder_id: select_default_encoder_id(
                    &supported_audio_encoder_ids
                        .iter()
                        .cloned()
                        .collect::<HashSet<_>>(),
                    container.default_audio_encoder_priority,
                ),
                default_subtitle_encoder_id: select_default_encoder_id(
                    &supported_subtitle_encoder_ids
                        .iter()
                        .cloned()
                        .collect::<HashSet<_>>(),
                    container.default_subtitle_encoder_priority,
                ),
                metadata_schema: metadata_schema_for_container(container.id),
            }
        })
        .collect()
}

pub(crate) async fn get_transcode_capabilities_with_ffmpeg_path(
    ffmpeg_path: &str,
) -> Result<TranscodeCapabilities, String> {
    let version_output = run_ffmpeg_command(ffmpeg_path, &["-version"]).await?;
    let encoder_output = run_ffmpeg_command(ffmpeg_path, &["-hide_banner", "-encoders"]).await?;
    let muxer_output = run_ffmpeg_command(ffmpeg_path, &["-hide_banner", "-muxers"]).await?;
    let hwaccel_output = run_ffmpeg_command(ffmpeg_path, &["-hide_banner", "-hwaccels"])
        .await
        .unwrap_or_default();

    let available_encoders = parse_ffmpeg_encoder_names(&encoder_output);
    let available_muxers = parse_ffmpeg_muxer_names(&muxer_output);
    let hwaccels = parse_ffmpeg_hwaccel_names(&hwaccel_output);

    let video_encoders = build_video_encoder_capabilities(ffmpeg_path, &available_encoders).await;
    let audio_encoders = build_audio_encoder_capabilities(ffmpeg_path, &available_encoders).await;
    let subtitle_encoders =
        build_subtitle_encoder_capabilities(ffmpeg_path, &available_encoders).await;
    let containers = build_container_capabilities(
        &available_muxers,
        &video_encoders,
        &audio_encoders,
        &subtitle_encoders,
    );

    Ok(TranscodeCapabilities {
        ffmpeg_version: parse_ffmpeg_version(&version_output),
        hwaccels,
        containers,
        video_encoders,
        audio_encoders,
        subtitle_encoders,
        default_analysis_frame_count: DEFAULT_ANALYSIS_FRAME_COUNT,
    })
}

#[tauri::command]
pub(crate) async fn get_transcode_capabilities(
    app: tauri::AppHandle,
) -> Result<TranscodeCapabilities, String> {
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    get_transcode_capabilities_with_ffmpeg_path(&ffmpeg_path).await
}

#[cfg(test)]
mod tests {
    use super::{
        TranscodeAudioEncoderCapability, TranscodeEncoderOptionValueKind,
        TranscodeSubtitleEncoderCapability, TranscodeVideoEncoderCapability,
        build_container_capabilities, derive_bit_depths_from_pixel_formats, parse_encoder_options,
        parse_ffmpeg_encoder_names, parse_ffmpeg_hwaccel_names, parse_ffmpeg_muxer_names,
        parse_option_enum_values, parse_supported_pixel_formats, video_encoder_supports_bitrate,
    };
    use std::collections::HashSet;

    fn to_set(values: &[&str]) -> HashSet<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    fn video_encoder(id: &str, codec: &str) -> TranscodeVideoEncoderCapability {
        TranscodeVideoEncoderCapability {
            id: id.to_string(),
            codec: codec.to_string(),
            label: id.to_string(),
            is_hardware: false,
            supported_pixel_formats: vec!["yuv420p".to_string()],
            supported_profiles: vec![],
            supported_levels: vec![],
            supported_bit_depths: vec![8],
            supports_preset: false,
            supports_crf: false,
            supports_qp: false,
            supports_bitrate: true,
            options: vec![],
        }
    }

    fn audio_encoder(id: &str, codec: &str) -> TranscodeAudioEncoderCapability {
        TranscodeAudioEncoderCapability {
            id: id.to_string(),
            codec: codec.to_string(),
            label: id.to_string(),
            supports_bitrate: true,
            supports_channels: true,
            supports_sample_rate: true,
            options: vec![],
        }
    }

    #[test]
    fn parse_ffmpeg_encoder_names_extracts_encoder_ids() {
        let sample = r#"
 V....D hevc_videotoolbox    VideoToolbox H.265 Encoder
 V....D libx264              libx264 H.264
 A....D aac                  AAC
 "#;
        let parsed = parse_ffmpeg_encoder_names(sample);
        assert!(parsed.contains("hevc_videotoolbox"));
        assert!(parsed.contains("libx264"));
        assert!(parsed.contains("aac"));
    }

    #[test]
    fn parse_ffmpeg_muxer_names_extracts_primary_muxer_ids() {
        let sample = r#"
  E  matroska        Matroska
  E  mp4             MP4
  E  stream_segment,ssegment streaming segment muxer
 "#;
        let parsed = parse_ffmpeg_muxer_names(sample);
        assert!(parsed.contains("matroska"));
        assert!(parsed.contains("mp4"));
        assert!(parsed.contains("stream_segment"));
        assert!(!parsed.contains("ssegment"));
    }

    #[test]
    fn parse_ffmpeg_hwaccel_names_extracts_hwaccels() {
        let sample = "Hardware acceleration methods:\nvideotoolbox\nqsv\n";
        let parsed = parse_ffmpeg_hwaccel_names(sample);
        assert_eq!(parsed, vec!["videotoolbox".to_string(), "qsv".to_string()]);
    }

    #[test]
    fn parse_supported_pixel_formats_filters_opaque_hardware_formats() {
        let sample = "Supported pixel formats: videotoolbox_vld nv12 yuv420p p010le p416le";
        assert_eq!(
            parse_supported_pixel_formats(sample),
            vec![
                "nv12".to_string(),
                "yuv420p".to_string(),
                "p010le".to_string(),
                "p416le".to_string()
            ]
        );
    }

    #[test]
    fn parse_option_enum_values_extracts_profile_variants() {
        let sample = r#"
  -profile           <int>        E..V....... Profile
     main            1            E..V....... Main Profile
     main10          2            E..V....... Main10 Profile
  -allow_sw          <boolean>    E..V....... Allow software encoding
 "#;
        assert_eq!(
            parse_option_enum_values(sample, "profile"),
            vec!["main".to_string(), "main10".to_string()]
        );
    }

    fn find_option<'a>(
        options: &'a [super::TranscodeEncoderOption],
        flag: &str,
    ) -> &'a super::TranscodeEncoderOption {
        options
            .iter()
            .find(|option| option.flag == flag)
            .expect("encoder option should exist")
    }

    #[test]
    fn parse_encoder_options_extracts_libx264_metadata() {
        let sample = r#"
Encoder libx264 [libx264 H.264]:
libx264 AVOptions:
  -preset            <string>     E..V....... Set the encoding preset (default "medium")
  -crf               <float>      E..V....... Select the quality for constant quality mode (from -1 to FLT_MAX) (default -1)
  -aq-mode           <int>        E..V....... AQ method (from -1 to INT_MAX) (default -1)
     none            0            E..V.......
     variance        1            E..V....... Variance AQ
     autovariance-biased 3        E..V....... Auto-variance AQ with bias
"#;
        let options = parse_encoder_options(sample);

        let preset = find_option(&options, "-preset");
        assert_eq!(preset.value_kind, TranscodeEncoderOptionValueKind::String);
        assert_eq!(preset.default_value.as_deref(), Some("medium"));

        let crf = find_option(&options, "-crf");
        assert_eq!(crf.value_kind, TranscodeEncoderOptionValueKind::Float);
        assert_eq!(crf.min, Some(-1.0));
        assert_eq!(crf.max, None);
        assert_eq!(crf.default_value.as_deref(), Some("-1"));

        let aq_mode = find_option(&options, "-aq-mode");
        assert_eq!(aq_mode.choices.len(), 3);
        assert_eq!(aq_mode.choices[2].value, "autovariance-biased");
    }

    #[test]
    fn parse_encoder_options_extracts_libsvtav1_ranges_and_dictionary() {
        let sample = r#"
Encoder libsvtav1 [SVT-AV1]:
libsvtav1 AVOptions:
  -preset            <int>        E..V....... Encoding preset (from -2 to 13) (default -2)
  -crf               <int>        E..V....... Constant Rate Factor value (from 0 to 63) (default 0)
  -svtav1-params     <dictionary> E..V....... Set options using key=value pairs
"#;
        let options = parse_encoder_options(sample);

        let preset = find_option(&options, "-preset");
        assert_eq!(preset.value_kind, TranscodeEncoderOptionValueKind::Int);
        assert_eq!(preset.min, Some(-2.0));
        assert_eq!(preset.max, Some(13.0));

        let params = find_option(&options, "-svtav1-params");
        assert_eq!(
            params.value_kind,
            TranscodeEncoderOptionValueKind::Dictionary
        );
    }

    #[test]
    fn parse_encoder_options_extracts_libopus_choices_and_float_ranges() {
        let sample = r#"
Encoder libopus [libopus Opus]:
libopus AVOptions:
  -application       <int>        E...A...... Intended application type (from 2048 to 2051) (default audio)
     voip            2048         E...A...... Favor speech
     audio           2049         E...A...... Favor faithfulness
  -frame_duration    <float>      E...A...... Duration of a frame in milliseconds (from 2.5 to 120) (default 20)
  -fec               <boolean>    E...A...... Enable inband FEC (default false)
"#;
        let options = parse_encoder_options(sample);

        let application = find_option(&options, "-application");
        assert_eq!(application.default_value.as_deref(), Some("audio"));
        assert_eq!(application.choices[0].value, "voip");

        let frame_duration = find_option(&options, "-frame_duration");
        assert_eq!(frame_duration.min, Some(2.5));
        assert_eq!(frame_duration.max, Some(120.0));

        let fec = find_option(&options, "-fec");
        assert_eq!(fec.value_kind, TranscodeEncoderOptionValueKind::Boolean);
    }

    #[test]
    fn parse_encoder_options_extracts_videotoolbox_boolean_and_double() {
        let sample = r#"
Encoder hevc_videotoolbox [VideoToolbox H.265 Encoder]:
hevc_videotoolbox AVOptions:
  -profile           <int>        E..V....... Profile (from -99 to INT_MAX) (default -99)
     main            1            E..V....... Main Profile
  -alpha_quality     <double>     E..V....... Compression quality for the alpha channel (from 0 to 1) (default 0)
  -allow_sw          <boolean>    E..V....... Allow software encoding (default false)
"#;
        let options = parse_encoder_options(sample);

        let profile = find_option(&options, "-profile");
        assert_eq!(profile.min, Some(-99.0));
        assert_eq!(profile.max, None);
        assert_eq!(profile.choices[0].description, "Main Profile");

        let alpha_quality = find_option(&options, "-alpha_quality");
        assert_eq!(
            alpha_quality.value_kind,
            TranscodeEncoderOptionValueKind::Float
        );
        assert_eq!(alpha_quality.min, Some(0.0));
        assert_eq!(alpha_quality.max, Some(1.0));
        assert_eq!(
            alpha_quality.description,
            "Compression quality for the alpha channel"
        );

        let allow_sw = find_option(&options, "-allow_sw");
        assert_eq!(
            allow_sw.value_kind,
            TranscodeEncoderOptionValueKind::Boolean
        );
    }

    #[test]
    fn parse_encoder_options_returns_empty_without_avoptions() {
        let sample = r#"
Encoder srt [SubRip subtitle]:
    General capabilities: none

Exiting with exit code 0
"#;
        assert!(parse_encoder_options(sample).is_empty());
    }

    #[test]
    fn derive_bit_depths_from_pixel_formats_detects_ten_bit() {
        let pixel_formats = vec!["yuv420p".to_string(), "p010le".to_string()];
        assert_eq!(
            derive_bit_depths_from_pixel_formats(&pixel_formats),
            vec![8, 10]
        );
    }

    #[test]
    fn video_encoder_supports_bitrate_detects_crf_qp_based_rate_control() {
        let sample = r#"
  -crf               <float>      E..V....... Select the quality for constant quality mode
  -qp                <int>        E..V....... Constant quantization parameter rate control method
 "#;
        assert!(video_encoder_supports_bitrate(sample));
    }

    #[test]
    fn video_encoder_supports_bitrate_detects_constant_bit_rate_flag() {
        let sample = r#"
  -constant_bit_rate <boolean>    E..V....... Require constant bit rate
 "#;
        assert!(video_encoder_supports_bitrate(sample));
    }

    #[test]
    fn video_encoder_supports_bitrate_rejects_prores_ks_help() {
        let sample = r#"
ProRes encoder AVOptions:
  -profile           <int>        E..V....... (from -1 to 5) (default auto)
  -bits_per_mb       <int>        E..V....... desired bits per macroblock
 "#;
        assert!(!video_encoder_supports_bitrate(sample));
    }

    #[test]
    fn video_encoder_supports_bitrate_rejects_prores_videotoolbox_help() {
        let sample = r#"
prores_videotoolbox AVOptions:
  -profile           <int>        E..V....... Profile
  -allow_sw          <boolean>    E..V....... Allow software encoding
 "#;
        assert!(!video_encoder_supports_bitrate(sample));
    }

    #[test]
    fn build_container_capabilities_filters_by_muxers_and_encoder_support() {
        let muxers = to_set(&["mp4", "matroska"]);
        let video_encoders = vec![TranscodeVideoEncoderCapability {
            is_hardware: true,
            supported_pixel_formats: vec!["p010le".to_string()],
            supported_profiles: vec!["main10".to_string()],
            supported_bit_depths: vec![10],
            ..video_encoder("hevc_videotoolbox", "hevc")
        }];
        let audio_encoders = vec![audio_encoder("aac", "aac")];
        let subtitle_encoders = vec![TranscodeSubtitleEncoderCapability {
            id: "mov_text".to_string(),
            codec: "mov_text".to_string(),
            label: "mov_text".to_string(),
            kind: "text".to_string(),
            options: vec![],
        }];

        let containers = build_container_capabilities(
            &muxers,
            &video_encoders,
            &audio_encoders,
            &subtitle_encoders,
        );

        let mp4 = containers
            .iter()
            .find(|container| container.id == "mp4")
            .expect("mp4 capability should exist");
        assert_eq!(
            mp4.default_video_encoder_id.as_deref(),
            Some("hevc_videotoolbox")
        );
        assert!(
            mp4.supported_subtitle_modes
                .contains(&"convert_text".to_string())
        );

        let mkv = containers
            .iter()
            .find(|container| container.id == "mkv")
            .expect("mkv capability should exist");
        assert!(mkv.supported_audio_encoder_ids.contains(&"aac".to_string()));
    }

    #[test]
    fn build_container_capabilities_includes_webm_av1_vp8_and_libvorbis() {
        let muxers = to_set(&["webm"]);
        let video_encoders = vec![
            video_encoder("libsvtav1", "av1"),
            video_encoder("libaom-av1", "av1"),
            video_encoder("libvpx", "vp8"),
            video_encoder("libvpx-vp9", "vp9"),
            video_encoder("prores_ks", "prores"),
        ];
        let audio_encoders = vec![
            audio_encoder("libopus", "opus"),
            audio_encoder("libvorbis", "vorbis"),
            audio_encoder("aac", "aac"),
        ];

        let containers =
            build_container_capabilities(&muxers, &video_encoders, &audio_encoders, &[]);
        let webm = containers
            .iter()
            .find(|container| container.id == "webm")
            .expect("webm capability should exist");

        assert!(
            webm.supported_video_encoder_ids
                .contains(&"libsvtav1".to_string())
        );
        assert!(
            webm.supported_video_encoder_ids
                .contains(&"libaom-av1".to_string())
        );
        assert!(
            webm.supported_video_encoder_ids
                .contains(&"libvpx".to_string())
        );
        assert!(
            webm.supported_video_encoder_ids
                .contains(&"libvpx-vp9".to_string())
        );
        assert!(
            !webm
                .supported_video_encoder_ids
                .contains(&"prores_ks".to_string())
        );
        assert!(
            webm.supported_audio_encoder_ids
                .contains(&"libvorbis".to_string())
        );
        assert!(
            !webm
                .supported_audio_encoder_ids
                .contains(&"aac".to_string())
        );
    }

    #[test]
    fn build_container_capabilities_prefers_delivery_codecs_for_mov_defaults() {
        let muxers = to_set(&["mov"]);
        let video_encoders = vec![
            TranscodeVideoEncoderCapability {
                id: "prores_videotoolbox".to_string(),
                codec: "prores".to_string(),
                label: "ProRes VT".to_string(),
                is_hardware: true,
                supported_pixel_formats: vec!["p010le".to_string()],
                supported_profiles: vec!["hq".to_string()],
                supported_levels: vec![],
                supported_bit_depths: vec![10],
                supports_preset: false,
                supports_crf: false,
                supports_qp: false,
                supports_bitrate: false,
                options: vec![],
            },
            TranscodeVideoEncoderCapability {
                id: "prores_ks".to_string(),
                codec: "prores".to_string(),
                label: "ProRes KS".to_string(),
                is_hardware: false,
                supported_pixel_formats: vec!["yuv422p10le".to_string()],
                supported_profiles: vec!["hq".to_string()],
                supported_levels: vec![],
                supported_bit_depths: vec![10],
                supports_preset: false,
                supports_crf: false,
                supports_qp: false,
                supports_bitrate: false,
                options: vec![],
            },
            TranscodeVideoEncoderCapability {
                id: "hevc_videotoolbox".to_string(),
                codec: "hevc".to_string(),
                label: "HEVC".to_string(),
                is_hardware: true,
                supported_pixel_formats: vec!["p010le".to_string()],
                supported_profiles: vec!["main10".to_string()],
                supported_levels: vec![],
                supported_bit_depths: vec![10],
                supports_preset: false,
                supports_crf: false,
                supports_qp: false,
                supports_bitrate: true,
                options: vec![],
            },
            TranscodeVideoEncoderCapability {
                id: "h264_videotoolbox".to_string(),
                codec: "h264".to_string(),
                label: "H.264".to_string(),
                is_hardware: true,
                supported_pixel_formats: vec!["yuv420p".to_string()],
                supported_profiles: vec!["high".to_string()],
                supported_levels: vec!["4.1".to_string()],
                supported_bit_depths: vec![8],
                supports_preset: false,
                supports_crf: false,
                supports_qp: false,
                supports_bitrate: true,
                options: vec![],
            },
        ];

        let containers = build_container_capabilities(&muxers, &video_encoders, &[], &[]);
        let mov = containers
            .iter()
            .find(|container| container.id == "mov")
            .expect("mov capability should exist");

        assert_eq!(
            mov.default_video_encoder_id.as_deref(),
            Some("hevc_videotoolbox")
        );
    }
}
