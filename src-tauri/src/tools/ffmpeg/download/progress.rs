use tauri::Emitter;

#[derive(Default)]
pub(super) struct DownloadTracker {
    pub(super) total_bytes: u64,
    pub(super) downloaded_bytes: u64,
}

pub(super) fn emit_download_progress(app: &tauri::AppHandle, progress: f64, stage: &str) {
    let _ = app.emit(
        "ffmpeg-download-progress",
        serde_json::json!({
            "progress": progress,
            "stage": stage
        }),
    );
}
