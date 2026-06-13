mod duration;
pub(crate) mod probe;

use std::time::Duration;

/// Timeout for FFprobe operations.
pub(crate) const FFPROBE_TIMEOUT: Duration = Duration::from_secs(120);

pub(crate) use duration::{
    get_media_duration_us, get_media_duration_us_with_ffprobe, parse_duration_us_from_probe_json,
};
