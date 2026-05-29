use crate::shared::process::terminate_process;

#[tauri::command]
pub(crate) async fn cancel_subtitle_ocr_operation(
    item_id: String,
    run_id: String,
) -> Result<(), String> {
    if let Some(pid) = super::state::mark_cancelled(&item_id, &run_id)? {
        terminate_process(pid);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serial_test::serial;

    use super::cancel_subtitle_ocr_operation;

    #[tokio::test]
    #[serial]
    async fn cancel_subtitle_ocr_operation_preserves_registered_outputs_for_owner_cleanup() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("partial.sup");
        std::fs::write(&output, b"partial").expect("failed to write partial output");
        let item_id = "subtitle-item-1".to_string();
        let run_id = "run-1".to_string();

        let _ = super::super::state::clear_registered_operation(&item_id, &run_id);
        let _ = super::super::state::clear_cancelled(&item_id, &run_id);

        super::super::state::begin_operation(&item_id, &run_id).expect("operation should start");
        super::super::state::register_output_paths(
            &item_id,
            &run_id,
            vec![output.to_string_lossy().to_string()],
        )
        .expect("output registration should work");

        cancel_subtitle_ocr_operation(item_id.clone(), run_id.clone())
            .await
            .expect("cancel should succeed");

        assert!(output.exists());
        assert!(super::super::state::is_operation_cancelled(
            &item_id, &run_id
        ));
        assert!(super::super::state::has_registered_operation(&item_id));

        let paths = super::super::state::take_output_paths(&item_id, &run_id)
            .expect("owner should be able to take registered output paths");
        assert_eq!(paths, vec![output.to_string_lossy().to_string()]);
        let _ = std::fs::remove_file(&output);

        super::super::state::clear_registered_operation(&item_id, &run_id)
            .expect("owner cleanup should clear active operation");
        assert!(!super::super::state::has_registered_operation(&item_id));
        super::super::state::clear_cancelled(&item_id, &run_id)
            .expect("test cleanup should clear cancellation flag");
    }
}
