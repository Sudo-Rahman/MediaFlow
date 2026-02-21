mod app;
mod commands;
mod shared;
#[cfg(test)]
pub(crate) mod test_support;
mod tools;

pub use shared::ExtractionError;
pub use tools::ocr::OcrModelPaths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(app::setup)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::ffprobe::probe_file,
            commands::ffmpeg_extract::extract_track,
            commands::ffmpeg_cancel::cancel_extract,
            commands::ffmpeg_cancel::cancel_extract_file,
            commands::fs_open_folder::open_folder,
            commands::ffmpeg_version::check_ffmpeg,
            commands::ffmpeg_version::get_ffmpeg_version,
            commands::ffmpeg_download::download_ffmpeg,
            commands::merge::merge_tracks,
            commands::merge_cancel::cancel_merge,
            commands::merge_cancel::cancel_merge_file,
            commands::fs_file_ops::rename_file,
            commands::fs_file_ops::copy_file,
            commands::fs_metadata::get_file_metadata,
            commands::tokens::count_tokens,
            commands::sleep_inhibit::acquire_sleep_inhibit,
            commands::sleep_inhibit::release_sleep_inhibit,
            // Audio transcription commands
            commands::transcription_transcode::transcode_to_opus,
            commands::transcription_cancel::cancel_transcode,
            commands::transcription_cancel::cancel_transcode_file,
            commands::data::save_rsext_data,
            commands::data::load_rsext_data,
            commands::data::delete_rsext_data,
            commands::data::save_transcription_data,
            commands::data::load_transcription_data,
            commands::data::delete_transcription_data,
            commands::transcription_waveform::convert_audio_for_waveform,
            // Video OCR commands
            commands::ocr_preview::transcode_for_preview,
            commands::ocr_frames::extract_ocr_frames,
            commands::ocr_perform::perform_ocr,
            commands::ocr_subtitles::generate_subtitles_from_ocr,
            commands::ocr_export::export_ocr_subtitles,
            commands::ocr_cancel::cancel_ocr_operation,
            commands::ocr_frames::cleanup_ocr_frames,
            commands::ocr_models::check_ocr_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
