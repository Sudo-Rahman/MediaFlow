pub(crate) mod assets;
pub(crate) mod cancel;
pub(crate) mod decode;
pub(crate) mod export;
pub(crate) mod extract;
pub(crate) mod import;
pub(crate) mod ocr;
pub(crate) mod progress;
pub(crate) mod restore;
pub(crate) mod stabilize;
pub(crate) mod state;
pub(crate) mod text;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleOcrTrackInfo {
    pub(crate) stream_index: u32,
    pub(crate) codec: String,
    pub(crate) codec_label: String,
    pub(crate) language: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) forced: bool,
    #[serde(rename = "default")]
    pub(crate) r#default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct SubtitleOcrBox {
    pub(crate) text: String,
    pub(crate) confidence: f64,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleOcrCue {
    pub(crate) id: String,
    pub(crate) source_cue_ids: Vec<String>,
    pub(crate) start_time_ms: u64,
    pub(crate) end_time_ms: u64,
    pub(crate) text: String,
    pub(crate) confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleOcrDecodedCue {
    pub(crate) cue_id: String,
    pub(crate) start_time_ms: u64,
    pub(crate) end_time_ms: u64,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) cache_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) thumbnail_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) preview_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleOcrRawCue {
    pub(crate) cue_id: String,
    pub(crate) start_time_ms: u64,
    pub(crate) end_time_ms: u64,
    pub(crate) cache_key: String,
    pub(crate) boxes: Vec<SubtitleOcrBox>,
    pub(crate) text: String,
    pub(crate) confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleOcrPipelineResult {
    pub(crate) decoded_cues: Vec<SubtitleOcrDecodedCue>,
    pub(crate) raw_ocr_cues: Vec<SubtitleOcrRawCue>,
    pub(crate) stabilized_cues: Vec<SubtitleOcrCue>,
    pub(crate) final_cues: Vec<SubtitleOcrCue>,
}

#[cfg(test)]
mod tests {
    use super::SubtitleOcrDecodedCue;

    #[test]
    fn decoded_cue_serializes_optional_thumbnail_path() {
        let cue = SubtitleOcrDecodedCue {
            cue_id: "cue-1".to_string(),
            start_time_ms: 1_000,
            end_time_ms: 2_000,
            width: 1920,
            height: 1080,
            cache_key: "cache-key".to_string(),
            thumbnail_path: Some("/tmp/MediaFlow/subtitle-ocr/thumb.png".to_string()),
            preview_path: Some("/tmp/MediaFlow/subtitle-ocr/preview.png".to_string()),
        };

        let value = serde_json::to_value(cue).expect("decoded cue should serialize");

        assert_eq!(
            value
                .get("thumbnailPath")
                .and_then(serde_json::Value::as_str),
            Some("/tmp/MediaFlow/subtitle-ocr/thumb.png")
        );
        assert_eq!(
            value.get("previewPath").and_then(serde_json::Value::as_str),
            Some("/tmp/MediaFlow/subtitle-ocr/preview.png")
        );
    }

    #[test]
    fn decoded_cue_omits_missing_thumbnail_path() {
        let cue = SubtitleOcrDecodedCue {
            cue_id: "cue-1".to_string(),
            start_time_ms: 1_000,
            end_time_ms: 2_000,
            width: 1920,
            height: 1080,
            cache_key: "cache-key".to_string(),
            thumbnail_path: None,
            preview_path: None,
        };

        let value = serde_json::to_value(cue).expect("decoded cue should serialize");

        assert!(value.get("thumbnailPath").is_none());
        assert!(value.get("previewPath").is_none());
    }
}
