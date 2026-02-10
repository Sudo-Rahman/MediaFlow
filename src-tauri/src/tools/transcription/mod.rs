use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

pub(crate) mod cancel;
pub(crate) mod transcode_opus;
pub(crate) mod waveform;

/// Store transcode process IDs keyed by input path for individual cancellation
static TRANSCODE_PROCESS_IDS: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
