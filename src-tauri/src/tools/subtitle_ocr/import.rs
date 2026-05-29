use serde_json::Value;

use crate::shared::store::resolve_ffprobe_path;
use crate::shared::validation::validate_media_path;
use crate::tools::ffprobe::probe::probe_file_with_ffprobe;
use crate::tools::subtitle_ocr::SubtitleOcrTrackInfo;

#[tauri::command]
pub(crate) async fn probe_subtitle_ocr_tracks(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<SubtitleOcrTrackInfo>, String> {
    validate_media_path(&path)?;
    let ffprobe_path = resolve_ffprobe_path(&app)?;
    let probe_json = probe_file_with_ffprobe(&ffprobe_path, &path).await?;
    parse_tracks_from_probe_json(&probe_json)
}

pub(super) fn codec_label(codec: &str) -> Option<&'static str> {
    match codec.to_ascii_lowercase().as_str() {
        "hdmv_pgs_subtitle" | "pgs" => Some("PGS"),
        _ => None,
    }
}

pub(super) fn parse_tracks_from_probe_json(
    probe_json: &str,
) -> Result<Vec<SubtitleOcrTrackInfo>, String> {
    let value: Value = serde_json::from_str(probe_json)
        .map_err(|e| format!("Failed to parse ffprobe subtitle metadata: {}", e))?;
    let streams = value
        .get("streams")
        .and_then(Value::as_array)
        .ok_or_else(|| "FFprobe output did not contain streams".to_string())?;

    let tracks = streams
        .iter()
        .filter_map(parse_track_from_stream)
        .collect::<Vec<_>>();

    Ok(tracks)
}

fn parse_track_from_stream(stream: &Value) -> Option<SubtitleOcrTrackInfo> {
    if stream.get("codec_type").and_then(Value::as_str) != Some("subtitle") {
        return None;
    }

    let codec = stream.get("codec_name").and_then(Value::as_str)?;
    let codec_label = codec_label(codec)?;
    let stream_index = stream
        .get("index")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())?;

    Some(SubtitleOcrTrackInfo {
        stream_index,
        codec: codec.to_string(),
        codec_label: codec_label.to_string(),
        language: tag_value(stream, "language"),
        title: tag_value(stream, "title"),
        forced: disposition_flag(stream, "forced"),
        r#default: disposition_flag(stream, "default"),
    })
}

fn tag_value(stream: &Value, key: &str) -> Option<String> {
    stream
        .get("tags")
        .and_then(Value::as_object)
        .and_then(|tags| {
            tags.iter().find_map(|(tag_key, value)| {
                tag_key
                    .eq_ignore_ascii_case(key)
                    .then(|| value.as_str().map(str::trim))
                    .flatten()
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
            })
        })
}

fn disposition_flag(stream: &Value, key: &str) -> bool {
    stream
        .get("disposition")
        .and_then(|disposition| disposition.get(key))
        .is_some_and(ffprobe_flag_is_enabled)
}

fn ffprobe_flag_is_enabled(value: &Value) -> bool {
    value.as_bool().unwrap_or_else(|| {
        value
            .as_i64()
            .map(|flag| flag != 0)
            .or_else(|| {
                value
                    .as_str()
                    .map(|flag| flag == "1" || flag.eq_ignore_ascii_case("true"))
            })
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::{codec_label, parse_tracks_from_probe_json};

    #[test]
    fn codec_label_accepts_bitmap_subtitle_codecs() {
        assert_eq!(codec_label("hdmv_pgs_subtitle"), Some("PGS"));
        assert_eq!(codec_label("pgs"), Some("PGS"));
    }

    #[test]
    fn codec_label_rejects_unsupported_container_subtitle_codecs() {
        assert_eq!(codec_label("subrip"), None);
        assert_eq!(codec_label("ass"), None);
        assert_eq!(codec_label("dvd_subtitle"), None);
    }

    #[test]
    fn parse_tracks_from_probe_json_filters_supported_bitmap_subtitle_streams() {
        let json = r#"{
            "streams": [
                { "index": 0, "codec_type": "video", "codec_name": "h264" },
                {
                    "index": 2,
                    "codec_type": "subtitle",
                    "codec_name": "hdmv_pgs_subtitle",
                    "tags": { "language": "eng", "title": "Signs" },
                    "disposition": { "forced": 1, "default": 0 }
                },
                {
                    "index": 3,
                    "codec_type": "subtitle",
                    "codec_name": "subrip",
                    "tags": { "language": "eng" }
                },
                {
                    "index": 4,
                    "codec_type": "subtitle",
                    "codec_name": "dvd_subtitle",
                    "tags": { "LANGUAGE": "jpn", "TITLE": "Main" },
                    "disposition": { "forced": "false", "default": "true" }
                }
            ]
        }"#;

        let tracks = parse_tracks_from_probe_json(json).expect("tracks should parse");

        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].stream_index, 2);
        assert_eq!(tracks[0].codec_label, "PGS");
        assert_eq!(tracks[0].language.as_deref(), Some("eng"));
        assert_eq!(tracks[0].title.as_deref(), Some("Signs"));
        assert!(tracks[0].forced);
        assert!(!tracks[0].r#default);
    }
}
