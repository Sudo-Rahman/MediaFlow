use crate::shared::process::terminate_process;

fn remove_output_file(path: &str) {
    let _ = std::fs::remove_file(path);
}

/// Cancel extraction for a specific input file.
#[tauri::command]
pub(crate) async fn cancel_extract_file(input_path: String) -> Result<(), String> {
    let pid = {
        match super::state::EXTRACT_PROCESS_IDS.lock() {
            Ok(mut guard) => guard.remove(&input_path),
            Err(_) => return Err("Failed to acquire process lock".to_string()),
        }
    };

    let output_path = {
        match super::state::EXTRACT_OUTPUT_PATHS.lock() {
            Ok(mut guard) => guard.remove(&input_path),
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

/// Cancel all ongoing extractions.
#[tauri::command]
pub(crate) async fn cancel_extract() -> Result<(), String> {
    let pids: Vec<u32> = {
        match super::state::EXTRACT_PROCESS_IDS.lock() {
            Ok(mut guard) => {
                let pids: Vec<u32> = guard.values().copied().collect();
                guard.clear();
                pids
            }
            Err(_) => return Err("Failed to acquire process lock".to_string()),
        }
    };

    let output_paths: Vec<String> = {
        match super::state::EXTRACT_OUTPUT_PATHS.lock() {
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

    for output_path in output_paths {
        remove_output_file(&output_path);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serial_test::serial;

    use super::{cancel_extract, cancel_extract_file};

    #[tokio::test]
    #[serial]
    async fn cancel_extract_file_cleans_state_and_output_path() {
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let output = temp.path().join("extract-out.track1.ass");
        std::fs::write(&output, b"partial").expect("failed to create output file");
        let input = "/tmp/test-input-extract.mkv".to_string();

        {
            let mut pids = super::super::state::EXTRACT_PROCESS_IDS
                .lock()
                .expect("failed to lock pids");
            pids.insert(input.clone(), 0);
        }
        {
            let mut outputs = super::super::state::EXTRACT_OUTPUT_PATHS
                .lock()
                .expect("failed to lock outputs");
            outputs.insert(input.clone(), output.to_string_lossy().to_string());
        }

        cancel_extract_file(input.clone())
            .await
            .expect("cancel extract file should succeed");

        assert!(!output.exists());
        assert!(
            !super::super::state::EXTRACT_PROCESS_IDS
                .lock()
                .expect("failed to lock pids")
                .contains_key(&input)
        );
        assert!(
            !super::super::state::EXTRACT_OUTPUT_PATHS
                .lock()
                .expect("failed to lock outputs")
                .contains_key(&input)
        );
    }

    #[tokio::test]
    #[serial]
    async fn cancel_extract_cleans_all_tracked_extractions() {
        let temp = tempfile::tempdir().expect("failed to create tempdir");
        let out_a = temp.path().join("a.ass");
        let out_b = temp.path().join("b.ass");
        std::fs::write(&out_a, b"partial").expect("failed to create output file a");
        std::fs::write(&out_b, b"partial").expect("failed to create output file b");

        {
            let mut pids = super::super::state::EXTRACT_PROCESS_IDS
                .lock()
                .expect("failed to lock pids");
            pids.insert("input-a".to_string(), 0);
            pids.insert("input-b".to_string(), 0);
        }
        {
            let mut outputs = super::super::state::EXTRACT_OUTPUT_PATHS
                .lock()
                .expect("failed to lock outputs");
            outputs.insert("input-a".to_string(), out_a.to_string_lossy().to_string());
            outputs.insert("input-b".to_string(), out_b.to_string_lossy().to_string());
        }

        cancel_extract()
            .await
            .expect("cancel all extractions should succeed");

        assert!(!out_a.exists());
        assert!(!out_b.exists());
        assert!(
            super::super::state::EXTRACT_PROCESS_IDS
                .lock()
                .expect("failed to lock pids")
                .is_empty()
        );
        assert!(
            super::super::state::EXTRACT_OUTPUT_PATHS
                .lock()
                .expect("failed to lock outputs")
                .is_empty()
        );
    }
}
