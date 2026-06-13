use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::shared::store::resolve_ffprobe_path;
use crate::shared::validation::validate_media_path;
use crate::tools::ffprobe::parse_duration_us_from_probe_json;
use crate::tools::ffprobe::probe::probe_file_with_ffprobe;
use crate::tools::subtitle_ocr::SubtitleOcrTrackInfo;

const VOBSUB_CONTAINER_EXTRACTION_UNSUPPORTED: &str = "Container VobSub extraction is not supported by the bundled FFmpeg path. Import the .idx/.sub pair directly.";

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleOcrVobSubPairInfo {
    pub(crate) idx_path: String,
    pub(crate) sub_path: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleOcrMediaInfo {
    pub(crate) tracks: Vec<SubtitleOcrTrackInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) duration_seconds: Option<f64>,
}

#[tauri::command]
pub(crate) async fn probe_subtitle_ocr_tracks(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<SubtitleOcrTrackInfo>, String> {
    validate_media_path(&path)?;
    let ffprobe_path = resolve_ffprobe_path(&app)?;
    Ok(probe_subtitle_ocr_media_with_ffprobe(&ffprobe_path, &path)
        .await?
        .tracks)
}

#[tauri::command]
pub(crate) async fn probe_subtitle_ocr_media(
    app: tauri::AppHandle,
    path: String,
) -> Result<SubtitleOcrMediaInfo, String> {
    validate_media_path(&path)?;
    let ffprobe_path = resolve_ffprobe_path(&app)?;
    probe_subtitle_ocr_media_with_ffprobe(&ffprobe_path, &path).await
}

async fn probe_subtitle_ocr_media_with_ffprobe(
    ffprobe_path: &str,
    path: &str,
) -> Result<SubtitleOcrMediaInfo, String> {
    let probe_json = probe_file_with_ffprobe(ffprobe_path, path).await?;
    parse_subtitle_ocr_media_from_probe_json(&probe_json)
}

fn parse_subtitle_ocr_media_from_probe_json(
    probe_json: &str,
) -> Result<SubtitleOcrMediaInfo, String> {
    let tracks = parse_tracks_from_probe_json(probe_json)?;
    let duration_seconds = parse_duration_us_from_probe_json(probe_json)
        .ok()
        .flatten()
        .map(|duration_us| duration_us as f64 / 1_000_000.0);

    Ok(SubtitleOcrMediaInfo {
        tracks,
        duration_seconds,
    })
}

#[tauri::command]
pub(crate) async fn resolve_subtitle_ocr_vobsub_pair(
    path: String,
) -> Result<SubtitleOcrVobSubPairInfo, String> {
    resolve_vobsub_pair(&path)
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
    if tracks.is_empty() && streams.iter().any(stream_is_container_vobsub) {
        return Err(VOBSUB_CONTAINER_EXTRACTION_UNSUPPORTED.to_string());
    }

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

fn stream_is_container_vobsub(stream: &Value) -> bool {
    stream.get("codec_type").and_then(Value::as_str) == Some("subtitle")
        && stream
            .get("codec_name")
            .and_then(Value::as_str)
            .is_some_and(|codec| codec.eq_ignore_ascii_case("dvd_subtitle"))
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

fn resolve_vobsub_pair(path: &str) -> Result<SubtitleOcrVobSubPairInfo, String> {
    let path = Path::new(path);
    let extension = lower_extension(path).ok_or_else(|| {
        "Expected .idx or .sub Subtitle OCR source, got path without extension".to_string()
    })?;

    match extension.as_str() {
        "idx" => {
            validate_existing_vobsub_part(path, "idx")?;
            let sub_path = sibling_with_extension(path, "sub");
            validate_existing_vobsub_sidecar(&sub_path, "sub")?;
            Ok(SubtitleOcrVobSubPairInfo {
                idx_path: path.to_string_lossy().to_string(),
                sub_path: sub_path.to_string_lossy().to_string(),
            })
        }
        "sub" => {
            validate_existing_vobsub_part(path, "sub")?;
            let idx_path = sibling_with_extension(path, "idx");
            validate_existing_vobsub_sidecar(&idx_path, "idx")?;
            Ok(SubtitleOcrVobSubPairInfo {
                idx_path: idx_path.to_string_lossy().to_string(),
                sub_path: path.to_string_lossy().to_string(),
            })
        }
        ext => Err(format!(
            "Expected .idx or .sub Subtitle OCR source, got .{}",
            ext
        )),
    }
}

fn validate_existing_vobsub_part(path: &Path, extension: &str) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("Not a file: {}", path.display()));
    }
    match lower_extension(path).as_deref() {
        Some(ext) if ext == extension => Ok(()),
        Some(ext) => Err(format!(
            "Expected .{} Subtitle OCR source, got .{}",
            extension, ext
        )),
        None => Err(format!(
            "Expected .{} Subtitle OCR source, got path without extension",
            extension
        )),
    }
}

fn validate_existing_vobsub_sidecar(path: &Path, extension: &str) -> Result<(), String> {
    if !path.exists() {
        return Err(format!(
            "VobSub .{} sidecar not found: {}",
            extension,
            path.display()
        ));
    }
    validate_existing_vobsub_part(path, extension)
}

fn lower_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
}

