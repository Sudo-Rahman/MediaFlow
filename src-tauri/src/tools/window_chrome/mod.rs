#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "windows")]
pub(crate) fn install_windows_chrome(window: &tauri::WebviewWindow) -> Result<(), String> {
    windows::install_windows_chrome(window)
}
