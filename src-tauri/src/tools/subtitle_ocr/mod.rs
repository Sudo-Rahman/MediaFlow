pub(crate) mod cancel;
pub(crate) mod decode;
pub(crate) mod export;
pub(crate) mod extract;
pub(crate) mod import;
pub(crate) mod ocr;
pub(crate) mod progress;
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
