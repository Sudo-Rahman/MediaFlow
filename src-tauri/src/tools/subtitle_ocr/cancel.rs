use crate::shared::process::terminate_process;

fn remove_output_file(path: &str) {
    let _ = std::fs::remove_file(path);
}

#[tauri::command]
pub(crate) async fn cancel_subtitle_ocr_operation(item_id: String) -> Result<(), String> {
    super::state::mark_cancelled(&item_id)?;

    if let Some(pid) = super::state::take_operation_pid(&item_id)? {
        terminate_process(pid);
    }

    for path in super::state::take_output_paths(&item_id)? {
        remove_output_file(&path);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serial_test::serial;

    use super::cancel_subtitle_ocr_operation;

    #[tokio::test]
    #[serial]
    async fn cancel_subtitle_ocr_operation_removes_state_and_partial_outputs() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("partial.sup");
        std::fs::write(&output, b"partial").expect("failed to write partial output");
        let item_id = "subtitle-item-1".to_string();

        super::super::state::register_operation_pid(&item_id, 0)
            .expect("pid registration should work");
        super::super::state::register_output_paths(
            &item_id,
            vec![output.to_string_lossy().to_string()],
        )
        .expect("output registration should work");

        cancel_subtitle_ocr_operation(item_id.clone())
            .await
            .expect("cancel should succeed");

        assert!(!output.exists());
        assert!(super::super::state::is_operation_cancelled(&item_id));
        assert!(!super::super::state::has_registered_operation(&item_id));
    }
}
