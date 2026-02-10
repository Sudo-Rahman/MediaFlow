#[tauri::command]
pub(crate) async fn acquire_sleep_inhibit(reason: String) -> Result<u64, String> {
    crate::shared::sleep_inhibit::acquire_sleep_inhibit(reason)
}

#[tauri::command]
pub(crate) async fn release_sleep_inhibit(token: u64) -> Result<(), String> {
    crate::shared::sleep_inhibit::release_sleep_inhibit(token)
}

