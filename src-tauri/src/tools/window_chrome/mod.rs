use serde::Deserialize;

#[cfg(not(target_os = "windows"))]
mod non_windows;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(not(target_os = "windows"))]
use non_windows as platform;
#[cfg(target_os = "windows")]
use windows as platform;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowControlRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PhysicalRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl PhysicalRect {
    pub(crate) fn contains(self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
}

pub(crate) fn to_physical_rect(rect: WindowControlRect) -> Result<PhysicalRect, String> {
    if !rect.x.is_finite()
        || !rect.y.is_finite()
        || !rect.width.is_finite()
        || !rect.height.is_finite()
        || !rect.scale_factor.is_finite()
    {
        return Err("window control rectangle contains a non-finite value".to_string());
    }

    if rect.width <= 0.0 || rect.height <= 0.0 {
        return Err("window control rectangle must have positive dimensions".to_string());
    }

    if rect.scale_factor <= 0.0 {
        return Err("window control rectangle scale factor must be positive".to_string());
    }

    let left = (rect.x * rect.scale_factor).round() as i32;
    let top = (rect.y * rect.scale_factor).round() as i32;
    let right = ((rect.x + rect.width) * rect.scale_factor).round() as i32;
    let bottom = ((rect.y + rect.height) * rect.scale_factor).round() as i32;

    if right <= left || bottom <= top {
        return Err("window control rectangle collapsed after scaling".to_string());
    }

    Ok(PhysicalRect {
        left,
        top,
        right,
        bottom,
    })
}

#[tauri::command]
pub fn update_windows_maximize_button_rect(rect: WindowControlRect) -> Result<(), String> {
    platform::update_maximize_button_rect(to_physical_rect(rect)?)
}

#[tauri::command]
pub fn show_windows_snap_overlay() -> Result<(), String> {
    platform::show_snap_overlay()
}

#[cfg(target_os = "windows")]
pub(crate) fn install_windows_chrome(window: &tauri::WebviewWindow) -> Result<(), String> {
    platform::install_windows_chrome(window)
}

#[cfg(test)]
mod tests {
    use super::{PhysicalRect, WindowControlRect, to_physical_rect};

    #[test]
    fn scales_logical_rect_to_physical_rect() {
        let rect = to_physical_rect(WindowControlRect {
            x: 10.0,
            y: 20.0,
            width: 46.0,
            height: 32.0,
            scale_factor: 1.5,
        })
        .expect("rect should scale");

        assert_eq!(
            rect,
            PhysicalRect {
                left: 15,
                top: 30,
                right: 84,
                bottom: 78,
            }
        );
    }

    #[test]
    fn hit_test_uses_half_open_edges() {
        let rect = PhysicalRect {
            left: 10,
            top: 20,
            right: 56,
            bottom: 52,
        };

        assert!(rect.contains(10, 20));
        assert!(rect.contains(55, 51));
        assert!(!rect.contains(56, 51));
        assert!(!rect.contains(55, 52));
    }

    #[test]
    fn rejects_invalid_rectangles() {
        let result = to_physical_rect(WindowControlRect {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 32.0,
            scale_factor: 1.0,
        });

        assert!(result.is_err());
    }
}
