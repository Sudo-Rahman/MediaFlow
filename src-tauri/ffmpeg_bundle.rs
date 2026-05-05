use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::build_support::{
    BundleSource, DOWNLOAD_ATTEMPTS, bundle_cache_marker_name, bundle_cache_version,
    retry_operation,
};

const USER_AGENT: &str = "MediaFlow/0.1.0";
const BTBN_LATEST_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/wiki/Latest";

const MAC_ARM_FFMPEG_URL: &str = "https://www.osxexperts.net/ffmpeg81arm.zip";
const MAC_ARM_FFMPEG_SHA256: &str =
    "9a08d61f9328e8164ba560ee7a79958e357307fcfeea6fe626b7d66cdc287028";
const MAC_ARM_FFPROBE_URL: &str = "https://www.osxexperts.net/ffprobe81arm.zip";
const MAC_ARM_FFPROBE_SHA256: &str =
    "aab17ac7379c1178aaf400c3ef36cdb67db0b75b1a23eeef2cb9f658be8844e6";

const MAC_INTEL_FFMPEG_URL: &str = "https://www.osxexperts.net/ffmpeg80intel.zip";
const MAC_INTEL_FFMPEG_SHA256: &str =
    "df3f1e3facdc1ae0ad0bd898cdfb072fbc9641bf47b11f172844525a05db8d11";
const MAC_INTEL_FFPROBE_URL: &str = "https://www.osxexperts.net/ffprobe80intel.zip";
const MAC_INTEL_FFPROBE_SHA256: &str =
    "5228e651e2bd67bb55819b27f6138351587b16d2b87446007bf35b7cf930d891";

type BuildResult<T> = Result<T, String>;

#[derive(Clone, Copy)]
enum ArchiveType {
    Zip,
    TarXz,
}

#[derive(Clone, Copy)]
struct MacBinarySpec {
    url: &'static str,
    sha256: &'static str,
}

enum PlatformDownload {
    Mac {
        ffmpeg: MacBinarySpec,
        ffprobe: MacBinarySpec,
    },
    Btbn {
        variant: &'static str,
        preferred_ext: &'static str,
    },
}

enum DownloadPlan {
    Mac {
        ffmpeg: MacBinarySpec,
        ffprobe: MacBinarySpec,
    },
    Btbn {
        url: String,
        archive_type: ArchiveType,
    },
}

pub(crate) fn prepare_external_binaries() -> BuildResult<()> {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=build_support.rs");
    println!("cargo:rerun-if-changed=ffmpeg_bundle.rs");
    println!("cargo:rerun-if-env-changed=MEDIAFLOW_FORCE_FFMPEG_DOWNLOAD");
    println!("cargo:rerun-if-env-changed=TARGET");

    let target = env::var("TARGET").map_err(|e| format!("TARGET is not set: {e}"))?;
    let platform = resolve_platform_download(&target)?;
    let client = http_client()?;
    let download_plan = resolve_download_plan(&client, &platform)?;

    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR")
            .map_err(|e| format!("CARGO_MANIFEST_DIR is not set: {e}"))?,
    );
    let binaries_dir = manifest_dir.join("binaries");
    fs::create_dir_all(&binaries_dir)
        .map_err(|e| format!("failed to create external binaries directory: {e}"))?;

    let ffmpeg_dest = sidecar_binary_path(&binaries_dir, "ffmpeg", &target);
    let ffprobe_dest = sidecar_binary_path(&binaries_dir, "ffprobe", &target);
    let cache_version = download_plan_cache_version(&target, &download_plan);
    println!(
        "cargo:rustc-env=MEDIAFLOW_BUNDLED_FFMPEG={}",
        ffmpeg_dest.display()
    );
    println!(
        "cargo:rustc-env=MEDIAFLOW_BUNDLED_FFPROBE={}",
        ffprobe_dest.display()
    );

    let force_download = env::var_os("MEDIAFLOW_FORCE_FFMPEG_DOWNLOAD").is_some();
    if !force_download
        && existing_binaries_are_valid(
            &download_plan,
            &binaries_dir,
            &target,
            &cache_version,
            &ffmpeg_dest,
            &ffprobe_dest,
        )?
    {
        return Ok(());
    }

    let out_dir =
        PathBuf::from(env::var("OUT_DIR").map_err(|e| format!("OUT_DIR is not set: {e}"))?);
    let work_dir = out_dir.join("ffmpeg-bundle").join(&target);
    if work_dir.exists() {
        fs::remove_dir_all(&work_dir)
            .map_err(|e| format!("failed to reset FFmpeg work directory: {e}"))?;
    }
    fs::create_dir_all(&work_dir)
        .map_err(|e| format!("failed to create FFmpeg work directory: {e}"))?;

    match &download_plan {
        DownloadPlan::Mac { ffmpeg, ffprobe } => download_macos_binaries(
            &client,
            &target,
            &work_dir,
            *ffmpeg,
            *ffprobe,
            &ffmpeg_dest,
            &ffprobe_dest,
        ),
        DownloadPlan::Btbn { url, archive_type } => download_btbn_binaries(
            &client,
            &target,
            &work_dir,
            url,
            *archive_type,
            &ffmpeg_dest,
            &ffprobe_dest,
        ),
    }?;

    write_bundle_cache_marker(&binaries_dir, &target, &cache_version)?;
    Ok(())
}

