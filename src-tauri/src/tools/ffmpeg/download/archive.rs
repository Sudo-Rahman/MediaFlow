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

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::{ArchiveType, archive_type_from_url, binary_file_name, extract_archive, find_binary_path};

    #[test]
    fn archive_type_from_url_detects_supported_extensions() {
        assert!(matches!(
            archive_type_from_url("https://example.com/file.zip"),
            Ok(ArchiveType::Zip)
        ));
        assert!(matches!(
            archive_type_from_url("https://example.com/file.tar.xz"),
            Ok(ArchiveType::TarXz)
        ));
        assert!(archive_type_from_url("https://example.com/file.7z").is_err());
    }

    #[test]
    fn find_binary_path_finds_nested_binary() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let nested = dir.path().join("a").join("b");
        std::fs::create_dir_all(&nested).expect("failed to create nested dirs");
        let binary = nested.join("ffmpeg");
        std::fs::write(&binary, b"bin").expect("failed to write binary");

        let found = find_binary_path(dir.path(), "ffmpeg").expect("binary should be found");
        assert_eq!(found, binary);
    }

    #[tokio::test]
    async fn extract_archive_extracts_zip_content() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let archive = dir.path().join("sample.zip");
        let extract_dir = dir.path().join("out_zip");

        let file = std::fs::File::create(&archive).expect("failed to create zip file");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("bin/ffmpeg", zip::write::SimpleFileOptions::default())
            .expect("failed to start zip file entry");
        writer.write_all(b"binary").expect("failed to write zip content");
        writer.finish().expect("failed to finish zip file");

        extract_archive(archive, extract_dir.clone(), ArchiveType::Zip)
            .await
            .expect("zip extraction should succeed");
        assert!(extract_dir.join("bin").join("ffmpeg").exists());
    }

    #[tokio::test]
    async fn extract_archive_extracts_tar_xz_content() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let archive = dir.path().join("sample.tar.xz");
        let extract_dir = dir.path().join("out_tarz");

        let tar_file = std::fs::File::create(&archive).expect("failed to create tar.xz file");
        let encoder = xz2::write::XzEncoder::new(tar_file, 6);
        let mut builder = tar::Builder::new(encoder);

        let mut header = tar::Header::new_gnu();
        let data = b"binary";
        header.set_size(data.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        builder
            .append_data(&mut header, "bin/ffmpeg", &data[..])
            .expect("failed to append tar entry");
        let encoder = builder.into_inner().expect("failed to finalize tar builder");
        encoder.finish().expect("failed to finish xz stream");

        extract_archive(archive, extract_dir.clone(), ArchiveType::TarXz)
            .await
            .expect("tar.xz extraction should succeed");
        assert!(extract_dir.join("bin").join("ffmpeg").exists());
    }

    #[test]
    fn binary_file_name_adds_extension_on_windows_only() {
        let name = binary_file_name("ffmpeg");
        if cfg!(windows) {
            assert_eq!(name, "ffmpeg.exe");
        } else {
            assert_eq!(name, "ffmpeg");
        }
    }
}
