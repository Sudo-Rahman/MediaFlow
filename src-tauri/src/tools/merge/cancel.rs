fn terminate_process(pid: u32) {
    if pid == 0 {
        return;
    }

    #[cfg(unix)]
    {
        // SAFETY: Best-effort process termination for a known PID.
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output();
    }
}

fn remove_output_file(path: &str) {
    let _ = std::fs::remove_file(path);
}

/// Cancel a specific merge by video path
#[tauri::command]
pub(crate) async fn cancel_merge_file(video_path: String) -> Result<(), String> {
    let pid = {
        match super::state::MERGE_PROCESS_IDS.lock() {
            Ok(mut guard) => guard.remove(&video_path),
            Err(_) => return Err("Failed to acquire process lock".to_string()),
        }
    };

    let output_path = {
        match super::state::MERGE_OUTPUT_PATHS.lock() {
            Ok(mut guard) => guard.remove(&video_path),
            Err(_) => None,
        }
    };

    if let Some(pid) = pid {
        terminate_process(pid);
    }

    if let Some(path) = output_path {
        remove_output_file(&path);
    }

    Ok(())
}

/// Cancel all ongoing merges
#[tauri::command]
pub(crate) async fn cancel_merge() -> Result<(), String> {
    let pids: Vec<u32> = {
        match super::state::MERGE_PROCESS_IDS.lock() {
            Ok(mut guard) => {
                let pids: Vec<u32> = guard.values().copied().collect();
                guard.clear();
                pids
            }
            Err(_) => return Err("Failed to acquire process lock".to_string()),
        }
    };

    let output_paths: Vec<String> = {
        match super::state::MERGE_OUTPUT_PATHS.lock() {
            Ok(mut guard) => {
                let paths: Vec<String> = guard.values().cloned().collect();
                guard.clear();
                paths
            }
            Err(_) => Vec::new(),
        }
    };

    for pid in pids {
        terminate_process(pid);
    }

    for path in output_paths {
        remove_output_file(&path);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serial_test::serial;

    use super::{cancel_merge, cancel_merge_file};

    #[tokio::test]
    #[serial]
    async fn cancel_merge_file_cleans_state_and_output_path() {
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("merge-out.mkv");
        std::fs::write(&output, b"partial").expect("failed to create output file");
        let video = "/tmp/test-video-merge-file.mkv".to_string();

        {
            let mut pids = super::super::state::MERGE_PROCESS_IDS
                .lock()
                .expect("failed to lock pids");
            pids.insert(video.clone(), 0);
        }
        {
            let mut outputs = super::super::state::MERGE_OUTPUT_PATHS
                .lock()
                .expect("failed to lock outputs");
            outputs.insert(video.clone(), output.to_string_lossy().to_string());
        }

        cancel_merge_file(video.clone())
            .await
            .expect("cancel merge file should succeed");

        assert!(!output.exists());
        assert!(
            !super::super::state::MERGE_PROCESS_IDS
                .lock()
                .expect("failed to lock pids")
                .contains_key(&video)
        );
        assert!(
            !super::super::state::MERGE_OUTPUT_PATHS
                .lock()
                .expect("failed to lock outputs")
                .contains_key(&video)
        );
    }

    #[tokio::test]
    #[serial]
    async fn cancel_merge_cleans_all_tracked_merges() {
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let out_a = temp.path().join("a.mkv");
        let out_b = temp.path().join("b.mkv");
        std::fs::write(&out_a, b"partial").expect("failed to create output file a");
        std::fs::write(&out_b, b"partial").expect("failed to create output file b");

        {
            let mut pids = super::super::state::MERGE_PROCESS_IDS
                .lock()
                .expect("failed to lock pids");
            pids.insert("video-a".to_string(), 0);
            pids.insert("video-b".to_string(), 0);
        }
        {
            let mut outputs = super::super::state::MERGE_OUTPUT_PATHS
                .lock()
                .expect("failed to lock outputs");
            outputs.insert("video-a".to_string(), out_a.to_string_lossy().to_string());
            outputs.insert("video-b".to_string(), out_b.to_string_lossy().to_string());
        }

        cancel_merge().await.expect("cancel all should succeed");

        assert!(!out_a.exists());
        assert!(!out_b.exists());
        assert!(
            super::super::state::MERGE_PROCESS_IDS
                .lock()
                .expect("failed to lock pids")
                .is_empty()
        );
        assert!(
            super::super::state::MERGE_OUTPUT_PATHS
                .lock()
                .expect("failed to lock outputs")
                .is_empty()
        );
    }
}
