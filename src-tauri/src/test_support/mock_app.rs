#![allow(dead_code)]

pub(crate) fn new_mock_app() -> tauri::App {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to create mock Tauri app")
}
