use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// Store extraction process IDs keyed by input path for individual cancellation.
pub(super) static EXTRACT_PROCESS_IDS: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Store extraction output paths for cleanup on cancel/error.
pub(super) static EXTRACT_OUTPUT_PATHS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
