/// Cancel OCR operation for a specific file
#[tauri::command]
pub(crate) async fn cancel_ocr_operation(file_id: String) -> Result<(), String> {
    let pid = {
        match super::state::OCR_PROCESS_IDS.lock() {
            Ok(mut guard) => guard.remove(&file_id),
            Err(_) => return Err("Failed to acquire process lock".to_string()),
        }
    };

    // Get and remove the transcode output path for cleanup
    let transcode_path = {
        match super::state::OCR_TRANSCODE_PATHS.lock() {
            Ok(mut guard) => guard.remove(&file_id),
            Err(_) => None,
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

    // Clean up partial transcode file if it exists
    if let Some(path) = transcode_path {
        let _ = std::fs::remove_file(&path);
    }

    Ok(())
}
