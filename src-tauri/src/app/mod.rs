#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSView, NSWindow};
#[cfg(target_os = "macos")]
use objc2_core_foundation::CGFloat;
use tauri::Manager;

#[cfg(target_os = "macos")]
const WINDOW_CORNER_RADIUS: CGFloat = 25.0;

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(any(windows, target_os = "linux"))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        app.deep_link().register_all()?;
    }

    let handle = app.handle().clone();
    create_main_window(handle);
    Ok(())
}

pub(crate) fn handle_run_event(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Opened { urls } = event {
        use tauri::Emitter;

        show_main_window(app);

        let urls = urls.iter().map(ToString::to_string).collect::<Vec<_>>();
        let _ = app.emit("mediaflow://oauth-callback", urls);
    }
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

    #[cfg(target_os = "macos")]
    let window = window.build().unwrap();

    #[cfg(target_os = "macos")]
    configure_macos_window_shape(&window);

    #[cfg(not(target_os = "macos"))]
    let _window = window.build().unwrap();
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    } else {
        create_main_window(app.clone());
    }
}

#[cfg(target_os = "macos")]
fn configure_macos_window_shape(window: &tauri::WebviewWindow) {
    let Ok(ns_window_ptr) = window.ns_window() else {
        return;
    };
    let Ok(ns_view_ptr) = window.ns_view() else {
        return;
    };

    unsafe {
        let ns_window = &*ns_window_ptr.cast::<NSWindow>();
        let ns_view = &*ns_view_ptr.cast::<NSView>();

        ns_window.setOpaque(false);
        ns_window.setBackgroundColor(Some(&NSColor::clearColor()));

        apply_rounded_mask(ns_view);

        if let Some(content_view) = ns_window.contentView() {
            apply_rounded_mask(&content_view);

            if let Some(frame_view) = content_view.superview() {
                apply_rounded_mask(&frame_view);
            }
        }

        if let Some(webview_container) = ns_view.superview() {
            apply_rounded_mask(&webview_container);
        }
    }
}

#[cfg(target_os = "macos")]
fn apply_rounded_mask(view: &NSView) {
    view.setWantsLayer(true);
    if let Some(layer) = view.layer() {
        layer.setCornerRadius(WINDOW_CORNER_RADIUS);
        layer.setMasksToBounds(true);
    }
}