fn resolve_platform_download(target: &str) -> BuildResult<PlatformDownload> {
    match target {
        "aarch64-apple-darwin" => Ok(PlatformDownload::Mac {
            ffmpeg: MacBinarySpec {
                url: MAC_ARM_FFMPEG_URL,
                sha256: MAC_ARM_FFMPEG_SHA256,
            },
            ffprobe: MacBinarySpec {
                url: MAC_ARM_FFPROBE_URL,
                sha256: MAC_ARM_FFPROBE_SHA256,
            },
        }),
        "x86_64-apple-darwin" => Ok(PlatformDownload::Mac {
            ffmpeg: MacBinarySpec {
                url: MAC_INTEL_FFMPEG_URL,
                sha256: MAC_INTEL_FFMPEG_SHA256,
            },
            ffprobe: MacBinarySpec {
                url: MAC_INTEL_FFPROBE_URL,
                sha256: MAC_INTEL_FFPROBE_SHA256,
            },
        }),
        "x86_64-pc-windows-msvc" => Ok(PlatformDownload::Btbn {
            variant: "win64-gpl-8.1",
            preferred_ext: ".zip",
        }),
        "aarch64-pc-windows-msvc" => Ok(PlatformDownload::Btbn {
            variant: "winarm64-gpl-8.1",
            preferred_ext: ".zip",
        }),
        "x86_64-unknown-linux-gnu" => Ok(PlatformDownload::Btbn {
            variant: "linux64-gpl-8.1",
            preferred_ext: ".tar.xz",
        }),
        "aarch64-unknown-linux-gnu" => Ok(PlatformDownload::Btbn {
            variant: "linuxarm64-gpl-8.1",
            preferred_ext: ".tar.xz",
        }),
        _ => Err(format!("unsupported FFmpeg bundle target: {target}")),
    }
}

fn existing_binaries_are_valid(
    download_plan: &DownloadPlan,
    binaries_dir: &Path,
    target: &str,
    cache_version: &str,
    ffmpeg_dest: &Path,
    ffprobe_dest: &Path,
) -> BuildResult<bool> {
    if !ffmpeg_dest.is_file() || !ffprobe_dest.is_file() {
        return Ok(false);
    }

    if !bundle_cache_marker_matches(binaries_dir, target, cache_version)? {
        return Ok(false);
    }

    match download_plan {
        DownloadPlan::Mac { ffmpeg, ffprobe } => {
            Ok(checksum_marker_matches(ffmpeg_dest, ffmpeg.sha256)?
                && checksum_marker_matches(ffprobe_dest, ffprobe.sha256)?)
        }
        DownloadPlan::Btbn { .. } => Ok(true),
    }
}

fn resolve_download_plan(
    client: &reqwest::blocking::Client,
    platform: &PlatformDownload,
) -> BuildResult<DownloadPlan> {
    match platform {
        PlatformDownload::Mac { ffmpeg, ffprobe } => Ok(DownloadPlan::Mac {
            ffmpeg: *ffmpeg,
            ffprobe: *ffprobe,
        }),
        PlatformDownload::Btbn {
            variant,
            preferred_ext,
        } => {
            let page = fetch_btbn_build_list(client)?;
            let url = find_btbn_url(&page, variant, preferred_ext, ".zip")
                .ok_or_else(|| format!("failed to locate FFmpeg build for {variant}"))?;
            let archive_type = archive_type_from_url(&url)?;

            Ok(DownloadPlan::Btbn { url, archive_type })
        }
    }
}

