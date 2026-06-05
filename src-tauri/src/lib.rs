mod app;
mod commands;
mod shared;
#[cfg(test)]
pub(crate) mod test_support;
mod tools;

pub use shared::ExtractionError;
pub use tools::ocr::OcrModelPaths;

pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(not(feature = "microsoft-store"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .plugin(tauri_plugin_deep_link::init())
        .setup(app::setup)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // The deep-link feature forwards matching URLs to the running instance.
        }))
        .invoke_handler(tauri::generate_handler![
            commands::ffprobe::probe_file,
            commands::ffmpeg_extract::extract_track,
            commands::ffmpeg_cancel::cancel_extract,
            commands::ffmpeg_cancel::cancel_extract_file,
            commands::fs_open_folder::open_folder,
            commands::ffmpeg_version::check_ffmpeg,
            commands::ffmpeg_version::get_ffmpeg_version,
            commands::ffmpeg_version::get_ffmpeg_info,
            commands::ffmpeg_download::download_ffmpeg,
            commands::merge::merge_tracks,
            commands::merge_cancel::cancel_merge,
            commands::merge_cancel::cancel_merge_file,
            commands::fs_file_ops::rename_file,
            commands::fs_file_ops::copy_file,
            commands::fs_cancel::cancel_copy_file,
            commands::fs_metadata::get_file_metadata,
            commands::tokens::count_tokens,
            commands::llm::llm_complete,
            commands::llm::cancel_llm_request,
            commands::translation::parse_translation_response,
            commands::mediaflow_api::open_mediaflow_sign_in,
            commands::mediaflow_api::open_mediaflow_dashboard,
            commands::mediaflow_api::exchange_mediaflow_authorization_code,
            commands::mediaflow_api::refresh_mediaflow_access_token,
            commands::mediaflow_api::fetch_mediaflow_user_info,
            commands::mediaflow_api::revoke_mediaflow_refresh_token,
            commands::mediaflow_api::fetch_mediaflow_account_usage,
            commands::sleep_inhibit::acquire_sleep_inhibit,
            commands::sleep_inhibit::release_sleep_inhibit,
            // Audio transcription commands
            commands::transcription_transcode::transcode_to_opus,
            commands::transcription_cancel::cancel_audio_transcode,
            commands::transcription_cancel::cancel_audio_transcode_file,
            commands::transcription_upload::transcribe_deepgram_audio_file,
            commands::transcription_upload::transcribe_mediaflow_audio_file,
            commands::transcription_upload::cancel_audio_transcription_upload,
            commands::data::save_mediaflow_data,
            commands::data::load_mediaflow_data,
            commands::data::delete_mediaflow_data,
            commands::data::save_transcription_data,
            commands::data::load_transcription_data,
            commands::data::delete_transcription_data,
            commands::transcription_waveform::convert_audio_for_waveform,
            // Video OCR commands
            commands::ocr_preview::transcode_for_preview,
            commands::ocr_preview::invalidate_ocr_preview,
            commands::ocr_preview::get_ocr_preview_cache_entry,
            commands::ocr_pipeline::run_ocr_pipeline,
            commands::ocr_subtitles::generate_subtitles_from_ocr,
            commands::ocr_export::export_ocr_subtitles,
            commands::subtitle_ocr_import::probe_subtitle_ocr_tracks,
            commands::subtitle_ocr_import::resolve_subtitle_ocr_vobsub_pair,
            commands::subtitle_ocr_extract::prepare_subtitle_ocr_track,
            commands::subtitle_ocr_decode::decode_subtitle_ocr_bitmaps,
            commands::subtitle_ocr_ocr::run_subtitle_ocr_pipeline,
            commands::subtitle_ocr_restore::collect_missing_subtitle_ocr_bitmap_assets,
            commands::subtitle_ocr_restore::restore_subtitle_ocr_bitmap_assets,
            commands::subtitle_ocr_export::export_subtitle_ocr_version,
            commands::subtitle_ocr_cancel::cancel_subtitle_ocr_operation,
            commands::ocr_cancel::cancel_ocr_operation,
            commands::ocr_models::check_ocr_models,
            // General transcode commands
            commands::transcode_capabilities::get_transcode_capabilities,
            commands::transcode::transcode_media,
            commands::transcode_cancel::cancel_transcode,
            commands::transcode_cancel::cancel_transcode_file,
            commands::transcode_analysis::extract_transcode_analysis_frames,
            commands::auth::store_refresh_token,
            commands::auth::get_refresh_token,
            commands::auth::delete_refresh_token
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            app::handle_run_event(app_handle, &event);
        });
}
