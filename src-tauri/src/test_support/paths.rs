#![allow(dead_code)]

use std::path::{Path, PathBuf};

pub(crate) fn new_temp_dir(prefix: &str) -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir()
        .expect("failed to create temp directory")
}

pub(crate) fn touch_file(path: &Path) -> Result<(), String> {
    std::fs::write(path, b"").map_err(|e| format!("Failed to create {}: {}", path.display(), e))
}

pub(crate) fn write_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

pub(crate) fn create_models_dir(base: &Path) -> Result<PathBuf, String> {
    let models_dir = base.join("ocr-models");
    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;
    Ok(models_dir)
}
