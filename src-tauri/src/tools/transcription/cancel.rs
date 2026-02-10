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
        if pid != 0 {
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

    Ok(())
}
