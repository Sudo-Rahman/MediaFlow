mod duration;
pub(crate) mod probe;

use std::time::Duration;

/// Timeout for FFprobe operations (30 seconds)
pub(crate) const FFPROBE_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) use duration::{get_media_duration_us, get_media_duration_us_with_ffprobe};
