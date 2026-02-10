pub(crate) mod cancel;
mod engine;
pub(crate) mod export;
pub(crate) mod frames;
pub(crate) mod models;
pub(crate) mod perform;
pub(crate) mod preview;
mod state;
pub(crate) mod subtitles;

use serde::{Deserialize, Serialize};

/// OCR model paths configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrModelPaths {
    pub models_dir: String,
}

/// OCR region for cropping frames
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OcrRegion {
    pub(crate) x: f64, // 0-1 relative position
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

/// OCR frame result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OcrFrameResult {
    pub(crate) frame_index: u32,
    pub(crate) time_ms: u64,
    pub(crate) text: String,
    pub(crate) confidence: f64,
}

/// OCR subtitle entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OcrSubtitleEntry {
    pub(crate) id: String,
    pub(crate) text: String,
    pub(crate) start_time: u64, // ms
    pub(crate) end_time: u64,   // ms
    pub(crate) confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrSubtitleCleanupOptions {
    pub(crate) merge_similar: bool,
    pub(crate) similarity_threshold: f64,
    pub(crate) max_gap_ms: u32,
    pub(crate) min_cue_duration_ms: u32,
    pub(crate) filter_url_like: bool,
}

/// OCR models status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OcrModelsStatus {
    pub(crate) installed: bool,
    pub(crate) models_dir: Option<String>,
    pub(crate) available_languages: Vec<String>,
    pub(crate) missing_models: Vec<String>,
    pub(crate) download_instructions: String,
}
