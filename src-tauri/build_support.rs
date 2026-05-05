use std::time::Duration;

pub const DOWNLOAD_RETRIES: usize = 3;
pub const DOWNLOAD_ATTEMPTS: usize = DOWNLOAD_RETRIES + 1;
pub const RETRY_DELAY_STEP_SECONDS: u64 = 2;

#[derive(Clone, Copy)]
pub struct BundleSource<'a> {
    pub name: &'a str,
    pub source: &'a str,
    pub checksum: Option<&'a str>,
}

pub fn retry_operation<T, E, F>(attempts: usize, mut operation: F) -> Result<T, E>
where
    F: FnMut(usize) -> Result<T, E>,
{
    assert!(
        attempts > 0,
        "retry_operation requires at least one attempt"
    );

    let mut last_error = None;
    for attempt in 1..=attempts {
        match operation(attempt) {
            Ok(value) => return Ok(value),
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.expect("retry_operation requires at least one attempt"))
}

pub fn retry_delay(attempt: usize) -> Duration {
    Duration::from_secs(attempt.saturating_sub(1) as u64 * RETRY_DELAY_STEP_SECONDS)
}

pub fn bundle_cache_version(target: &str, sources: &[BundleSource<'_>]) -> String {
    let mut version = format!("target={target}\n");

    for source in sources {
        version.push_str(source.name);
        version.push('=');
        version.push_str(source.source);
        version.push('\n');

        if let Some(checksum) = source.checksum {
            version.push_str(source.name);
            version.push_str(".sha256=");
            version.push_str(checksum);
            version.push('\n');
        }
    }

    version
}

pub fn bundle_cache_marker_name(target: &str) -> String {
    format!("ffmpeg-bundle-{target}.version")
}
