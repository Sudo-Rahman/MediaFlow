use tauri::Manager;

use crate::tools::ocr::OcrModelsStatus;

const REQUIRED_MODELS: &[(&str, &str)] = &[
    (super::engine::OCR_DET_MODEL, "detection"),
    ("PP-OCRv5_mobile_rec.mnn", "multi"),
];

const LANGUAGE_MODELS: &[(&str, &str, &str)] = &[
    (
        "korean_PP-OCRv5_mobile_rec_infer.mnn",
        "ppocr_keys_korean.txt",
        "korean",
    ),
    (
        "latin_PP-OCRv5_mobile_rec_infer.mnn",
        "ppocr_keys_latin.txt",
        "latin",
    ),
    (
        "cyrillic_PP-OCRv5_mobile_rec_infer.mnn",
        "ppocr_keys_cyrillic.txt",
        "cyrillic",
    ),
    (
        "arabic_PP-OCRv5_mobile_rec_infer.mnn",
        "ppocr_keys_arabic.txt",
        "arabic",
    ),
    (
        "devanagari_PP-OCRv5_mobile_rec_infer.mnn",
        "ppocr_keys_devanagari.txt",
        "devanagari",
    ),
    ("th_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_th.txt", "thai"),
    ("el_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_el.txt", "greek"),
    ("ta_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_ta.txt", "tamil"),
    ("te_PP-OCRv5_mobile_rec_infer.mnn", "ppocr_keys_te.txt", "telugu"),
];

fn collect_model_status(models_dir: &std::path::Path) -> (Vec<String>, Vec<String>, bool) {
    let mut missing_models = Vec::new();
    let mut available_languages = Vec::new();

    for (model, name) in REQUIRED_MODELS {
        if !models_dir.join(model).exists() {
            missing_models.push(format!("{} ({})", model, name));
        }
    }

    if models_dir.join(super::engine::OCR_CHARSET).exists()
        && models_dir.join("PP-OCRv5_mobile_rec.mnn").exists()
    {
        available_languages.push("multi".to_string());
    }

    for (rec_model, charset, lang) in LANGUAGE_MODELS {
        if models_dir.join(rec_model).exists() && models_dir.join(charset).exists() {
            available_languages.push(lang.to_string());
        }
    }

    let installed = missing_models.is_empty() && !available_languages.is_empty();
    (missing_models, available_languages, installed)
}

/// Check if OCR models are installed and return status
#[tauri::command]
pub(crate) async fn check_ocr_models(app: tauri::AppHandle) -> Result<OcrModelsStatus, String> {
    // Try to find models directory
    let models_dir = match super::engine::get_ocr_models_dir(&app) {
        Ok(dir) => dir,
        Err(_) => {
            // Models not found, check if app data dir exists
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to get app data dir: {}", e))?;
            let expected_dir = app_data.join(super::engine::DEFAULT_OCR_MODELS_DIR);

            return Ok(OcrModelsStatus {
                installed: false,
                models_dir: Some(expected_dir.to_string_lossy().to_string()),
                available_languages: vec![],
                missing_models: REQUIRED_MODELS.iter().map(|(m, _)| m.to_string()).collect(),
                download_instructions: format!(
                    "OCR models not found. Please download PP-OCRv5 models and place them in:\n{}\n\n\
                    Required files:\n\
                    - {} (detection model)\n\
                    - PP-OCRv5_mobile_rec.mnn (recognition model)\n\
                    - ppocr_keys_v5.txt (charset file)\n\n\
                    Download from: https://github.com/zibo-chen/rust-paddle-ocr/tree/next/models",
                    expected_dir.display(),
                    super::engine::OCR_DET_MODEL
                ),
            });
        }
    };

    let (missing_models, available_languages, installed) = collect_model_status(&models_dir);

    Ok(OcrModelsStatus {
        installed,
        models_dir: Some(models_dir.to_string_lossy().to_string()),
        available_languages,
        missing_models,
        download_instructions: if installed {
            "OCR models are installed and ready to use.".to_string()
        } else {
            format!(
                "Some OCR models are missing. Please download PP-OCRv5 models and place them in:\n{}\n\n\
                Download from: https://github.com/zibo-chen/rust-paddle-ocr/tree/next/models",
                models_dir.display()
            )
        },
    })
}

#[cfg(test)]
mod tests {
    use super::collect_model_status;

    #[test]
    fn collect_model_status_reports_missing_models() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let (missing, available_languages, installed) = collect_model_status(dir.path());
        assert!(!missing.is_empty());
        assert!(available_languages.is_empty());
        assert!(!installed);
    }

    #[test]
    fn collect_model_status_marks_multi_language_as_available() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        std::fs::write(
            dir.path().join("PP-OCRv5_mobile_det.mnn"),
            b"det",
        )
        .expect("failed to create det model");
        std::fs::write(
            dir.path().join("PP-OCRv5_mobile_rec.mnn"),
            b"rec",
        )
        .expect("failed to create rec model");
        std::fs::write(dir.path().join("ppocr_keys_v5.txt"), b"charset")
            .expect("failed to create charset file");

        let (missing, available_languages, installed) = collect_model_status(dir.path());
        assert!(missing.is_empty());
        assert!(available_languages.iter().any(|lang| lang == "multi"));
        assert!(installed);
    }
}
