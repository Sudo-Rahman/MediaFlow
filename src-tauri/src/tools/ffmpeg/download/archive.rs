use std::path::{Path, PathBuf};

use walkdir::WalkDir;

#[derive(Clone, Copy)]
pub(super) enum ArchiveType {
    Zip,
    TarXz,
}

pub(super) fn binary_file_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{}.exe", base)
    } else {
        base.to_string()
    }
}

pub(super) fn archive_type_from_url(url: &str) -> Result<ArchiveType, String> {
    if url.ends_with(".zip") {
        Ok(ArchiveType::Zip)
    } else if url.ends_with(".tar.xz") {
        Ok(ArchiveType::TarXz)
    } else {
        Err(format!("Unsupported archive type: {}", url))
    }
}

pub(super) async fn extract_archive(
    archive_path: PathBuf,
    extract_dir: PathBuf,
    archive_type: ArchiveType,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(&extract_dir)
            .map_err(|e| format!("Failed to create extract directory: {}", e))?;

        match archive_type {
            ArchiveType::Zip => {
                let file = std::fs::File::open(&archive_path)
                    .map_err(|e| format!("Failed to open zip archive: {}", e))?;
                let mut archive = zip::ZipArchive::new(file)
                    .map_err(|e| format!("Failed to read zip archive: {}", e))?;
                archive
                    .extract(&extract_dir)
                    .map_err(|e| format!("Failed to extract zip archive: {}", e))?;
            }
            ArchiveType::TarXz => {
                let file = std::fs::File::open(&archive_path)
                    .map_err(|e| format!("Failed to open tar.xz archive: {}", e))?;
                let decompressor = xz2::read::XzDecoder::new(file);
                let mut archive = tar::Archive::new(decompressor);
                archive
                    .unpack(&extract_dir)
                    .map_err(|e| format!("Failed to extract tar.xz archive: {}", e))?;
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Failed to extract archive: {}", e))?
}

pub(super) fn find_binary_path(root: &Path, binary_name: &str) -> Result<PathBuf, String> {
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.file_name().to_string_lossy() == binary_name {
            return Ok(entry.path().to_path_buf());
        }
    }

    Err(format!(
        "Failed to locate {} in extracted archive",
        binary_name
    ))
}
