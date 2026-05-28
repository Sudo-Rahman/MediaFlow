use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::Emitter;

const PROGRESS_MIN_INTERVAL: Duration = Duration::from_millis(150);

#[derive(Debug)]
struct ProgressState {
    last_current: u32,
    last_emitted_at: Option<Instant>,
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

    pub(super) fn app_handle(&self) -> tauri::AppHandle {
        self.app.clone()
    }

    fn emit_internal(&self, current: u32, message: String, force: bool) {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };

        if !force
            && state
                .last_emitted_at
                .is_some_and(|instant| instant.elapsed() < PROGRESS_MIN_INTERVAL)
            && current <= state.last_current
        {
            return;
        }

        let _ = self.app.emit(
            "subtitle-ocr-progress",
            serde_json::json!({
                "itemId": self.item_id,
                "phase": self.phase,
                "current": current,
                "total": self.total,
                "message": message,
            }),
        );

        state.last_current = current;
        state.last_emitted_at = Some(Instant::now());
    }
}

#[cfg(test)]
mod tests {}
