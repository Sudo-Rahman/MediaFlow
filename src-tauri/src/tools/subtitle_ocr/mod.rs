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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SubtitleOcrPlacement {
    Top,
    Bottom,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) placement: Option<SubtitleOcrPlacement>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) placement_source_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) top_placement_source_count: Option<u32>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) placement: Option<SubtitleOcrPlacement>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) placement_source_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) top_placement_source_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleOcrLiveCueEvent {
    pub(crate) item_id: String,
    pub(crate) run_id: String,
    pub(crate) bitmap: SubtitleOcrDecodedCue,
    pub(crate) raw_cue: SubtitleOcrRawCue,
    pub(crate) provisional_cue: SubtitleOcrCue,
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
    use super::{
        SubtitleOcrBox, SubtitleOcrCue, SubtitleOcrDecodedCue, SubtitleOcrLiveCueEvent,
        SubtitleOcrPlacement, SubtitleOcrRawCue,
    };

    #[test]
    fn decoded_cue_serializes_optional_preview_path() {
        let cue = SubtitleOcrDecodedCue {
            cue_id: "cue-1".to_string(),
            start_time_ms: 1_000,
            end_time_ms: 2_000,
            width: 1920,
            height: 1080,
            cache_key: "cache-key".to_string(),
            preview_path: Some("/tmp/MediaFlow/subtitle-ocr/preview.png".to_string()),
        };

        let value = serde_json::to_value(cue).expect("decoded cue should serialize");

        assert_eq!(
            value.get("previewPath").and_then(serde_json::Value::as_str),
            Some("/tmp/MediaFlow/subtitle-ocr/preview.png")
        );
    }

    #[test]
    fn decoded_cue_omits_missing_preview_path() {
        let cue = SubtitleOcrDecodedCue {
            cue_id: "cue-1".to_string(),
            start_time_ms: 1_000,
            end_time_ms: 2_000,
            width: 1920,
            height: 1080,
            cache_key: "cache-key".to_string(),
            preview_path: None,
        };

        let value = serde_json::to_value(cue).expect("decoded cue should serialize");

        assert!(value.get("previewPath").is_none());
    }

    #[test]
    fn live_cue_event_serializes_frontend_contract() {
        let event = SubtitleOcrLiveCueEvent {
            item_id: "item-1".to_string(),
            run_id: "run-1".to_string(),
            bitmap: SubtitleOcrDecodedCue {
                cue_id: "cue-1".to_string(),
                start_time_ms: 1_000,
                end_time_ms: 2_000,
                width: 1920,
                height: 1080,
                cache_key: "cache-key".to_string(),
                preview_path: Some("/tmp/preview.png".to_string()),
            },
            raw_cue: SubtitleOcrRawCue {
                cue_id: "cue-1".to_string(),
                start_time_ms: 1_000,
                end_time_ms: 2_000,
                cache_key: "cache-key".to_string(),
                boxes: vec![SubtitleOcrBox {
                    text: "Hello".to_string(),
                    confidence: 0.9,
                    x: 0.1,
                    y: 0.2,
                    width: 0.3,
                    height: 0.4,
                }],
                text: "Hello".to_string(),
                confidence: 0.9,
                placement: Some(SubtitleOcrPlacement::Top),
                placement_source_count: Some(1),
                top_placement_source_count: Some(1),
            },
            provisional_cue: SubtitleOcrCue {
                id: "cue-1".to_string(),
                source_cue_ids: vec!["cue-1".to_string()],
                start_time_ms: 1_000,
                end_time_ms: 2_000,
                text: "Hello".to_string(),
                confidence: 0.9,
                placement: Some(SubtitleOcrPlacement::Top),
                placement_source_count: Some(1),
                top_placement_source_count: Some(1),
            },
        };

        let value = serde_json::to_value(event).expect("live cue event should serialize");

        assert_eq!(value["itemId"], "item-1");
        assert_eq!(value["runId"], "run-1");
        assert_eq!(value["bitmap"]["previewPath"], "/tmp/preview.png");
        assert_eq!(value["rawCue"]["boxes"][0]["text"], "Hello");
        assert_eq!(value["rawCue"]["placement"], "top");
        assert_eq!(value["rawCue"]["placementSourceCount"], 1);
        assert_eq!(value["rawCue"]["topPlacementSourceCount"], 1);
        assert_eq!(value["provisionalCue"]["placement"], "top");
        assert_eq!(value["provisionalCue"]["placementSourceCount"], 1);
        assert_eq!(value["provisionalCue"]["topPlacementSourceCount"], 1);
        assert_eq!(value["provisionalCue"]["sourceCueIds"][0], "cue-1");
    }
}
