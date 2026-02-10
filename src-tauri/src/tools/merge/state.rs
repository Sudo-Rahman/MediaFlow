use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// Store merge process IDs keyed by video path for individual cancellation
pub(super) static MERGE_PROCESS_IDS: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Store merge output paths for cleanup on cancel/error
pub(super) static MERGE_OUTPUT_PATHS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
