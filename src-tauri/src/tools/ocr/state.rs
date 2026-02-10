use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// Store OCR process IDs and output paths for cancellation and cleanup
pub(super) static OCR_PROCESS_IDS: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Store OCR transcode output paths for cleanup on cancel/error
pub(super) static OCR_TRANSCODE_PATHS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
