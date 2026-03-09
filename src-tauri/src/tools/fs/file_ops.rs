use super::state;
use crate::shared::copy_progress::{CopyProgressTracker, CopyProgressUpdate};
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::validation::validate_output_path;
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::Emitter;

const COPY_BUFFER_SIZE_BYTES: usize = 1024 * 1024;
const COPY_PROGRESS_EVENT_INTERVAL: Duration = Duration::from_millis(100);
const COPY_CANCELLED_ERROR: &str = "Copy cancelled";

struct CopyOperationGuard {
    source_path: String,
}

impl CopyOperationGuard {
    fn begin(source_path: &str) -> Result<Self, String> {
        state::register_copy(source_path)?;
        Ok(Self {
            source_path: source_path.to_string(),
        })
    }
}

impl Drop for CopyOperationGuard {
    fn drop(&mut self) {
        state::clear_copy(&self.source_path);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameCopyProgressEvent<'a> {
    source_path: &'a str,
    dest_path: &'a str,
    bytes_copied: u64,
    total_bytes: u64,
    progress: i32,
    speed_bytes_per_sec: Option<f64>,
}

fn emit_rename_copy_progress(
    app: &tauri::AppHandle,
    source_path: &str,
    dest_path: &str,
    update: CopyProgressUpdate,
    bytes_copied: u64,
    total_bytes: u64,
) {
    let _ = app.emit(
        "rename-copy-progress",
        RenameCopyProgressEvent {
            source_path,
            dest_path,
            bytes_copied,
            total_bytes,
            progress: update.progress,
            speed_bytes_per_sec: update.speed_bytes_per_sec,
        },
    );
}

fn remove_partial_output(path: &str) {
    let _ = std::fs::remove_file(path);
}

fn validate_copy_paths(source_path: &str, dest_path: &str, overwrite: bool) -> Result<(), String> {
    let source = Path::new(source_path);
    if !source.exists() {
        return Err(format!("Source file not found: {}", source_path));
    }
    if !source.is_file() {
        return Err(format!("Source is not a file: {}", source_path));
    }

    validate_output_path(dest_path)?;

    let dest = Path::new(dest_path);
    if dest.exists() {
        if !dest.is_file() {
            return Err(format!("Destination is not a file: {}", dest_path));
        }
        if !overwrite {
            return Err(format!("Destination already exists: {}", dest_path));
        }
    }

    Ok(())
}

fn copy_file_with_progress<F>(
    source_path: &str,
    dest_path: &str,
    total_bytes: u64,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(CopyProgressUpdate, u64, u64),
{
    let source_file =
        File::open(source_path).map_err(|e| format!("Failed to open source: {}", e))?;
    let dest_file =
        File::create(dest_path).map_err(|e| format!("Failed to create destination: {}", e))?;

    let mut reader = BufReader::with_capacity(COPY_BUFFER_SIZE_BYTES, source_file);
    let mut writer = BufWriter::with_capacity(COPY_BUFFER_SIZE_BYTES, dest_file);
    let mut buffer = vec![0_u8; COPY_BUFFER_SIZE_BYTES];
    let mut copied_bytes: u64 = 0;
    let mut tracker = CopyProgressTracker::new(total_bytes);

    let initial = tracker.observe(0);
    on_progress(initial, 0, total_bytes);

    loop {
        if state::is_copy_cancel_requested(source_path)? {
            return Err(COPY_CANCELLED_ERROR.to_string());
        }

        let bytes_read = reader
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read source: {}", e))?;
        if bytes_read == 0 {
            break;
        }

        writer
            .write_all(&buffer[..bytes_read])
            .map_err(|e| format!("Failed to write destination: {}", e))?;

        copied_bytes += bytes_read as u64;
        let update = tracker.observe(copied_bytes);
        on_progress(update, copied_bytes, total_bytes);

        if state::is_copy_cancel_requested(source_path)? {
            return Err(COPY_CANCELLED_ERROR.to_string());
        }
    }

    writer
        .flush()
        .map_err(|e| format!("Failed to flush destination: {}", e))?;
    Ok(())
}

fn copy_file_impl<F>(
    source_path: &str,
    dest_path: &str,
    overwrite: bool,
    on_progress: F,
) -> Result<(), String>
where
    F: FnMut(CopyProgressUpdate, u64, u64),
{
    validate_copy_paths(source_path, dest_path, overwrite)?;

    let total_bytes = std::fs::metadata(source_path)
        .map_err(|e| format!("Failed to read source metadata: {}", e))?
        .len();
    let _copy_guard = CopyOperationGuard::begin(source_path)?;

    if let Err(error) = copy_file_with_progress(source_path, dest_path, total_bytes, on_progress) {
        remove_partial_output(dest_path);
        if error == COPY_CANCELLED_ERROR {
            return Err(COPY_CANCELLED_ERROR.to_string());
        }
        return Err(format!("Failed to copy file: {}", error));
    }

    Ok(())
}

/// Rename a file on disk
#[tauri::command]
pub(crate) async fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    // Validate paths
    let old = Path::new(&old_path);
    if !old.exists() {
        return Err(format!("Source file not found: {}", old_path));
    }
    if !old.is_file() {
        return Err(format!("Source is not a file: {}", old_path));
    }

    validate_output_path(&new_path)?;

    // Check if destination already exists
    let new = Path::new(&new_path);
    if new.exists() {
        return Err(format!("Destination already exists: {}", new_path));
    }

    std::fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename file: {}", e))
}

/// Copy a file to a new location
#[tauri::command]
pub(crate) async fn copy_file(
    app: tauri::AppHandle,
    source_path: String,
    dest_path: String,
    overwrite: Option<bool>,
) -> Result<(), String> {
    let overwrite = overwrite.unwrap_or(false);
    let _sleep_guard = SleepInhibitGuard::try_acquire("Copying file").ok();

    let mut last_emitted_at = Instant::now();
    copy_file_impl(
        &source_path,
        &dest_path,
        overwrite,
        |update, bytes_copied, total_bytes| {
            let is_initial = bytes_copied == 0;
            let is_final = total_bytes == 0 || bytes_copied >= total_bytes;
            let interval_elapsed = last_emitted_at.elapsed() >= COPY_PROGRESS_EVENT_INTERVAL;
            if is_initial || is_final || interval_elapsed {
                emit_rename_copy_progress(
                    &app,
                    &source_path,
                    &dest_path,
                    update,
                    bytes_copied,
                    total_bytes,
                );
                last_emitted_at = Instant::now();
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{COPY_BUFFER_SIZE_BYTES, COPY_CANCELLED_ERROR, copy_file_impl, rename_file};

    #[tokio::test]
    async fn rename_file_moves_source_to_destination() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let source = dir.path().join("old.txt");
        let dest = dir.path().join("new.txt");
        std::fs::write(&source, b"hello").expect("failed to create source file");

        rename_file(
            source.to_string_lossy().to_string(),
            dest.to_string_lossy().to_string(),
        )
        .await
        .expect("rename should succeed");

        assert!(!source.exists());
        assert!(dest.exists());
    }

    #[tokio::test]
    async fn rename_file_rejects_existing_destination() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let source = dir.path().join("old.txt");
        let dest = dir.path().join("new.txt");
        std::fs::write(&source, b"hello").expect("failed to create source file");
        std::fs::write(&dest, b"occupied").expect("failed to create destination file");

        let error = rename_file(
            source.to_string_lossy().to_string(),
            dest.to_string_lossy().to_string(),
        )
        .await
        .expect_err("rename should fail when destination exists");
        assert!(error.contains("Destination already exists"));
    }

    #[tokio::test]
    async fn copy_file_writes_destination() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let source = dir.path().join("src.txt");
        let dest = dir.path().join("dst.txt");
        std::fs::write(&source, b"copy-me").expect("failed to create source file");

        copy_file_impl(
            source.to_string_lossy().as_ref(),
            dest.to_string_lossy().as_ref(),
            false,
            |_, _, _| {},
        )
        .expect("copy should succeed");

        let content = std::fs::read_to_string(&dest).expect("failed to read destination");
        assert_eq!(content, "copy-me");
    }

    #[tokio::test]
    async fn copy_file_rejects_existing_destination_without_overwrite() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let source = dir.path().join("src.txt");
        let dest = dir.path().join("dst.txt");
        std::fs::write(&source, b"copy-me").expect("failed to create source file");
        std::fs::write(&dest, b"existing").expect("failed to create destination file");

        let error = copy_file_impl(
            source.to_string_lossy().as_ref(),
            dest.to_string_lossy().as_ref(),
            false,
            |_, _, _| {},
        )
        .expect_err("copy should fail when destination exists and overwrite is false");

        assert!(error.contains("Destination already exists"));
        let content = std::fs::read_to_string(&dest).expect("failed to read destination");
        assert_eq!(content, "existing");
    }

