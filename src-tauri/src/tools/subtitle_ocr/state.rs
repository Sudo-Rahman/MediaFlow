use std::collections::{HashMap, HashSet};
use std::mem;
use std::sync::{LazyLock, Mutex, MutexGuard};

#[derive(Debug, Default)]
struct SubtitleOcrState {
    operations: HashMap<String, OperationRecord>,
    cancelled_items: HashSet<String>,
}

#[derive(Debug, Default)]
struct OperationRecord {
    pid: Option<u32>,
    output_paths: Vec<String>,
}

static SUBTITLE_OCR_STATE: LazyLock<Mutex<SubtitleOcrState>> =
    LazyLock::new(|| Mutex::new(SubtitleOcrState::default()));

pub(super) fn begin_operation(item_id: &str) -> Result<(), String> {
    let mut state = lock_state()?;
    if state.operations.contains_key(item_id) {
        return Err(format!(
            "Subtitle OCR operation already active for item: {}",
            item_id
        ));
    }

    state.cancelled_items.remove(item_id);
    state
        .operations
        .insert(item_id.to_string(), OperationRecord::default());
    Ok(())
}

pub(super) fn register_operation_pid(item_id: &str, pid: u32) -> Result<bool, String> {
    let mut state = lock_state()?;
    let is_cancelled = state.cancelled_items.contains(item_id);
    let operation = active_operation_mut(&mut state, item_id)?;
    operation.pid = Some(pid);
    Ok(is_cancelled)
}

pub(super) fn register_output_paths(item_id: &str, paths: Vec<String>) -> Result<bool, String> {
    let mut state = lock_state()?;
    let is_cancelled = state.cancelled_items.contains(item_id);
    let operation = active_operation_mut(&mut state, item_id)?;
    operation.output_paths = paths;
    Ok(is_cancelled)
}

pub(super) fn take_operation_pid(item_id: &str) -> Result<Option<u32>, String> {
    Ok(lock_state()?
        .operations
        .get_mut(item_id)
        .and_then(|operation| operation.pid.take()))
}

pub(super) fn take_output_paths(item_id: &str) -> Result<Vec<String>, String> {
    Ok(lock_state()?
        .operations
        .get_mut(item_id)
        .map(|operation| mem::take(&mut operation.output_paths))
        .unwrap_or_default())
}

pub(super) fn clear_registered_operation(item_id: &str) -> Result<(), String> {
    lock_state()?.operations.remove(item_id);
    Ok(())
}

pub(super) fn mark_cancelled(item_id: &str) -> Result<Option<u32>, String> {
    let mut state = lock_state()?;
    let Some(pid) = state
        .operations
        .get_mut(item_id)
        .map(|operation| operation.pid.take())
    else {
        return Ok(None);
    };

    state.cancelled_items.insert(item_id.to_string());
    Ok(pid)
}

pub(super) fn clear_cancelled(item_id: &str) -> Result<(), String> {
    lock_state()?.cancelled_items.remove(item_id);
    Ok(())
}

pub(super) fn is_operation_cancelled(item_id: &str) -> bool {
    SUBTITLE_OCR_STATE
        .lock()
        .map(|state| state.cancelled_items.contains(item_id))
        .unwrap_or(true)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn has_registered_operation(item_id: &str) -> bool {
    SUBTITLE_OCR_STATE
        .lock()
        .map(|state| state.operations.contains_key(item_id))
        .unwrap_or(false)
}

fn active_operation_mut<'state>(
    state: &'state mut SubtitleOcrState,
    item_id: &str,
) -> Result<&'state mut OperationRecord, String> {
    state
        .operations
        .get_mut(item_id)
        .ok_or_else(|| format!("No active Subtitle OCR operation for item: {}", item_id))
}

