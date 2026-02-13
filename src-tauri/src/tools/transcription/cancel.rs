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

/// Cancel a specific file's transcode by input path
#[tauri::command]
pub(crate) async fn cancel_transcode_file(input_path: String) -> Result<(), String> {
    let pid = {
        match super::TRANSCODE_PROCESS_IDS.lock() {
            Ok(mut guard) => guard.remove(&input_path),
            Err(_) => return Err("Failed to acquire process lock".to_string()),
        }
    };

    if let Some(pid) = pid {
        terminate_process(pid);
    }

    Ok(())
}

/// Cancel all ongoing transcodes
#[tauri::command]
pub(crate) async fn cancel_transcode() -> Result<(), String> {
    let pids: Vec<u32> = {
        match super::TRANSCODE_PROCESS_IDS.lock() {
            Ok(mut guard) => {
                let pids: Vec<u32> = guard.values().copied().collect();
                guard.clear();
                pids
            }
            Err(_) => return Err("Failed to acquire process lock".to_string()),
        }
    };

    for pid in pids {
        terminate_process(pid);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serial_test::serial;

    use super::{cancel_transcode, cancel_transcode_file};

    #[tokio::test]
    #[serial]
    async fn cancel_transcode_file_removes_single_entry() {
        let input = "/tmp/transcode-a.wav".to_string();
        {
            let mut guard = super::super::TRANSCODE_PROCESS_IDS
                .lock()
                .expect("failed to lock transcode map");
            guard.insert(input.clone(), 0);
        }

        cancel_transcode_file(input.clone())
            .await
            .expect("cancel transcode file should succeed");

        assert!(
            !super::super::TRANSCODE_PROCESS_IDS
                .lock()
                .expect("failed to lock transcode map")
                .contains_key(&input)
        );
    }

    #[tokio::test]
    #[serial]
    async fn cancel_transcode_clears_all_entries() {
        {
            let mut guard = super::super::TRANSCODE_PROCESS_IDS
                .lock()
                .expect("failed to lock transcode map");
            guard.insert("a".to_string(), 0);
            guard.insert("b".to_string(), 0);
        }

        cancel_transcode().await.expect("cancel all should succeed");

        assert!(
            super::super::TRANSCODE_PROCESS_IDS
                .lock()
                .expect("failed to lock transcode map")
                .is_empty()
        );
    }
}
