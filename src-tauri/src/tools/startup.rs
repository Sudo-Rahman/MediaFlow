use tauri::Manager;

#[tauri::command]
pub fn mark_startup_splash_ready(app: tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("Main window not found".to_string());
    };

    window
        .show()
        .map_err(|error| format!("failed to show main window: {}", error))?;
    window
        .set_focus()
        .map_err(|error| format!("failed to focus main window: {}", error))?;

    Ok(())
}
