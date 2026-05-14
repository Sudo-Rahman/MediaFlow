pub(crate) mod cancel;
mod engine;
pub(crate) mod export;
pub(crate) mod models;
pub(crate) mod pipeline;
pub(crate) mod preview;
mod progress;
mod state;
pub(crate) mod subtitles;

use serde::{Deserialize, Serialize};

/// OCR model paths configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrModelPaths {
    pub models_dir: String,
}

/// OCR region for cropping frames
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct OcrRegion {
    pub(crate) x: f64, // 0-1 relative position
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum OcrZoneRole {
    MainSubtitle,
    OnScreenText,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct OcrZone {
    pub(crate) id: String,
    pub(crate) region: OcrRegion,
    pub(crate) role: OcrZoneRole,
    pub(crate) label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct OcrSegment {
    pub(crate) id: String,
    pub(crate) start_time_ms: u64,
    pub(crate) end_time_ms: u64,
    pub(crate) zones: Vec<OcrZone>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct OcrSelection {
    pub(crate) segments: Vec<OcrSegment>,
}

/// OCR frame result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OcrFrameResult {
    pub(crate) frame_index: u32,
    pub(crate) time_ms: u64,
    pub(crate) text: String,
    pub(crate) confidence: f64,
    #[serde(
        default,
        rename = "segmentId",
        alias = "segment_id",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) segment_id: Option<String>,
    #[serde(
        default,
        rename = "zoneId",
        alias = "zone_id",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) zone_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) role: Option<OcrZoneRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) region: Option<OcrRegion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrPipelineTimings {
    pub(crate) extract_ms: u64,
    pub(crate) ocr_ms: u64,
    pub(crate) subtitle_ms: u64,
    pub(crate) total_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrPipelineTelemetry {
    pub(crate) extracted_frames: u32,
    pub(crate) ocr_attempted_frames: u32,
    pub(crate) text_frames: u32,
    pub(crate) unchanged_skipped_frames: u32,
    pub(crate) no_text_skipped_frames: u32,
    pub(crate) effective_workers: u32,
    pub(crate) engine_threads: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrPipelineResult {
    pub(crate) raw_ocr: Vec<OcrFrameResult>,
    pub(crate) subtitles: Vec<OcrSubtitleEntry>,
    pub(crate) frame_count: u32,
    pub(crate) timings: OcrPipelineTimings,
    pub(crate) telemetry: OcrPipelineTelemetry,
}

/// OCR subtitle entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OcrSubtitleEntry {
    pub(crate) id: String,
    pub(crate) text: String,
    pub(crate) start_time: u64, // ms
    pub(crate) end_time: u64,   // ms
    pub(crate) confidence: f64,
    #[serde(
        default,
        rename = "segmentId",
        alias = "segment_id",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) segment_id: Option<String>,
    #[serde(
        default,
        rename = "zoneId",
        alias = "zone_id",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) zone_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) role: Option<OcrZoneRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) region: Option<OcrRegion>,
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

#[cfg(test)]
mod selection_validation_tests {
    use super::{
        OcrRegion, OcrSegment, OcrSelection, OcrZone, OcrZoneRole, validate_ocr_selection,
    };

    #[test]
    fn selection_validation_rejects_bad_segment_bounds() {
        let selection = OcrSelection {
            segments: vec![OcrSegment {
                id: "bad".to_string(),
                start_time_ms: 5000,
                end_time_ms: 1000,
                zones: vec![valid_zone()],
            }],
        };

        let error = validate_ocr_selection(&selection, 10_000).expect_err("selection should fail");
        assert!(error.contains("Segment bad must start before it ends"));
    }

    #[test]
    fn selection_validation_allows_overlapping_segments() {
        let selection = OcrSelection {
            segments: vec![
                OcrSegment {
                    id: "a".to_string(),
                    start_time_ms: 0,
                    end_time_ms: 5000,
                    zones: vec![valid_zone()],
                },
                OcrSegment {
                    id: "b".to_string(),
                    start_time_ms: 1000,
                    end_time_ms: 3000,
                    zones: vec![OcrZone {
                        id: "zone-b".to_string(),
                        role: OcrZoneRole::OnScreenText,
                        region: OcrRegion {
                            x: 0.2,
                            y: 0.2,
                            width: 0.2,
                            height: 0.2,
                        },
                        label: None,
                    }],
                },
            ],
        };

        validate_ocr_selection(&selection, 10_000).expect("overlap should be allowed");
    }

