use tauri::Manager;

use crate::tools::ocr::OcrModelsStatus;

/// Check if OCR models are installed and return status
#[tauri::command]
pub(crate) async fn check_ocr_models(app: tauri::AppHandle) -> Result<OcrModelsStatus, String> {
    // Define all model files we need to check
    let required_models = vec![
        (super::engine::OCR_DET_MODEL, "detection"),
        ("PP-OCRv5_mobile_rec.mnn", "multi"),
    ];

    let language_models = vec![
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
        (
            "th_PP-OCRv5_mobile_rec_infer.mnn",
            "ppocr_keys_th.txt",
            "thai",
        ),
        (
            "el_PP-OCRv5_mobile_rec_infer.mnn",
            "ppocr_keys_el.txt",
            "greek",
        ),
        (
            "ta_PP-OCRv5_mobile_rec_infer.mnn",
            "ppocr_keys_ta.txt",
            "tamil",
        ),
        (
            "te_PP-OCRv5_mobile_rec_infer.mnn",
            "ppocr_keys_te.txt",
            "telugu",
        ),
    ];

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
                missing_models: required_models.iter().map(|(m, _)| m.to_string()).collect(),
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

    let mut missing_models = Vec::new();
    let mut available_languages = Vec::new();

    // Check required models
    for (model, name) in &required_models {
        if !models_dir.join(model).exists() {
            missing_models.push(format!("{} ({})", model, name));
        }
    }

    // Check charset for multi-language
    if models_dir.join(super::engine::OCR_CHARSET).exists()
        && models_dir.join("PP-OCRv5_mobile_rec.mnn").exists()
    {
        available_languages.push("multi".to_string());
    }

    // Check language-specific models
    for (rec_model, charset, lang) in &language_models {
        if models_dir.join(rec_model).exists() && models_dir.join(charset).exists() {
            available_languages.push(lang.to_string());
        }
    }

    let installed = missing_models.is_empty() && !available_languages.is_empty();

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
