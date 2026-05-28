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

pub(super) fn resolve_ocr_worker_count(requested_workers: u32) -> usize {
    let available_workers = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or_else(|_| num_cpus::get().max(1));
    let physical_cores = num_cpus::get_physical().max(1);
    let worker_cap = if physical_cores >= 4 {
        (physical_cores / 2).max(1)
    } else {
        physical_cores
    };

    (requested_workers.max(1) as usize).clamp(1, worker_cap.min(available_workers).max(1))
}

pub(super) fn resolve_ocr_worker_count_for_backend(requested_workers: u32, use_gpu: bool) -> usize {
    let resolved_workers = resolve_ocr_worker_count(requested_workers);
    if use_gpu {
        resolved_workers.min(2)
    } else {
        resolved_workers
    }
}

pub(crate) fn resolve_ocr_engine_threads(worker_count: usize) -> i32 {
    let physical_cores = num_cpus::get_physical();
    let fallback_cores = num_cpus::get();
    let available_cores = physical_cores.max(fallback_cores).max(1);
    let minimum_threads = if available_cores >= 4 { 2 } else { 1 };
    let derived_threads = available_cores / worker_count.max(1);

    derived_threads.clamp(minimum_threads, 4) as i32
}

/// Create an OCR engine for the given language with specified options.
pub(crate) fn create_ocr_engine(
    models_dir: &Path,
    language: &str,
    use_gpu: bool,
    engine_threads: i32,
    enable_parallel: bool,
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

    // Create OCR engine config based on GPU option
    let config = if use_gpu {
        #[cfg(target_os = "macos")]
        {
            OcrEngineConfig::fast()
                .with_backend(Backend::Metal)
                .with_threads(engine_threads)
                .with_parallel(enable_parallel)
        }
        #[cfg(not(target_os = "macos"))]
        {
            OcrEngineConfig::fast()
                .with_backend(Backend::Vulkan)
                .with_threads(engine_threads)
                .with_parallel(enable_parallel)
        }
    } else {
        // CPU-only mode: force CPU backend to avoid platform auto-selection issues.
        OcrEngineConfig::fast()
            .with_backend(Backend::CPU)
            .with_threads(engine_threads)
            .with_parallel(enable_parallel)
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
pub(crate) fn get_ocr_models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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
    use super::{
        create_ocr_engine, get_charset_for_language, get_rec_model_for_language,
        resolve_ocr_engine_threads, resolve_ocr_worker_count, resolve_ocr_worker_count_for_backend,
    };

    #[test]
    fn language_model_mapping_returns_expected_model_file() {
        assert_eq!(
            get_rec_model_for_language("korean"),
            "korean_PP-OCRv5_mobile_rec_infer.mnn"
        );
        assert_eq!(
            get_rec_model_for_language("unknown"),
            "PP-OCRv5_mobile_rec.mnn"
        );
    }

    #[test]
    fn language_charset_mapping_returns_expected_charset_file() {
        assert_eq!(get_charset_for_language("latin"), "ppocr_keys_latin.txt");
        assert_eq!(get_charset_for_language("unknown"), "ppocr_keys_v5.txt");
    }

    #[test]
    fn create_ocr_engine_fails_when_required_models_are_missing() {
        let models_dir = tempfile::tempdir().expect("failed to create tempdir");
        let error = match create_ocr_engine(models_dir.path(), "multi", false, 1, false) {
            Ok(_) => panic!("missing detection model should fail"),
            Err(error) => error,
        };
        assert!(error.contains("Detection model not found"));
    }

    #[test]
    fn resolve_ocr_worker_count_stays_in_valid_range() {
        let workers = resolve_ocr_worker_count(0);
        assert!(workers >= 1);
        assert!(
            workers
                <= std::thread::available_parallelism()
                    .map(|value| value.get())
                    .unwrap()
        );
    }

    #[test]
    fn resolve_ocr_worker_count_caps_gpu_parallelism() {
        assert!(resolve_ocr_worker_count_for_backend(8, true) <= 2);
        assert_eq!(
            resolve_ocr_worker_count_for_backend(1, true),
            resolve_ocr_worker_count(1)
        );
    }

    #[test]
    fn resolve_ocr_engine_threads_returns_at_least_one() {
        assert!(resolve_ocr_engine_threads(1) >= 1);
        assert!(resolve_ocr_engine_threads(64) >= 1);
    }

    #[test]
    fn resolve_ocr_engine_threads_prefers_two_threads_on_multicore_hosts() {
        if num_cpus::get_physical().max(num_cpus::get()) >= 4 {
            assert!(resolve_ocr_engine_threads(64) >= 2);
        }
    }
}