fn download_plan_cache_version(target: &str, download_plan: &DownloadPlan) -> String {
    match download_plan {
        DownloadPlan::Mac { ffmpeg, ffprobe } => bundle_cache_version(
            target,
            &[
                BundleSource {
                    name: "ffmpeg",
                    source: ffmpeg.url,
                    checksum: Some(ffmpeg.sha256),
                },
                BundleSource {
                    name: "ffprobe",
                    source: ffprobe.url,
                    checksum: Some(ffprobe.sha256),
                },
            ],
        ),
        DownloadPlan::Btbn { url, .. } => bundle_cache_version(
            target,
            &[BundleSource {
                name: "btbn_release",
                source: url,
                checksum: None,
            }],
        ),
    }
}

fn download_macos_binaries(
    client: &reqwest::blocking::Client,
    target: &str,
    work_dir: &Path,
    ffmpeg: MacBinarySpec,
    ffprobe: MacBinarySpec,
    ffmpeg_dest: &Path,
    ffprobe_dest: &Path,
) -> BuildResult<()> {
    let ffmpeg_archive = work_dir.join("ffmpeg.zip");
    let ffprobe_archive = work_dir.join("ffprobe.zip");
    download_file(client, ffmpeg.url, &ffmpeg_archive)?;
    download_file(client, ffprobe.url, &ffprobe_archive)?;

    let ffmpeg_extract_dir = work_dir.join("ffmpeg");
    let ffprobe_extract_dir = work_dir.join("ffprobe");
    extract_archive(&ffmpeg_archive, &ffmpeg_extract_dir, ArchiveType::Zip)?;
    extract_archive(&ffprobe_archive, &ffprobe_extract_dir, ArchiveType::Zip)?;

    let ffmpeg_src = find_binary_path(&ffmpeg_extract_dir, &binary_file_name("ffmpeg", target))?;
    let ffprobe_src = find_binary_path(&ffprobe_extract_dir, &binary_file_name("ffprobe", target))?;
    verify_file_sha256(&ffmpeg_src, ffmpeg.sha256)?;
    verify_file_sha256(&ffprobe_src, ffprobe.sha256)?;

    copy_binary(&ffmpeg_src, ffmpeg_dest, target)?;
    copy_binary(&ffprobe_src, ffprobe_dest, target)?;
    write_checksum_marker(ffmpeg_dest, ffmpeg.sha256)?;
    write_checksum_marker(ffprobe_dest, ffprobe.sha256)?;
    Ok(())
}

fn download_btbn_binaries(
    client: &reqwest::blocking::Client,
    target: &str,
    work_dir: &Path,
    url: &str,
    archive_type: ArchiveType,
    ffmpeg_dest: &Path,
    ffprobe_dest: &Path,
) -> BuildResult<()> {
    let archive_path = match archive_type {
        ArchiveType::Zip => work_dir.join("ffmpeg.zip"),
        ArchiveType::TarXz => work_dir.join("ffmpeg.tar.xz"),
    };

    download_file(client, url, &archive_path)?;

    let extract_dir = work_dir.join("extracted");
    extract_archive(&archive_path, &extract_dir, archive_type)?;

    let ffmpeg_src = find_binary_path(&extract_dir, &binary_file_name("ffmpeg", target))?;
    let ffprobe_src = find_binary_path(&extract_dir, &binary_file_name("ffprobe", target))?;

    copy_binary(&ffmpeg_src, ffmpeg_dest, target)?;
    copy_binary(&ffprobe_src, ffprobe_dest, target)?;
    Ok(())
}

fn http_client() -> BuildResult<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to create HTTP client: {e}"))
}