fn lock_state() -> Result<MutexGuard<'static, SubtitleOcrState>, String> {
    SUBTITLE_OCR_STATE
        .lock()
        .map_err(|_| "Failed to acquire Subtitle OCR state lock".to_string())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};
    use std::thread;

    use serial_test::serial;

    #[test]
    #[serial]
    fn begin_operation_rejects_duplicate_active_operation() {
        let item_id = "subtitle-ocr-duplicate-test";
        let _ = super::clear_registered_operation(item_id);
        let _ = super::clear_cancelled(item_id);

        super::begin_operation(item_id).expect("first operation should start");
        let error = super::begin_operation(item_id)
            .expect_err("second active operation for the same item should fail");

        assert!(error.contains("already active"));

        let _ = super::clear_registered_operation(item_id);
        let _ = super::clear_cancelled(item_id);
    }

    #[test]
    #[serial]
    fn begin_operation_waits_for_cancelled_operation_to_clear_before_reuse() {
        let item_id = "subtitle-ocr-cancel-then-new-test";
        let _ = super::clear_registered_operation(item_id);
        let _ = super::clear_cancelled(item_id);

        super::begin_operation(item_id).expect("operation should start");
        super::mark_cancelled(item_id).expect("operation should cancel");
        assert!(super::is_operation_cancelled(item_id));

        let error = super::begin_operation(item_id)
            .expect_err("new operation should wait for cancelled operation cleanup");
        assert!(error.contains("already active"));

        super::clear_registered_operation(item_id)
            .expect("cancelled operation cleanup should clear active state");
        super::begin_operation(item_id).expect("new operation after cancellation should start");
        assert!(!super::is_operation_cancelled(item_id));
        assert!(super::has_registered_operation(item_id));

        let _ = super::clear_registered_operation(item_id);
        let _ = super::clear_cancelled(item_id);
    }

    #[test]
    #[serial]
    fn register_output_paths_reports_prior_cancellation() {
        let item_id = "subtitle-ocr-cancel-before-output-registration-test";
        let _ = super::clear_registered_operation(item_id);
        let _ = super::clear_cancelled(item_id);

        super::begin_operation(item_id).expect("operation should start");
        super::mark_cancelled(item_id).expect("operation should cancel");

        let is_cancelled = super::register_output_paths(
            item_id,
            vec!["/tmp/subtitle-ocr-cancelled-output.sup".to_string()],
        )
        .expect("output registration should work");

        assert!(is_cancelled);

        let _ = super::take_output_paths(item_id);
        let _ = super::clear_registered_operation(item_id);
        let _ = super::clear_cancelled(item_id);
    }

    #[test]
    #[serial]
    fn register_operation_pid_reports_prior_cancellation() {
        let item_id = "subtitle-ocr-cancel-before-pid-registration-test";
        let _ = super::clear_registered_operation(item_id);
        let _ = super::clear_cancelled(item_id);

        super::begin_operation(item_id).expect("operation should start");
        super::mark_cancelled(item_id).expect("operation should cancel");

        let is_cancelled =
            super::register_operation_pid(item_id, 42).expect("pid registration should work");

        assert!(is_cancelled);
        assert_eq!(
            super::take_operation_pid(item_id).expect("pid should be readable by owner"),
            Some(42)
        );

        let _ = super::clear_registered_operation(item_id);
        let _ = super::clear_cancelled(item_id);
    }

    #[test]
    #[serial]
    fn begin_operation_allows_exactly_one_concurrent_start_for_same_item() {
        let item_id = "subtitle-ocr-concurrent-begin-test";
        let _ = super::clear_registered_operation(item_id);
        let _ = super::clear_cancelled(item_id);

        let thread_count = 64;
        let barrier = Arc::new(Barrier::new(thread_count));
        let successes = Arc::new(AtomicUsize::new(0));
        let handles = (0..thread_count)
            .map(|_| {
                let barrier = Arc::clone(&barrier);
                let successes = Arc::clone(&successes);
                thread::spawn(move || {
                    barrier.wait();
                    if super::begin_operation(item_id).is_ok() {
                        successes.fetch_add(1, Ordering::SeqCst);
                    }
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            handle.join().expect("worker thread should not panic");
        }

        assert_eq!(successes.load(Ordering::SeqCst), 1);

        let _ = super::clear_registered_operation(item_id);
        let _ = super::clear_cancelled(item_id);
    }
}
