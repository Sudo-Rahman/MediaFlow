use std::sync::Mutex;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Dwm::{DWMWA_WINDOW_CORNER_PREFERENCE, DwmSetWindowAttribute};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{HTMAXBUTTON, WM_NCDESTROY, WM_NCHITTEST};

use super::PhysicalRect;

const MEDIAFLOW_CHROME_SUBCLASS_ID: usize = 1;
const DWMWCP_ROUND: u32 = 2;

static MAXIMIZE_BUTTON_RECT: Mutex<Option<PhysicalRect>> = Mutex::new(None);

pub(crate) fn update_maximize_button_rect(rect: PhysicalRect) -> Result<(), String> {
    let mut stored_rect = MAXIMIZE_BUTTON_RECT
        .lock()
        .map_err(|_| "window chrome state lock poisoned".to_string())?;
    *stored_rect = Some(rect);
    Ok(())
}

pub(crate) fn install_windows_chrome(window: &tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map_err(|e| format!("failed to get Windows window handle: {}", e))?;

    unsafe {
        let subclass_result = SetWindowSubclass(
            hwnd,
            Some(window_chrome_subclass_proc),
            MEDIAFLOW_CHROME_SUBCLASS_ID,
            0,
        );

        if !subclass_result.as_bool() {
            return Err("failed to install Windows chrome subclass".to_string());
        }

        let preference = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const u32 as *const _,
            std::mem::size_of::<u32>() as u32,
        );
    }

    Ok(())
}

unsafe extern "system" fn window_chrome_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    if msg == WM_NCHITTEST {
        let mut point = POINT {
            x: get_x_lparam(lparam),
            y: get_y_lparam(lparam),
        };

        if unsafe { ScreenToClient(hwnd, &mut point).as_bool() } {
            if let Ok(rect) = MAXIMIZE_BUTTON_RECT.lock() {
                if let Some(rect) = *rect {
                    if rect.contains(point.x, point.y) {
                        return LRESULT(HTMAXBUTTON as isize);
                    }
                }
            }
        }
    }

    if msg == WM_NCDESTROY {
        unsafe {
            let _ = RemoveWindowSubclass(
                hwnd,
                Some(window_chrome_subclass_proc),
                MEDIAFLOW_CHROME_SUBCLASS_ID,
            );
        }
    }

    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

fn get_x_lparam(lparam: LPARAM) -> i32 {
    (lparam.0 as i16) as i32
}

fn get_y_lparam(lparam: LPARAM) -> i32 {
    ((lparam.0 >> 16) as i16) as i32
}
