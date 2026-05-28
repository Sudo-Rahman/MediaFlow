use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

static SUBTITLE_OCR_PROCESS_IDS: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static SUBTITLE_OCR_OUTPUT_PATHS: LazyLock<Mutex<HashMap<String, Vec<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static SUBTITLE_OCR_ACTIVE_ITEMS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));
static SUBTITLE_OCR_CANCELLED_ITEMS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

pub(super) fn begin_operation(item_id: &str) -> Result<(), String> {
    if SUBTITLE_OCR_ACTIVE_ITEMS
        .lock()
        .map_err(|_| "Failed to acquire Subtitle OCR state lock".to_string())?
        .contains(item_id)
    {
        return Err(format!(
            "Subtitle OCR operation already active for item: {}",
            item_id
        ));
    }

    clear_cancelled(item_id)?;
    SUBTITLE_OCR_ACTIVE_ITEMS
        .lock()
        .map_err(|_| "Failed to acquire Subtitle OCR state lock".to_string())?
        .insert(item_id.to_string());
    Ok(())
}

pub(super) fn register_operation_pid(item_id: &str, pid: u32) -> Result<(), String> {
    SUBTITLE_OCR_PROCESS_IDS
        .lock()
        .map_err(|_| "Failed to acquire Subtitle OCR process lock".to_string())?
        .insert(item_id.to_string(), pid);
    SUBTITLE_OCR_ACTIVE_ITEMS
        .lock()
        .map_err(|_| "Failed to acquire Subtitle OCR state lock".to_string())?
        .insert(item_id.to_string());
    Ok(())
}

pub(super) fn register_output_paths(item_id: &str, paths: Vec<String>) -> Result<(), String> {
    SUBTITLE_OCR_OUTPUT_PATHS
        .lock()
        .map_err(|_| "Failed to acquire Subtitle OCR output lock".to_string())?
        .insert(item_id.to_string(), paths);
    Ok(())
}

pub(super) fn take_operation_pid(item_id: &str) -> Result<Option<u32>, String> {
    Ok(SUBTITLE_OCR_PROCESS_IDS
        .lock()
        .map_err(|_| "Failed to acquire Subtitle OCR process lock".to_string())?
        .remove(item_id))
}

pub(super) fn take_output_paths(item_id: &str) -> Result<Vec<String>, String> {
    Ok(SUBTITLE_OCR_OUTPUT_PATHS
        .lock()
        .map_err(|_| "Failed to acquire Subtitle OCR output lock".to_string())?
        .remove(item_id)
        .unwrap_or_default())
}

pub(super) fn clear_registered_operation(item_id: &str) -> Result<(), String> {
    let _ = take_operation_pid(item_id)?;
    let _ = take_output_paths(item_id)?;
    SUBTITLE_OCR_ACTIVE_ITEMS
        .lock()
        .map_err(|_| "Failed to acquire Subtitle OCR state lock".to_string())?
        .remove(item_id);
    Ok(())
}

pub(super) fn mark_cancelled(item_id: &str) -> Result<(), String> {
    SUBTITLE_OCR_CANCELLED_ITEMS
        .lock()
        .map_err(|_| "Failed to acquire Subtitle OCR cancellation lock".to_string())?
        .insert(item_id.to_string());
    Ok(())
}

pub(super) fn clear_cancelled(item_id: &str) -> Result<(), String> {
    SUBTITLE_OCR_CANCELLED_ITEMS
        .lock()
        .map_err(|_| "Failed to acquire Subtitle OCR cancellation lock".to_string())?
        .remove(item_id);
    Ok(())
}

pub(super) fn is_operation_cancelled(item_id: &str) -> bool {
    SUBTITLE_OCR_CANCELLED_ITEMS
        .lock()
        .map(|guard| guard.contains(item_id))
        .unwrap_or(true)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn has_registered_operation(item_id: &str) -> bool {
    let has_active = SUBTITLE_OCR_ACTIVE_ITEMS
        .lock()
        .map(|guard| guard.contains(item_id))
        .unwrap_or(false);
    let has_pid = SUBTITLE_OCR_PROCESS_IDS
        .lock()
        .map(|guard| guard.contains_key(item_id))
        .unwrap_or(false);

    has_active || has_pid
}

#[cfg(test)]
mod tests {
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
}
