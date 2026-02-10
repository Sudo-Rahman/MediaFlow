use std::path::Path;

/// Save shared rsext data to .rsext.json file
#[tauri::command]
pub(crate) async fn save_rsext_data(media_path: String, data: String) -> Result<(), String> {
    let json_path = get_rsext_data_path(&media_path);

    std::fs::write(&json_path, &data).map_err(|e| format!("Failed to save rsext data: {}", e))?;

    Ok(())
}

/// Load shared rsext data from .rsext.json file
#[tauri::command]
pub(crate) async fn load_rsext_data(media_path: String) -> Result<Option<String>, String> {
    let json_path = get_rsext_data_path(&media_path);

    if !Path::new(&json_path).exists() {
        return Ok(None);
    }

    let data = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Failed to read rsext data: {}", e))?;

    Ok(Some(data))
}

/// Delete shared rsext data file
#[tauri::command]
pub(crate) async fn delete_rsext_data(media_path: String) -> Result<(), String> {
    let json_path = get_rsext_data_path(&media_path);

    if Path::new(&json_path).exists() {
        std::fs::remove_file(&json_path)
            .map_err(|e| format!("Failed to delete rsext data: {}", e))?;
    }

    Ok(())
}

/// Save transcription data to .rsext.json file
#[tauri::command]
pub(crate) async fn save_transcription_data(
    audio_path: String,
    data: String,
) -> Result<(), String> {
    save_rsext_data(audio_path, data).await
}

/// Load transcription data from .rsext.json file
#[tauri::command]
pub(crate) async fn load_transcription_data(audio_path: String) -> Result<Option<String>, String> {
    load_rsext_data(audio_path).await
}

/// Delete transcription data file
#[tauri::command]
pub(crate) async fn delete_transcription_data(audio_path: String) -> Result<(), String> {
    delete_rsext_data(audio_path).await
}

/// Get the path for transcription data JSON file
fn get_rsext_data_path(media_path: &str) -> String {
    let path = Path::new(media_path);
    let parent = path.parent().unwrap_or(Path::new("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("media");

    parent
        .join(format!("{}.rsext.json", stem))
        .to_string_lossy()
        .to_string()
}