fn fetch_btbn_build_list(client: &reqwest::blocking::Client) -> BuildResult<String> {
    retry_operation(DOWNLOAD_ATTEMPTS, |attempt| {
        if attempt == 1 {
            println!("cargo:warning=Fetching {BTBN_LATEST_URL}");
        } else {
            println!("cargo:warning=Retrying {BTBN_LATEST_URL} ({attempt}/{DOWNLOAD_ATTEMPTS})");
        }

        client
            .get(BTBN_LATEST_URL)
            .send()
            .map_err(|e| format!("failed to fetch FFmpeg build list: {e}"))?
            .error_for_status()
            .map_err(|e| format!("failed to fetch FFmpeg build list: {e}"))?
            .text()
            .map_err(|e| format!("failed to read FFmpeg build list: {e}"))
    })
    .map_err(|e| {
        format!("failed to fetch FFmpeg build list after {DOWNLOAD_ATTEMPTS} attempts: {e}")
    })
}

fn download_file(client: &reqwest::blocking::Client, url: &str, dest: &Path) -> BuildResult<()> {
    retry_operation(DOWNLOAD_ATTEMPTS, |attempt| {
        if attempt == 1 {
            println!("cargo:warning=Downloading {url}");
        } else {
            println!("cargo:warning=Retrying {url} ({attempt}/{DOWNLOAD_ATTEMPTS})");
        }

        let result = download_file_once(client, url, dest);
        if let Err(error) = &result
            && attempt < DOWNLOAD_ATTEMPTS
        {
            println!(
                "cargo:warning=Download attempt {attempt}/{DOWNLOAD_ATTEMPTS} failed for {url}: {error}"
            );
        }

        result
    })
    .map_err(|e| format!("failed to download {url} after {DOWNLOAD_ATTEMPTS} attempts: {e}"))
}

fn download_file_once(
    client: &reqwest::blocking::Client,
    url: &str,
    dest: &Path,
) -> BuildResult<()> {
    let mut response = client
        .get(url)
        .send()
        .map_err(|e| format!("failed to download {url}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("failed to download {url}: {e}"))?;
    let mut file =
        fs::File::create(dest).map_err(|e| format!("failed to create {}: {e}", dest.display()))?;
    io::copy(&mut response, &mut file)
        .map_err(|e| format!("failed to write {}: {e}", dest.display()))?;
    Ok(())
}

fn extract_archive(
    archive_path: &Path,
    extract_dir: &Path,
    archive_type: ArchiveType,
) -> BuildResult<()> {
    fs::create_dir_all(extract_dir)
        .map_err(|e| format!("failed to create extract directory: {e}"))?;

    match archive_type {
        ArchiveType::Zip => {
            let file = fs::File::open(archive_path).map_err(|e| {
                format!("failed to open zip archive {}: {e}", archive_path.display())
            })?;
            let mut archive = zip::ZipArchive::new(file)
                .map_err(|e| format!("failed to read zip archive: {e}"))?;
            archive
                .extract(extract_dir)
                .map_err(|e| format!("failed to extract zip archive: {e}"))?;
        }
        ArchiveType::TarXz => {
            let file = fs::File::open(archive_path).map_err(|e| {
                format!(
                    "failed to open tar.xz archive {}: {e}",
                    archive_path.display()
                )
            })?;
            let decompressor = xz2::read::XzDecoder::new(file);
            let mut archive = tar::Archive::new(decompressor);
            archive
                .unpack(extract_dir)
                .map_err(|e| format!("failed to extract tar.xz archive: {e}"))?;
        }
    }

    Ok(())
}

fn find_binary_path(root: &Path, binary_name: &str) -> BuildResult<PathBuf> {
    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        if entry.file_type().is_file() && entry.file_name().to_string_lossy() == binary_name {
            return Ok(entry.path().to_path_buf());
        }
    }

    Err(format!(
        "failed to locate {binary_name} in extracted archive at {}",
        root.display()
    ))
}

fn copy_binary(src: &Path, dest: &Path, target: &str) -> BuildResult<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create binary output directory: {e}"))?;
    }
    if dest.exists() {
        fs::remove_file(dest)
            .map_err(|e| format!("failed to replace existing {}: {e}", dest.display()))?;
    }
    fs::copy(src, dest).map_err(|e| {
        format!(
            "failed to copy {} to {}: {e}",
            src.display(),
            dest.display()
        )
    })?;

    set_executable_permissions(dest, target)?;
    prepare_macos_binary(dest, target);
    Ok(())
}

