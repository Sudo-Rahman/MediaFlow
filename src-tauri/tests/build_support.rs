#[path = "../build_support.rs"]
mod build_support;

use build_support::{
    BundleSource, DOWNLOAD_ATTEMPTS, DOWNLOAD_RETRIES, bundle_cache_marker_name,
    bundle_cache_version, retry_delay, retry_operation,
};

#[test]
fn download_attempts_allow_three_retries_after_initial_attempt() {
    assert_eq!(DOWNLOAD_RETRIES, 3);
    assert_eq!(DOWNLOAD_ATTEMPTS, 4);
}

#[test]
fn retry_operation_succeeds_on_third_attempt() {
    let mut attempts = 0;

    let result: Result<&str, &str> = retry_operation(DOWNLOAD_ATTEMPTS, |attempt| {
        attempts = attempt;
        if attempt < 3 {
            Err("temporary network error")
        } else {
            Ok("downloaded")
        }
    });

    assert_eq!(result, Ok("downloaded"));
    assert_eq!(attempts, 3);
}

#[test]
fn retry_operation_stops_after_initial_attempt_and_three_retries() {
    let mut attempts = 0;

    let result: Result<(), usize> = retry_operation(DOWNLOAD_ATTEMPTS, |attempt| {
        attempts = attempt;
        Err(attempt)
    });

    assert_eq!(result, Err(4));
    assert_eq!(attempts, 4);
}

#[test]
fn retry_delay_increases_for_later_attempts() {
    assert_eq!(retry_delay(1).as_secs(), 0);
    assert_eq!(retry_delay(2).as_secs(), 2);
    assert_eq!(retry_delay(4).as_secs(), 6);
}

#[test]
fn bundle_cache_version_is_stable_when_sources_match() {
    let sources = [
        BundleSource {
            name: "ffmpeg",
            source: "https://example.com/ffmpeg80intel.zip",
            checksum: Some("abc123"),
        },
        BundleSource {
            name: "ffprobe",
            source: "https://example.com/ffprobe80intel.zip",
            checksum: Some("def456"),
        },
    ];

    assert_eq!(
        bundle_cache_version("x86_64-apple-darwin", &sources),
        bundle_cache_version("x86_64-apple-darwin", &sources)
    );
}

#[test]
fn bundle_cache_version_changes_when_source_checksum_changes() {
    let original = [BundleSource {
        name: "ffmpeg",
        source: "https://example.com/ffmpeg80intel.zip",
        checksum: Some("abc123"),
    }];
    let updated = [BundleSource {
        name: "ffmpeg",
        source: "https://example.com/ffmpeg80intel.zip",
        checksum: Some("updated456"),
    }];

    assert_ne!(
        bundle_cache_version("x86_64-apple-darwin", &original),
        bundle_cache_version("x86_64-apple-darwin", &updated)
    );
}

#[test]
fn bundle_cache_version_changes_when_source_url_changes() {
    let original = [BundleSource {
        name: "btbn_release",
        source: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest-2026-05-01/ffmpeg-linux64-gpl-8.1.tar.xz",
        checksum: None,
    }];
    let updated = [BundleSource {
        name: "btbn_release",
        source: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest-2026-05-05/ffmpeg-linux64-gpl-8.1.tar.xz",
        checksum: None,
    }];

    assert_ne!(
        bundle_cache_version("x86_64-unknown-linux-gnu", &original),
        bundle_cache_version("x86_64-unknown-linux-gnu", &updated)
    );
}

#[test]
fn bundle_cache_marker_name_is_target_scoped() {
    assert_eq!(
        bundle_cache_marker_name("x86_64-apple-darwin"),
        "ffmpeg-bundle-x86_64-apple-darwin.version"
    );
}
