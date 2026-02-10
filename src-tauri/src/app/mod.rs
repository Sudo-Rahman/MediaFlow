#[cfg(target_os = "macos")]
use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    create_main_window(handle);
    Ok(())
}

pub(crate) fn create_main_window(app: tauri::AppHandle) {
    let window = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App("".into()))
        .title("")
        .inner_size(1200.0, 600.0)
        .min_inner_size(1200.0, 600.0)
        .center();

    #[cfg(target_os = "macos")]
    let window = window
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .shadow(true)
        .transparent(true)
        .traffic_light_position(tauri::Position::Logical(tauri::LogicalPosition {
            x: 20.0,
            y: 30.0,
        }));

    let window = window.build().unwrap();

    #[cfg(target_os = "macos")]
    apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, Some(25.0))
        .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");
}
