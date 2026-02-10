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
        #[cfg(unix)]
        {
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

    if let Some(path) = output_path {
        let _ = std::fs::remove_file(&path);
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
        #[cfg(unix)]
        {
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

    for path in output_paths {
        let _ = std::fs::remove_file(&path);
    }

    Ok(())
}
