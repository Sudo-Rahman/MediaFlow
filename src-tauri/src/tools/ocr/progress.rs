use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::Emitter;

const PROGRESS_MIN_INTERVAL: Duration = Duration::from_millis(150);
const PROGRESS_MIN_STEP: u32 = 10;

#[derive(Debug)]
struct ProgressState {
    last_current: u32,
    last_emitted_at: Option<Instant>,
}

#[derive(Clone)]
pub(super) struct OcrProgressEmitter {
    app: tauri::AppHandle,
    file_id: String,
    operation_id: Option<String>,
    phase: &'static str,
    total: u32,
    state: Arc<Mutex<ProgressState>>,
}

impl OcrProgressEmitter {
    pub(super) fn new(
        app: tauri::AppHandle,
        file_id: impl Into<String>,
        operation_id: Option<String>,
        phase: &'static str,
        total: u32,
    ) -> Self {
        Self {
            app,
            file_id: file_id.into(),
            operation_id,
            phase,
            total,
            state: Arc::new(Mutex::new(ProgressState {
                last_current: 0,
                last_emitted_at: None,
            })),
        }
    }

    pub(super) fn emit(&self, current: u32, message: String) {
        self.emit_internal(current, message, false);
    }

    pub(super) fn emit_force(&self, current: u32, message: String) {
        self.emit_internal(current, message, true);
    }

    fn emit_internal(&self, current: u32, message: String, force: bool) {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };

        if !force {
            let emitted_recently = state
                .last_emitted_at
                .map(|instant| instant.elapsed() < PROGRESS_MIN_INTERVAL)
                .unwrap_or(false);
            let moved_enough = current.saturating_sub(state.last_current) >= PROGRESS_MIN_STEP;

            if emitted_recently && !moved_enough {
                return;
            }
        }

        let _ = self.app.emit(
            "ocr-progress",
            serde_json::json!({
                "fileId": self.file_id,
                "operationId": self.operation_id.clone(),
                "phase": self.phase,
                "current": current,
                "total": self.total,
                "message": message
            }),
        );

        state.last_current = current;
        state.last_emitted_at = Some(Instant::now());
    }
}
