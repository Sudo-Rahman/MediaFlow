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

fn cleanup_transcode_file(path: &str) {
    let _ = std::fs::remove_file(path);
}

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
        terminate_process(pid);
    }

    // Clean up partial transcode file if it exists
    if let Some(path) = transcode_path {
        cleanup_transcode_file(&path);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serial_test::serial;

    use super::cancel_ocr_operation;

    #[tokio::test]
    #[serial]
    async fn cancel_ocr_operation_removes_process_and_partial_file() {
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("partial-preview.mp4");
        std::fs::write(&output, b"partial").expect("failed to create partial file");
        let file_id = "ocr-file-1".to_string();

        {
            let mut guard = super::super::state::OCR_PROCESS_IDS
                .lock()
                .expect("failed to lock ocr pid map");
            guard.insert(file_id.clone(), 0);
        }
        {
            let mut guard = super::super::state::OCR_TRANSCODE_PATHS
                .lock()
                .expect("failed to lock ocr path map");
            guard.insert(file_id.clone(), output.to_string_lossy().to_string());
        }

        cancel_ocr_operation(file_id.clone())
            .await
            .expect("cancel ocr should succeed");

        assert!(!output.exists());
        assert!(
            !super::super::state::OCR_PROCESS_IDS
                .lock()
                .expect("failed to lock ocr pid map")
                .contains_key(&file_id)
        );
        assert!(
            !super::super::state::OCR_TRANSCODE_PATHS
                .lock()
                .expect("failed to lock ocr path map")
                .contains_key(&file_id)
        );
    }
}
