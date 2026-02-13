#![allow(dead_code)]

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::test_support::test_assets_manifest::{
    SAMPLE_OCR_VIDEO_MP4, SAMPLE_VIDEO_MP4, TestAsset,
};

pub(crate) fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("test-fixtures")
        .join("media")
}

pub(crate) fn asset_path(asset: &TestAsset) -> PathBuf {
    fixtures_dir().join(asset.file_name)
}

fn ensure_local_asset(asset: &TestAsset) -> Result<PathBuf, String> {
    let path = asset_path(asset);

    if !path.exists() {
        return Err(format!(
            "Missing local test fixture: {}. Expected path: {}",
            asset.file_name,
            path.display()
        ));
    }

    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to read metadata for {}: {}", path.display(), e))?;
    if metadata.len() > asset.max_size_bytes {
        return Err(format!(
            "Fixture {} is too large ({} bytes > {} bytes)",
            asset.file_name,
            metadata.len(),
            asset.max_size_bytes
        ));
    }

    verify_file_checksum(&path, asset.sha256)?;
    Ok(path)
}

pub(crate) async fn ensure_sample_video() -> Result<PathBuf, String> {
    ensure_sample_video_sync()
}

pub(crate) async fn ensure_ocr_video() -> Result<PathBuf, String> {
    ensure_ocr_video_sync()
}

pub(crate) fn ensure_sample_video_sync() -> Result<PathBuf, String> {
    ensure_local_asset(&SAMPLE_VIDEO_MP4)
}

pub(crate) fn ensure_ocr_video_sync() -> Result<PathBuf, String> {
    ensure_local_asset(&SAMPLE_OCR_VIDEO_MP4)
}

pub(crate) fn verify_file_checksum(path: &Path, expected_sha256: &str) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    verify_checksum_bytes(&bytes, expected_sha256, path.to_string_lossy().as_ref())
}

fn verify_checksum_bytes(bytes: &[u8], expected_sha256: &str, label: &str) -> Result<(), String> {
    let actual = sha256_hex(bytes);
    if actual != expected_sha256 {
        return Err(format!(
            "Checksum mismatch for {}. expected={}, actual={}",
            label, expected_sha256, actual
        ));
    }
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}
