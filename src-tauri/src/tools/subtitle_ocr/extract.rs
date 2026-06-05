use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tauri::Emitter;

use crate::shared::process::{terminate_process, tokio_command, wait_with_output_timeout};
use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::shared::store::resolve_ffmpeg_path;
use crate::shared::validation::{validate_media_path, validate_output_path};
use crate::tools::subtitle_ocr::progress::SubtitleOcrProgressEvent;

const SUBTITLE_OCR_EXTRACT_TIMEOUT: Duration = Duration::from_secs(300);
const SUBTITLE_OCR_CANCELLED: &str = "Subtitle OCR operation cancelled";
const VOBSUB_CONTAINER_EXTRACTION_UNSUPPORTED: &str = "Container VobSub extraction is not supported by the bundled FFmpeg path. Import the .idx/.sub pair directly.";

#[tauri::command]
pub(crate) async fn prepare_subtitle_ocr_track(
    app: tauri::AppHandle,
    input_path: String,
    stream_index: u32,
    codec: String,
    item_id: String,
    run_id: String,
) -> Result<String, String> {
    validate_media_path(&input_path)?;
    validate_item_id(&item_id)?;
    validate_run_id(&run_id)?;
    ensure_container_extraction_supported(&codec)?;
    let _sleep_guard = SleepInhibitGuard::try_acquire("Subtitle OCR extraction").ok();
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let output_path = subtitle_ocr_temp_output_path(&input_path, stream_index, &codec, &item_id)?;
    let sidecar_path = vobsub_sidecar_path(&output_path, &codec);
    let mut registered_paths = vec![output_path.to_string_lossy().to_string()];
    if let Some(sidecar_path) = sidecar_path.as_ref() {
        registered_paths.push(sidecar_path.to_string_lossy().to_string());
    }

    super::state::begin_operation(&item_id, &run_id)?;
    let result = async {
        if super::state::register_output_paths(&item_id, &run_id, registered_paths)? {
            return Err(SUBTITLE_OCR_CANCELLED.to_string());
        }

        run_prepare_subtitle_ocr_ffmpeg(
            &app,
            &ffmpeg_path,
            &input_path,
            &output_path,
            stream_index,
            &codec,
            &item_id,
            &run_id,
        )
        .await?;

        if let Some(sidecar_path) = sidecar_path.as_ref() {
            if !sidecar_path.exists() {
                return Err(format!(
                    "Expected VobSub .sub sidecar not found after extraction: {}",
                    sidecar_path.display()
                ));
            }
        }

        if super::state::is_operation_cancelled(&item_id, &run_id) {
            return Err(SUBTITLE_OCR_CANCELLED.to_string());
        }

        Ok(())
    }
    .await;

    if result.is_err() {
        remove_registered_outputs(&item_id, &run_id);
    }
    let _ = super::state::clear_registered_operation(&item_id, &run_id);
    if result.is_ok() {
        let _ = super::state::clear_cancelled(&item_id, &run_id);
    }
    result?;
    Ok(output_path.to_string_lossy().to_string())
}

async fn run_prepare_subtitle_ocr_ffmpeg(
    app: &tauri::AppHandle,
    ffmpeg_path: &str,
    input_path: &str,
    output_path: &Path,
    stream_index: u32,
    codec: &str,
    item_id: &str,
    run_id: &str,
) -> Result<(), String> {
    validate_output_path(output_path.to_string_lossy().as_ref())?;
    let output_path_string = output_path.to_string_lossy().to_string();
    let args =
        build_prepare_subtitle_ocr_args(input_path, &output_path_string, stream_index, codec)?;

    emit_extract_progress(app, item_id, run_id, 0);

    let child = tokio_command(ffmpeg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to execute ffmpeg: {}. Make sure FFmpeg is installed.",
                e
            )
        })?;

    if let Some(pid) = child.id() {
        if super::state::register_operation_pid(item_id, run_id, pid)? {
            if let Some(pid) = super::state::take_operation_pid(item_id, run_id)? {
                terminate_process(pid);
            }
            return Err(SUBTITLE_OCR_CANCELLED.to_string());
        }
    } else if super::state::is_operation_cancelled(item_id, run_id) {
        return Err(SUBTITLE_OCR_CANCELLED.to_string());
    }

    let output = match wait_with_output_timeout(
        child,
        "Subtitle OCR FFmpeg extraction",
        SUBTITLE_OCR_EXTRACT_TIMEOUT,
    )
    .await
    {
        Ok(output) => output,
        Err(error) => {
            if let Some(pid) = super::state::take_operation_pid(item_id, run_id)? {
                terminate_process(pid);
            }
            return Err(error);
        }
    };

    let _ = super::state::take_operation_pid(item_id, run_id)?;

    if super::state::is_operation_cancelled(item_id, run_id) {
        return Err(SUBTITLE_OCR_CANCELLED.to_string());
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Subtitle OCR extraction failed: {}", stderr));
    }

    emit_extract_progress(app, item_id, run_id, 1);
    Ok(())
}