    #[tokio::test]
    async fn copy_file_overwrites_existing_destination_when_allowed() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let source = dir.path().join("src.txt");
        let dest = dir.path().join("dst.txt");
        std::fs::write(&source, b"copy-me").expect("failed to create source file");
        std::fs::write(&dest, b"existing").expect("failed to create destination file");

        copy_file_impl(
            source.to_string_lossy().as_ref(),
            dest.to_string_lossy().as_ref(),
            true,
            |_, _, _| {},
        )
        .expect("copy should overwrite destination");

        let content = std::fs::read_to_string(&dest).expect("failed to read destination");
        assert_eq!(content, "copy-me");
    }

    #[test]
    fn copy_file_progress_is_monotonic_and_reaches_completion() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let source = dir.path().join("src.bin");
        let dest = dir.path().join("dst.bin");
        let source_size = (COPY_BUFFER_SIZE_BYTES * 2) + 12345;
        let source_data = vec![0x7f_u8; source_size];
        std::fs::write(&source, source_data).expect("failed to create source file");

        let mut progress_samples: Vec<(i32, u64, u64)> = Vec::new();
        copy_file_impl(
            source.to_string_lossy().as_ref(),
            dest.to_string_lossy().as_ref(),
            false,
            |update, bytes_copied, total_bytes| {
                progress_samples.push((update.progress, bytes_copied, total_bytes));
            },
        )
        .expect("copy should succeed");

        assert!(
            !progress_samples.is_empty(),
            "expected at least one progress sample"
        );
        for sample in progress_samples.windows(2) {
            let previous = sample[0];
            let current = sample[1];
            assert!(
                current.1 >= previous.1,
                "bytes_copied should be monotonic: {:?} -> {:?}",
                previous,
                current
            );
            assert!(
                current.0 >= previous.0,
                "progress should be monotonic: {:?} -> {:?}",
                previous,
                current
            );
        }

        let last = progress_samples.last().expect("last sample should exist");
        assert_eq!(last.0, 100);
        assert_eq!(last.1, last.2);

        let copied = std::fs::read(&dest).expect("failed to read destination file");
        let original = std::fs::read(&source).expect("failed to read source file");
        assert_eq!(copied, original);
    }

    #[test]
    fn copy_file_zero_byte_source_reports_completed_progress() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let source = dir.path().join("src-empty.bin");
        let dest = dir.path().join("dst-empty.bin");
        std::fs::write(&source, []).expect("failed to create empty source file");

        let mut progress_samples: Vec<(i32, u64, u64)> = Vec::new();
        copy_file_impl(
            source.to_string_lossy().as_ref(),
            dest.to_string_lossy().as_ref(),
            false,
            |update, bytes_copied, total_bytes| {
                progress_samples.push((update.progress, bytes_copied, total_bytes));
            },
        )
        .expect("copy should succeed");

        assert_eq!(progress_samples.len(), 1);
        let sample = progress_samples[0];
        assert_eq!(sample.0, 100);
        assert_eq!(sample.1, 0);
        assert_eq!(sample.2, 0);
    }

    #[test]
    fn copy_file_cancellation_removes_partial_output_and_stops_copy() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let source = dir.path().join("src-large.bin");
        let dest = dir.path().join("dst-large.bin");

        let source_size = COPY_BUFFER_SIZE_BYTES * 8;
        std::fs::write(&source, vec![0xAB_u8; source_size]).expect("failed to create source file");

        let source_path = source.to_string_lossy().to_string();
        let mut cancel_requested = false;
        let result = copy_file_impl(
            source_path.as_str(),
            dest.to_string_lossy().as_ref(),
            false,
            |_, bytes_copied, _| {
                if !cancel_requested && bytes_copied >= COPY_BUFFER_SIZE_BYTES as u64 {
                    super::state::request_copy_cancel(source_path.as_str())
                        .expect("requesting copy cancel should succeed");
                    cancel_requested = true;
                }
            },
        );

        let error = result.expect_err("copy should return cancel error");
        assert_eq!(error, COPY_CANCELLED_ERROR);
        assert!(!dest.exists(), "destination partial file should be removed");

        let active_guard = super::state::ACTIVE_COPY_SOURCES
            .lock()
            .expect("failed to lock active copy sources");
        assert!(!active_guard.contains(source_path.as_str()));
        drop(active_guard);

        let cancelled_guard = super::state::CANCELLED_COPY_SOURCES
            .lock()
            .expect("failed to lock cancelled copy sources");
        assert!(!cancelled_guard.contains(source_path.as_str()));
    }
}
