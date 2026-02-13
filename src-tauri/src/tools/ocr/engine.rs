use std::path::{Path, PathBuf};

use ocr_rs::{Backend, OcrEngine, OcrEngineConfig};
use tauri::Manager;

/// Default OCR models directory (relative to app resources)
pub(super) const DEFAULT_OCR_MODELS_DIR: &str = "ocr-models";

/// Model file names for PP-OCRv5
pub(super) const OCR_DET_MODEL: &str = "PP-OCRv5_mobile_det.mnn";
pub(super) const OCR_CHARSET: &str = "ppocr_keys_v5.txt";

/// Language to recognition model mapping
fn get_rec_model_for_language(language: &str) -> &'static str {
    match language {
        "multi" | "chinese" | "japanese" | "en" => "PP-OCRv5_mobile_rec.mnn",
        "korean" => "korean_PP-OCRv5_mobile_rec_infer.mnn",
        "latin" => "latin_PP-OCRv5_mobile_rec_infer.mnn",
        "cyrillic" => "cyrillic_PP-OCRv5_mobile_rec_infer.mnn",
        "arabic" => "arabic_PP-OCRv5_mobile_rec_infer.mnn",
        "devanagari" => "devanagari_PP-OCRv5_mobile_rec_infer.mnn",
        "thai" => "th_PP-OCRv5_mobile_rec_infer.mnn",
        "greek" => "el_PP-OCRv5_mobile_rec_infer.mnn",
        "tamil" => "ta_PP-OCRv5_mobile_rec_infer.mnn",
        "telugu" => "te_PP-OCRv5_mobile_rec_infer.mnn",
        _ => "PP-OCRv5_mobile_rec.mnn", // Default to multi-language
    }
}

/// Get charset file for language
fn get_charset_for_language(language: &str) -> &'static str {
    match language {
        "korean" => "ppocr_keys_korean.txt",
        "latin" => "ppocr_keys_latin.txt",
        "cyrillic" => "ppocr_keys_cyrillic.txt",
        "arabic" => "ppocr_keys_arabic.txt",
        "devanagari" => "ppocr_keys_devanagari.txt",
        "thai" => "ppocr_keys_th.txt",
        "greek" => "ppocr_keys_el.txt",
        "tamil" => "ppocr_keys_ta.txt",
        "telugu" => "ppocr_keys_te.txt",
        _ => OCR_CHARSET, // Default v5 charset
    }
}

/// Create an OCR engine for the given language with specified options
/// Thread count for MNN is fixed to num_cpus/2 for optimal performance
pub(super) fn create_ocr_engine(
    models_dir: &Path,
    language: &str,
    use_gpu: bool,
) -> Result<OcrEngine, String> {
    // Build model paths
    let det_path = models_dir.join(OCR_DET_MODEL);
    let rec_model = get_rec_model_for_language(language);
    let rec_path = models_dir.join(rec_model);
    let charset_file = get_charset_for_language(language);
    let charset_path = models_dir.join(charset_file);

    // Validate model files exist
    if !det_path.exists() {
        return Err(format!(
            "Detection model not found: {}. Please download OCR models.",
            det_path.display()
        ));
    }
    if !rec_path.exists() {
        return Err(format!(
            "Recognition model not found: {}. Please download OCR models for language '{}'.",
            rec_path.display(),
            language
        ));
    }
    if !charset_path.exists() {
        return Err(format!(
            "Charset file not found: {}. Please download OCR models.",
            charset_path.display()
        ));
    }

    // Fixed thread count for MNN: num_cpus / 2 (optimal for inference)
    let mnn_threads = std::cmp::max(1, num_cpus::get() as i32);

    // Create OCR engine config based on GPU option
    let config = if use_gpu {
        #[cfg(target_os = "macos")]
        {
            OcrEngineConfig::new()
                .with_backend(Backend::Metal)
                .with_threads(mnn_threads)
        }
        #[cfg(not(target_os = "macos"))]
        {
            OcrEngineConfig::new()
                .with_backend(Backend::Vulkan)
                .with_threads(mnn_threads)
        }
    } else {
        // CPU-only mode: force CPU backend to avoid platform auto-selection issues.
        OcrEngineConfig::new()
            .with_backend(Backend::CPU)
            .with_threads(mnn_threads)
    };

    // Create the engine
    let engine = OcrEngine::new(
        det_path.to_str().ok_or("Invalid detection model path")?,
        rec_path.to_str().ok_or("Invalid recognition model path")?,
        charset_path.to_str().ok_or("Invalid charset path")?,
        Some(config),
    )
    .map_err(|e| format!("Failed to create OCR engine: {}", e))?;

    Ok(engine)
}

/// Get the OCR models directory, checking app resources first, then user config
pub(super) fn get_ocr_models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // First, check if models are in app resources
    if let Ok(resource_dir) = app.path().resource_dir() {
        let models_dir = resource_dir.join(DEFAULT_OCR_MODELS_DIR);
        if models_dir.exists() && models_dir.is_dir() {
            return Ok(models_dir);
        }
    }

    // Check app data directory for user-downloaded models
    if let Ok(app_data) = app.path().app_data_dir() {
        let models_dir = app_data.join(DEFAULT_OCR_MODELS_DIR);
        if models_dir.exists() && models_dir.is_dir() {
            return Ok(models_dir);
        }
    }

    Err("OCR models not found. Please download the PP-OCRv5 models and place them in the app's ocr-models directory.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{create_ocr_engine, get_charset_for_language, get_rec_model_for_language};

    #[test]
    fn language_model_mapping_returns_expected_model_file() {
        assert_eq!(get_rec_model_for_language("korean"), "korean_PP-OCRv5_mobile_rec_infer.mnn");
        assert_eq!(get_rec_model_for_language("unknown"), "PP-OCRv5_mobile_rec.mnn");
    }

    #[test]
    fn language_charset_mapping_returns_expected_charset_file() {
        assert_eq!(get_charset_for_language("latin"), "ppocr_keys_latin.txt");
        assert_eq!(get_charset_for_language("unknown"), "ppocr_keys_v5.txt");
    }

    #[test]
    fn create_ocr_engine_fails_when_required_models_are_missing() {
        let models_dir = tempfile::tempdir().expect("failed to create tempdir");
        let error = match create_ocr_engine(models_dir.path(), "multi", false) {
            Ok(_) => panic!("missing detection model should fail"),
            Err(error) => error,
        };
        assert!(error.contains("Detection model not found"));
    }
}