fn remove_registered_outputs(item_id: &str, run_id: &str) {
    if let Ok(paths) = super::state::take_output_paths(item_id, run_id) {
        for path in paths {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn emit_extract_progress(app: &tauri::AppHandle, item_id: &str, run_id: &str, current: u32) {
    let _ = app.emit(
        "subtitle-ocr-progress",
        SubtitleOcrProgressEvent::new(item_id, run_id, "extracting", current, 1),
    );
}

pub(super) fn subtitle_ocr_extension_for_codec(codec: &str) -> Option<&'static str> {
    match codec.to_ascii_lowercase().as_str() {
        "hdmv_pgs_subtitle" | "pgs" => Some("sup"),
        _ => None,
    }
}

pub(super) fn build_prepare_subtitle_ocr_args(
    input_path: &str,
    output_path: &str,
    stream_index: u32,
    codec: &str,
) -> Result<Vec<String>, String> {
    ensure_container_extraction_supported(codec)?;
    subtitle_ocr_extension_for_codec(codec)
        .ok_or_else(|| format!("Unsupported Subtitle OCR codec: {}", codec))?;

    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string(),
        "-map".to_string(),
        format!("0:{}", stream_index),
        "-c:s".to_string(),
        "copy".to_string(),
    ];

    args.push(output_path.to_string());
    Ok(args)
}

fn ensure_container_extraction_supported(codec: &str) -> Result<(), String> {
    if codec.eq_ignore_ascii_case("dvd_subtitle") {
        Err(VOBSUB_CONTAINER_EXTRACTION_UNSUPPORTED.to_string())
    } else {
        Ok(())
    }
}

fn subtitle_ocr_temp_output_path(
    input_path: &str,
    stream_index: u32,
    codec: &str,
    item_id: &str,
) -> Result<PathBuf, String> {
    let extension = subtitle_ocr_extension_for_codec(codec)
        .ok_or_else(|| format!("Unsupported Subtitle OCR codec: {}", codec))?;
    let dir = std::env::temp_dir().join("MediaFlow").join("subtitle-ocr");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create Subtitle OCR temp directory: {}", e))?;
    let input_hash = crate::shared::hash::stable_hash64(input_path);
    let filename = format!(
        "{}-{:016x}-stream-{}.{}",
        sanitize_file_component(item_id),
        input_hash,
        stream_index,
        extension
    );
    Ok(dir.join(filename))
}

fn sanitize_file_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    if sanitized.is_empty() {
        "item".to_string()
    } else {
        sanitized
    }
}

fn validate_item_id(item_id: &str) -> Result<(), String> {
    if item_id.trim().is_empty() {
        Err("Subtitle OCR item id is required".to_string())
    } else {
        Ok(())
    }
}

fn validate_run_id(run_id: &str) -> Result<(), String> {
    if run_id.trim().is_empty() {
        Err("Subtitle OCR run id is required".to_string())
    } else {
        Ok(())
    }
}

fn vobsub_sidecar_path(output_path: &Path, codec: &str) -> Option<PathBuf> {
    codec
        .eq_ignore_ascii_case("dvd_subtitle")
        .then(|| output_path.with_extension("sub"))
}

#[cfg(test)]
mod tests {
    use super::{build_prepare_subtitle_ocr_args, subtitle_ocr_extension_for_codec};

    #[test]
    fn subtitle_ocr_extension_for_codec_maps_pgs_only() {
        assert_eq!(
            subtitle_ocr_extension_for_codec("hdmv_pgs_subtitle"),
            Some("sup")
        );
        assert_eq!(subtitle_ocr_extension_for_codec("pgs"), Some("sup"));
        assert_eq!(subtitle_ocr_extension_for_codec("dvd_subtitle"), None);
    }

    #[test]
    fn build_prepare_subtitle_ocr_args_extracts_selected_stream() {
        let args = build_prepare_subtitle_ocr_args(
            "/media/input.mkv",
            "/tmp/item-stream-2.sup",
            2,
            "hdmv_pgs_subtitle",
        )
        .expect("args should build");

        assert_eq!(
            args,
            vec![
                "-y",
                "-i",
                "/media/input.mkv",
                "-map",
                "0:2",
                "-c:s",
                "copy",
                "/tmp/item-stream-2.sup"
            ]
        );
    }

    #[test]
    fn build_prepare_subtitle_ocr_args_rejects_dvd_subtitle_container_extraction() {
        let error = build_prepare_subtitle_ocr_args(
            "/media/input.mkv",
            "/tmp/item-stream-3.idx",
            3,
            "dvd_subtitle",
        )
        .expect_err("container VobSub extraction should be unsupported");

        assert_eq!(
            error,
            "Container VobSub extraction is not supported by the bundled FFmpeg path. Import the .idx/.sub pair directly."
        );
    }
}