fn set_executable_permissions(path: &Path, target: &str) -> BuildResult<()> {
    if target.contains("windows") {
        return Ok(());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)
            .map_err(|e| format!("failed to read permissions for {}: {e}", path.display()))?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).map_err(|e| {
            format!(
                "failed to set executable permissions on {}: {e}",
                path.display()
            )
        })?;
    }

    Ok(())
}

fn prepare_macos_binary(path: &Path, target: &str) {
    if !target.contains("apple-darwin") {
        return;
    }

    let _ = Command::new("xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(path)
        .status();
    let _ = Command::new("codesign")
        .args(["--force", "--sign", "-"])
        .arg(path)
        .status();
}

fn archive_type_from_url(url: &str) -> BuildResult<ArchiveType> {
    if url.ends_with(".zip") {
        Ok(ArchiveType::Zip)
    } else if url.ends_with(".tar.xz") {
        Ok(ArchiveType::TarXz)
    } else {
        Err(format!("unsupported archive type: {url}"))
    }
}

fn find_btbn_url(
    page: &str,
    variant: &str,
    preferred_ext: &str,
    fallback_ext: &str,
) -> Option<String> {
    find_btbn_url_with_ext(page, variant, preferred_ext)
        .or_else(|| find_btbn_url_with_ext(page, variant, fallback_ext))
}

fn find_btbn_url_with_ext(page: &str, variant: &str, ext: &str) -> Option<String> {
    for token in page.split('"') {
        if !token.contains("releases/download/") {
            continue;
        }
        if !token.contains(variant) || !token.ends_with(ext) {
            continue;
        }
        if token.starts_with("http") {
            return Some(token.to_string());
        }
        if token.starts_with('/') {
            return Some(format!("https://github.com{token}"));
        }
    }
    None
}

fn sidecar_binary_path(binaries_dir: &Path, base: &str, target: &str) -> PathBuf {
    let extension = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    binaries_dir.join(format!("{base}-{target}{extension}"))
}

fn binary_file_name(base: &str, target: &str) -> String {
    if target.contains("windows") {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn verify_file_sha256(path: &Path, expected: &str) -> BuildResult<()> {
    let actual = file_sha256(path)?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "checksum mismatch for {}: expected {expected}, got {actual}",
            path.display()
        ))
    }
}

fn file_sha256(path: &Path) -> BuildResult<String> {
    let bytes = fs::read(path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    let digest = Sha256::digest(bytes);
    Ok(format!("{digest:x}"))
}

fn checksum_marker_matches(binary_path: &Path, expected: &str) -> BuildResult<bool> {
    let marker_path = checksum_marker_path(binary_path)?;
    if !marker_path.is_file() {
        return Ok(false);
    }

    let actual = fs::read_to_string(&marker_path)
        .map_err(|e| format!("failed to read {}: {e}", marker_path.display()))?;
    Ok(actual.trim() == expected)
}

fn write_checksum_marker(binary_path: &Path, checksum: &str) -> BuildResult<()> {
    let marker_path = checksum_marker_path(binary_path)?;
    fs::write(&marker_path, format!("{checksum}\n"))
        .map_err(|e| format!("failed to write {}: {e}", marker_path.display()))
}

fn bundle_cache_marker_matches(
    binaries_dir: &Path,
    target: &str,
    expected: &str,
) -> BuildResult<bool> {
    let marker_path = binaries_dir.join(bundle_cache_marker_name(target));
    if !marker_path.is_file() {
        return Ok(false);
    }

    let actual = fs::read_to_string(&marker_path)
        .map_err(|e| format!("failed to read {}: {e}", marker_path.display()))?;
    Ok(actual == expected)
}

fn write_bundle_cache_marker(binaries_dir: &Path, target: &str, version: &str) -> BuildResult<()> {
    let marker_path = binaries_dir.join(bundle_cache_marker_name(target));
    fs::write(&marker_path, version)
        .map_err(|e| format!("failed to write {}: {e}", marker_path.display()))
}

fn checksum_marker_path(binary_path: &Path) -> BuildResult<PathBuf> {
    let file_name = binary_path
        .file_name()
        .ok_or_else(|| format!("binary path has no file name: {}", binary_path.display()))?
        .to_string_lossy();
    Ok(binary_path.with_file_name(format!("{file_name}.source.sha256")))
}
