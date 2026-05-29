use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::Emitter;

const PROGRESS_MIN_INTERVAL: Duration = Duration::from_millis(150);
const PROGRESS_MIN_PERCENT_STEP: u32 = 5;

#[derive(Debug)]
struct ProgressState {
    last_percentage: u32,
    last_emitted_at: Option<Instant>,
    total: ProgressTotal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProgressTotal {
    Known(u32),
    Unknown,
}

impl From<u32> for ProgressTotal {
    fn from(value: u32) -> Self {
        Self::Known(value)
    }
}

impl ProgressTotal {
    fn event_total(self) -> u32 {
        match self {
            Self::Known(total) => total,
            Self::Unknown => 0,
        }
    }

    fn is_known(self) -> bool {
        matches!(self, Self::Known(_))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SubtitleOcrProgressEvent {
    item_id: String,
    run_id: String,
    phase: &'static str,
    current: u32,
    total: u32,
    total_known: bool,
    percentage: u32,
}

impl SubtitleOcrProgressEvent {
    pub(super) fn new(
        item_id: impl Into<String>,
        run_id: impl Into<String>,
        phase: &'static str,
        current: u32,
        total: impl Into<ProgressTotal>,
    ) -> Self {
        let total = total.into();
        Self {
            item_id: item_id.into(),
            run_id: run_id.into(),
            phase,
            current,
            total: total.event_total(),
            total_known: total.is_known(),
            percentage: progress_percentage(current, total),
        }
    }
}

#[derive(Clone)]
pub(super) struct SubtitleOcrProgressEmitter {
    app: tauri::AppHandle,
    item_id: String,
    run_id: String,
    phase: &'static str,
    state: Arc<Mutex<ProgressState>>,
}

impl SubtitleOcrProgressEmitter {
    pub(super) fn new(
        app: tauri::AppHandle,
        item_id: impl Into<String>,
        run_id: impl Into<String>,
        phase: &'static str,
        total: impl Into<ProgressTotal>,
    ) -> Self {
        Self {
            app,
            item_id: item_id.into(),
            run_id: run_id.into(),
            phase,
            state: Arc::new(Mutex::new(ProgressState {
                last_percentage: 0,
                last_emitted_at: None,
                total: total.into(),
            })),
        }
    }

    pub(super) fn emit(&self, current: u32) {
        self.emit_internal(current, None, false);
    }

    pub(super) fn emit_force(&self, current: u32) {
        self.emit_internal(current, None, true);
    }

    pub(super) fn emit_force_with_total(&self, current: u32, total: u32) {
        self.emit_internal(current, Some(total), true);
    }

    fn emit_internal(&self, current: u32, total_update: Option<u32>, force: bool) {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        let now = Instant::now();
        if let Some(total) = total_update {
            state.total = ProgressTotal::Known(total);
        }
        let percentage = progress_percentage(current, state.total);

        if !should_emit_progress(&state, percentage, now, force) {
            return;
        }

        let _ = self.app.emit(
            "subtitle-ocr-progress",
            SubtitleOcrProgressEvent::new(
                self.item_id.clone(),
                self.run_id.clone(),
                self.phase,
                current,
                state.total,
            ),
        );

        state.last_percentage = percentage;
        state.last_emitted_at = Some(now);
    }
}

fn should_emit_progress(state: &ProgressState, percentage: u32, now: Instant, force: bool) -> bool {
    if force {
        return true;
    }

    let Some(last_emitted_at) = state.last_emitted_at else {
        return true;
    };

    if percentage.saturating_sub(state.last_percentage) >= PROGRESS_MIN_PERCENT_STEP {
        return true;
    }

    now.duration_since(last_emitted_at) >= PROGRESS_MIN_INTERVAL
}

fn progress_percentage(current: u32, total: ProgressTotal) -> u32 {
    match total {
        ProgressTotal::Known(0) => 100,
        ProgressTotal::Known(total) => {
            ((u64::from(current.min(total)) * 100) / u64::from(total)) as u32
        }
        ProgressTotal::Unknown => 0,
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{
        ProgressState, ProgressTotal, SubtitleOcrProgressEvent, progress_percentage,
        should_emit_progress,
    };

    #[test]
    fn progress_event_serializes_percentage() {
        let event = SubtitleOcrProgressEvent::new("item-1", "run-1", "ocr", 5, 10);
        let value = serde_json::to_value(event).expect("event should serialize");

        assert_eq!(value["itemId"], "item-1");
        assert_eq!(value["runId"], "run-1");
        assert_eq!(value["phase"], "ocr");
        assert_eq!(value["current"], 5);
        assert_eq!(value["total"], 10);
        assert_eq!(value["totalKnown"], true);
        assert_eq!(value["percentage"], 50);
        assert!(value.get("message").is_none());
    }

    #[test]
    fn progress_percentage_reports_partial_bitmap_ocr_progress() {
        assert_eq!(progress_percentage(27, ProgressTotal::Known(373)), 7);
    }

    #[test]
    fn progress_percentage_treats_empty_work_as_complete() {
        assert_eq!(progress_percentage(0, ProgressTotal::Known(0)), 100);
    }

    #[test]
    fn progress_event_serializes_unknown_total_without_progress() {
        let event =
            SubtitleOcrProgressEvent::new("item-1", "run-1", "ocr", 27, ProgressTotal::Unknown);
        let value = serde_json::to_value(event).expect("event should serialize");

        assert_eq!(value["total"], 0);
        assert_eq!(value["totalKnown"], false);
        assert_eq!(value["percentage"], 0);
    }

    #[test]
    fn progress_throttle_skips_small_updates_inside_interval() {
        let now = Instant::now();
        let mut state = ProgressState {
            last_percentage: 10,
            last_emitted_at: Some(now),
            total: ProgressTotal::Known(100),
        };

        assert!(!should_emit_progress(
            &state,
            11,
            now + Duration::from_millis(25),
            false
        ));

        state.last_percentage = 10;
        assert!(should_emit_progress(
            &state,
            15,
            now + Duration::from_millis(25),
            false
        ));
        assert!(should_emit_progress(
            &state,
            11,
            now + Duration::from_millis(250),
            false
        ));
        assert!(should_emit_progress(
            &state,
            11,
            now + Duration::from_millis(25),
            true
        ));
    }
}
