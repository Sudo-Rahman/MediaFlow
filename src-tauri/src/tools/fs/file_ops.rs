use crate::shared::validation::validate_output_path;
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use std::path::Path;

/// Rename a file on disk
#[tauri::command]
pub(crate) async fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    // Validate paths
    let old = Path::new(&old_path);
    if !old.exists() {
        return Err(format!("Source file not found: {}", old_path));
    }
    if !old.is_file() {
        return Err(format!("Source is not a file: {}", old_path));
    }

    validate_output_path(&new_path)?;

    // Check if destination already exists
    let new = Path::new(&new_path);
    if new.exists() {
        return Err(format!("Destination already exists: {}", new_path));
    }

    std::fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename file: {}", e))
}

/// Copy a file to a new location
#[tauri::command]
pub(crate) async fn copy_file(source_path: String, dest_path: String) -> Result<(), String> {
    // Validate paths
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err(format!("Source file not found: {}", source_path));
    }
    if !source.is_file() {
        return Err(format!("Source is not a file: {}", source_path));
    }

    validate_output_path(&dest_path)?;

    let _sleep_guard = SleepInhibitGuard::try_acquire("Copying file").ok();

    std::fs::copy(&source_path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;
    Ok(())
}
