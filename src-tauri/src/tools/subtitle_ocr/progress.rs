use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::Emitter;

const PROGRESS_MIN_INTERVAL: Duration = Duration::from_millis(150);
const PROGRESS_MIN_PERCENT_STEP: u32 = 5;

#[derive(Debug)]
struct ProgressState {
    last_current: u32,
    last_percentage: u32,
    last_emitted_at: Option<Instant>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SubtitleOcrProgressEvent {
    item_id: String,
    phase: &'static str,
    current: u32,
    total: u32,
    percentage: u32,
    message: String,
}

impl SubtitleOcrProgressEvent {
    pub(super) fn new(
        item_id: impl Into<String>,
        phase: &'static str,
        current: u32,
        total: u32,
        message: impl Into<String>,
    ) -> Self {
        Self {
            item_id: item_id.into(),
            phase,
            current,
            total,
            percentage: progress_percentage(current, total),
            message: message.into(),
        }
    }
}

#[derive(Clone)]
pub(super) struct SubtitleOcrProgressEmitter {
    app: tauri::AppHandle,
    item_id: String,
    phase: &'static str,
    total: u32,
    state: Arc<Mutex<ProgressState>>,
}

impl SubtitleOcrProgressEmitter {
    pub(super) fn new(
        app: tauri::AppHandle,
        item_id: impl Into<String>,
        phase: &'static str,
        total: u32,
    ) -> Self {
        Self {
            app,
            item_id: item_id.into(),
            phase,
            total,
            state: Arc::new(Mutex::new(ProgressState {
                last_current: 0,
                last_percentage: 0,
                last_emitted_at: None,
            })),
        }
    }

    pub(super) fn emit(&self, current: u32, message: impl Into<String>) {
        self.emit_internal(current, message.into(), false);
    }

    pub(super) fn emit_force(&self, current: u32, message: impl Into<String>) {
        self.emit_internal(current, message.into(), true);
    }

    fn emit_internal(&self, current: u32, message: String, force: bool) {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        let now = Instant::now();

        if !should_emit_progress(&state, current, self.total, now, force) {
            return;
        }

        let _ = self.app.emit(
            "subtitle-ocr-progress",
            SubtitleOcrProgressEvent::new(
                self.item_id.clone(),
                self.phase,
                current,
                self.total,
                message,
            ),
        );

        state.last_current = current;
        state.last_percentage = progress_percentage(current, self.total);
        state.last_emitted_at = Some(now);
    }
}

fn should_emit_progress(
    state: &ProgressState,
    current: u32,
    total: u32,
    now: Instant,
    force: bool,
) -> bool {
    if force {
        return true;
    }

    let Some(last_emitted_at) = state.last_emitted_at else {
        return true;
    };

    let percentage = progress_percentage(current, total);
    if percentage.saturating_sub(state.last_percentage) >= PROGRESS_MIN_PERCENT_STEP {
        return true;
    }

    now.duration_since(last_emitted_at) >= PROGRESS_MIN_INTERVAL
}

fn progress_percentage(current: u32, total: u32) -> u32 {
    if total == 0 {
        0
    } else {
        ((u64::from(current.min(total)) * 100) / u64::from(total)) as u32
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{ProgressState, SubtitleOcrProgressEvent, should_emit_progress};

    #[test]
    fn progress_event_serializes_percentage() {
        let event = SubtitleOcrProgressEvent::new("item-1", "ocr", 5, 10, "Half done");
        let value = serde_json::to_value(event).expect("event should serialize");

        assert_eq!(value["itemId"], "item-1");
        assert_eq!(value["phase"], "ocr");
        assert_eq!(value["current"], 5);
        assert_eq!(value["total"], 10);
        assert_eq!(value["percentage"], 50);
        assert_eq!(value["message"], "Half done");
    }

    #[test]
    fn progress_throttle_skips_small_updates_inside_interval() {
        let now = Instant::now();
        let mut state = ProgressState {
            last_current: 10,
            last_percentage: 10,
            last_emitted_at: Some(now),
        };

        assert!(!should_emit_progress(
            &state,
            11,
            100,
            now + Duration::from_millis(25),
            false
        ));

        state.last_percentage = 10;
        assert!(should_emit_progress(
            &state,
            15,
            100,
            now + Duration::from_millis(25),
            false
        ));
        assert!(should_emit_progress(
            &state,
            11,
            100,
            now + Duration::from_millis(250),
            false
        ));
        assert!(should_emit_progress(
            &state,
            11,
            100,
            now + Duration::from_millis(25),
            true
        ));
    }
}