    #[test]
    fn selection_validation_rejects_empty_segments_and_zones() {
        let empty_selection = OcrSelection {
            segments: Vec::new(),
        };
        let empty_error = validate_ocr_selection(&empty_selection, 10_000)
            .expect_err("empty selection should fail");
        assert!(empty_error.contains("OCR selection must contain at least one segment"));

        let selection = OcrSelection {
            segments: vec![OcrSegment {
                id: "empty-zones".to_string(),
                start_time_ms: 0,
                end_time_ms: 1000,
                zones: Vec::new(),
            }],
        };
        let error =
            validate_ocr_selection(&selection, 10_000).expect_err("empty zones should fail");
        assert!(error.contains("Segment empty-zones must contain at least one OCR zone"));
    }

    #[test]
    fn selection_validation_rejects_regions_outside_frame_or_too_small() {
        let outside_selection = OcrSelection {
            segments: vec![OcrSegment {
                id: "bad-region".to_string(),
                start_time_ms: 0,
                end_time_ms: 1000,
                zones: vec![OcrZone {
                    id: "zone-outside".to_string(),
                    role: OcrZoneRole::MainSubtitle,
                    region: OcrRegion {
                        x: 0.9,
                        y: 0.75,
                        width: 0.2,
                        height: 0.25,
                    },
                    label: None,
                }],
            }],
        };
        let outside_error = validate_ocr_selection(&outside_selection, 10_000)
            .expect_err("outside region should fail");
        assert!(outside_error.contains("Zone zone-outside"));

        let tiny_selection = OcrSelection {
            segments: vec![OcrSegment {
                id: "tiny-region".to_string(),
                start_time_ms: 0,
                end_time_ms: 1000,
                zones: vec![OcrZone {
                    id: "zone-tiny".to_string(),
                    role: OcrZoneRole::MainSubtitle,
                    region: OcrRegion {
                        x: 0.0,
                        y: 0.75,
                        width: 0.01,
                        height: 0.25,
                    },
                    label: None,
                }],
            }],
        };
        let tiny_error =
            validate_ocr_selection(&tiny_selection, 10_000).expect_err("tiny region should fail");
        assert!(tiny_error.contains("Zone zone-tiny"));
    }

    #[test]
    fn selection_validation_rejects_non_finite_regions() {
        let selection = OcrSelection {
            segments: vec![OcrSegment {
                id: "non-finite-region".to_string(),
                start_time_ms: 0,
                end_time_ms: 1000,
                zones: vec![OcrZone {
                    id: "zone-nan".to_string(),
                    role: OcrZoneRole::MainSubtitle,
                    region: OcrRegion {
                        x: f64::NAN,
                        y: 0.75,
                        width: 1.0,
                        height: 0.25,
                    },
                    label: None,
                }],
            }],
        };

        let error =
            validate_ocr_selection(&selection, 10_000).expect_err("non-finite region should fail");
        assert!(error.contains("Zone zone-nan"));
    }

    fn valid_zone() -> OcrZone {
        OcrZone {
            id: "zone-a".to_string(),
            role: OcrZoneRole::MainSubtitle,
            region: OcrRegion {
                x: 0.0,
                y: 0.75,
                width: 1.0,
                height: 0.25,
            },
            label: None,
        }
    }
}

#[allow(dead_code)]
pub(crate) fn validate_ocr_selection(
    selection: &OcrSelection,
    duration_ms: u64,
) -> Result<(), String> {
    if selection.segments.is_empty() {
        return Err("OCR selection must contain at least one segment".to_string());
    }

    for segment in &selection.segments {
        if segment.start_time_ms >= segment.end_time_ms {
            return Err(format!("Segment {} must start before it ends", segment.id));
        }

        if segment.end_time_ms > duration_ms {
            return Err(format!(
                "Segment {} must stay within the video duration",
                segment.id
            ));
        }

        if segment.zones.is_empty() {
            return Err(format!(
                "Segment {} must contain at least one OCR zone",
                segment.id
            ));
        }

        for zone in &segment.zones {
            validate_region(&zone.region)
                .map_err(|message| format!("Zone {} {}", zone.id, message))?;
        }
    }

    Ok(())
}

#[allow(dead_code)]
fn validate_region(region: &OcrRegion) -> Result<(), String> {
    if !region.x.is_finite()
        || !region.y.is_finite()
        || !region.width.is_finite()
        || !region.height.is_finite()
        || region.x < 0.0
        || region.y < 0.0
        || region.width < 0.02
        || region.height < 0.02
        || region.x + region.width > 1.0
        || region.y + region.height > 1.0
    {
        return Err("must stay within the video frame and be at least 2% wide/high".to_string());
    }

    Ok(())
}