fn sibling_with_extension(path: &Path, extension: &str) -> PathBuf {
    let direct = path.with_extension(extension);
    find_sibling_with_extension(path, extension).unwrap_or(direct)
}

fn find_sibling_with_extension(path: &Path, extension: &str) -> Option<PathBuf> {
    let parent = path.parent()?;
    let stem = path.file_stem()?.to_string_lossy();

    for entry in std::fs::read_dir(parent).ok()?.flatten() {
        let candidate = entry.path();
        let Some(candidate_stem) = candidate.file_stem() else {
            continue;
        };
        let Some(candidate_extension) = candidate.extension() else {
            continue;
        };
        let candidate_stem = candidate_stem.to_string_lossy();
        let candidate_extension = candidate_extension.to_string_lossy();
        if candidate_stem.eq_ignore_ascii_case(&stem)
            && candidate_extension.eq_ignore_ascii_case(extension)
        {
            return Some(candidate);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{
        codec_label, parse_subtitle_ocr_media_from_probe_json, parse_tracks_from_probe_json,
        resolve_vobsub_pair,
    };

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
            "format": { "duration": "7200.500" },
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

    #[test]
    fn parse_subtitle_ocr_media_from_probe_json_combines_tracks_and_duration() {
        let json = r#"{
            "format": { "duration": "12.250" },
            "streams": [
                {
                    "index": 2,
                    "codec_type": "subtitle",
                    "codec_name": "hdmv_pgs_subtitle",
                    "tags": { "language": "eng" },
                    "disposition": { "forced": 0, "default": 1 }
                }
            ]
        }"#;

        let media = parse_subtitle_ocr_media_from_probe_json(json)
            .expect("subtitle OCR media should parse");

        assert_eq!(media.tracks.len(), 1);
        assert_eq!(media.tracks[0].stream_index, 2);
        assert_eq!(media.duration_seconds, Some(12.25));
    }

    #[test]
    fn parse_tracks_from_probe_json_reports_container_vobsub_as_unsupported() {
        let json = r#"{
            "streams": [
                { "index": 0, "codec_type": "video", "codec_name": "h264" },
                {
                    "index": 3,
                    "codec_type": "subtitle",
                    "codec_name": "dvd_subtitle",
                    "tags": { "language": "eng" }
                }
            ]
        }"#;

        let error = parse_tracks_from_probe_json(json)
            .expect_err("container VobSub should get an actionable unsupported message");

        assert!(error.contains("Container VobSub extraction is not supported"));
    }

    #[test]
    fn resolve_vobsub_pair_accepts_selected_sub_with_sibling_idx() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let idx = dir.path().join("Movie.idx");
        let sub = dir.path().join("Movie.sub");
        std::fs::write(&idx, b"# VobSub index file").expect("failed to write idx");
        std::fs::write(&sub, b"sub").expect("failed to write sub");

        let pair = resolve_vobsub_pair(sub.to_string_lossy().as_ref())
            .expect("selected .sub should resolve sibling .idx");

        assert_eq!(pair.idx_path, idx.to_string_lossy());
        assert_eq!(pair.sub_path, sub.to_string_lossy());
    }

    #[test]
    fn resolve_vobsub_pair_accepts_selected_idx_with_sibling_sub() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let idx = dir.path().join("Movie.idx");
        let sub = dir.path().join("Movie.sub");
        std::fs::write(&idx, b"# VobSub index file").expect("failed to write idx");
        std::fs::write(&sub, b"sub").expect("failed to write sub");

        let pair = resolve_vobsub_pair(idx.to_string_lossy().as_ref())
            .expect("selected .idx should resolve sibling .sub");

        assert_eq!(pair.idx_path, idx.to_string_lossy());
        assert_eq!(pair.sub_path, sub.to_string_lossy());
    }

    #[test]
    fn resolve_vobsub_pair_accepts_uppercase_sidecar_extensions() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let idx = dir.path().join("Movie.IDX");
        let sub = dir.path().join("Movie.SUB");
        std::fs::write(&idx, b"# VobSub index file").expect("failed to write idx");
        std::fs::write(&sub, b"sub").expect("failed to write sub");

        let pair = resolve_vobsub_pair(idx.to_string_lossy().as_ref())
            .expect("selected uppercase .idx should resolve uppercase .sub");

        assert_eq!(pair.idx_path, idx.to_string_lossy());
        assert_eq!(pair.sub_path, sub.to_string_lossy());
    }

    #[test]
    fn resolve_vobsub_pair_rejects_missing_sibling() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let sub = dir.path().join("Movie.sub");
        std::fs::write(&sub, b"sub").expect("failed to write sub");

        let error = resolve_vobsub_pair(sub.to_string_lossy().as_ref())
            .expect_err("missing idx should fail");

        assert!(error.contains("VobSub .idx sidecar not found"));
    }

    #[test]
    fn resolve_vobsub_pair_rejects_non_vobsub_extension() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let txt = dir.path().join("Movie.txt");
        std::fs::write(&txt, b"text").expect("failed to write txt");

        let error = resolve_vobsub_pair(txt.to_string_lossy().as_ref())
            .expect_err("unsupported extension should fail");

        assert!(error.contains("Expected .idx or .sub Subtitle OCR source"));
    }
}
