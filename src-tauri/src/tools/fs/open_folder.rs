use crate::shared::validation::validate_directory_path;
use tokio::process::Command;

/// Open a folder in the system file manager
#[tauri::command]
pub(crate) async fn open_folder(path: String) -> Result<(), String> {
    // Validate directory path
    validate_directory_path(&path)?;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::open_folder;

    #[tokio::test]
    async fn open_folder_rejects_missing_directory() {
        let error = open_folder("/tmp/definitely-missing-folder".to_string())
            .await
            .expect_err("missing directory should fail");
        assert!(error.contains("Directory not found"));
    }
}
