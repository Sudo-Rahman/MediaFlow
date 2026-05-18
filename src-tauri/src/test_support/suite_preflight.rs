#![allow(dead_code)]

use std::sync::OnceLock;

use crate::shared::process::std_command;

static SUITE_PREFLIGHT_RESULT: OnceLock<Result<(), String>> = OnceLock::new();

#[ctor::ctor]
fn run_suite_preflight_on_test_start() {
    if !should_run_suite_preflight_from_args() {
        return;
    }

    if let Err(error) = run_suite_preflight() {
        panic!("{}", error);
    }
}

pub(crate) fn run_suite_preflight() -> Result<(), String> {
    let result = SUITE_PREFLIGHT_RESULT.get_or_init(|| {
        ensure_binary_available("ffmpeg", crate::test_support::ffmpeg::try_ffmpeg_path()?)?;
        ensure_binary_available("ffprobe", crate::test_support::ffmpeg::try_ffprobe_path()?)?;
        crate::test_support::assets::ensure_sample_video_sync()?;
        crate::test_support::assets::ensure_ocr_video_sync()?;
        Ok(())
    });

    result.clone()
}

pub(crate) fn should_run_suite_preflight_from_args() -> bool {
    should_run_suite_preflight_from(std::env::args().skip(1))
}

fn should_run_suite_preflight_from<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args: Vec<String> = args.into_iter().map(|a| a.as_ref().to_string()).collect();
    if args.is_empty() {
        return true;
    }

    let mut i = 0usize;
    while i < args.len() {
        let arg = &args[i];

        if arg == "--list" {
            return false;
        }

        if arg == "--test-threads"
            || arg == "--skip"
            || arg == "--format"
            || arg == "--color"
            || arg == "--report-time"
            || arg == "--ensure-time"
            || arg == "--shuffle-seed"
            || arg == "--logfile"
        {
            i = i.saturating_add(2);
            continue;
        }

        if arg.starts_with('-') {
            i = i.saturating_add(1);
            continue;
        }

        // Positional non-option arg => test filter pattern provided.
        return false;
    }

    true
}

fn ensure_binary_available(binary: &str, path: &str) -> Result<(), String> {
    let output = std_command(path).arg("-version").output().map_err(|e| {
        format!(
            "Missing bundled dependency: `{}` could not be executed at `{}`.\n\
             CI must use the FFmpeg binaries downloaded by src-tauri/build.rs.\n\
             Local test runs may fall back to `{}` on PATH when CI is not set.\n\
             Details: {}",
            binary, path, binary, e
        )
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Dependency check failed: `{}` exists at `{}` but cannot run `-version`.\n\
             stderr: {}",
            binary, path, stderr
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::should_run_suite_preflight_from;

    #[test]
    fn should_run_suite_preflight_for_full_run_without_filter() {
        assert!(should_run_suite_preflight_from(["--nocapture"]));
    }

    #[test]
    fn should_skip_suite_preflight_for_filtered_run() {
        assert!(!should_run_suite_preflight_from(["archive_type_from_url"]));
        assert!(!should_run_suite_preflight_from([
            "archive_type_from_url",
            "--exact"
        ]));
    }

    #[test]
    fn should_skip_suite_preflight_for_list_mode() {
        assert!(!should_run_suite_preflight_from(["--list"]));
    }

    #[test]
    fn should_run_suite_preflight_with_flag_values() {
        assert!(should_run_suite_preflight_from(["--test-threads", "1"]));
        assert!(should_run_suite_preflight_from(["--color", "always"]));
    }
}
