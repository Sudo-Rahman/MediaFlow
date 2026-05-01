use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranslatedCue {
    id: String,
    translated_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranslationResponseParseResult {
    success: bool,
    cues: Vec<TranslatedCue>,
    error: Option<String>,
    preview: Option<String>,
    warnings: Vec<String>,
}

fn preview(text: &str) -> String {
    const PREVIEW_LIMIT: usize = 300;
    if text.chars().count() > PREVIEW_LIMIT {
        let truncated = text.chars().take(PREVIEW_LIMIT).collect::<String>();
        format!("{}...", truncated)
    } else {
        text.to_string()
    }
}

fn failure(error: impl Into<String>, preview: Option<String>) -> TranslationResponseParseResult {
    TranslationResponseParseResult {
        success: false,
        cues: Vec::new(),
        error: Some(error.into()),
        preview,
        warnings: Vec::new(),
    }
}

fn read_string_field<'a>(value: &'a Value, keys: &[&str]) -> &'a str {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .unwrap_or_default()
}

pub(crate) fn parse_translation_response_text(
    response_text: &str,
) -> TranslationResponseParseResult {
    if response_text.trim().is_empty() {
        return failure("Empty AI response", None);
    }

    let raw = response_text.trim();
    let Some(start_index) = raw.find('{') else {
        return failure("Invalid JSON format", Some(preview(response_text)));
    };
    let Some(end_index) = raw.rfind('}') else {
        return failure("Invalid JSON format", Some(preview(response_text)));
    };

    if end_index <= start_index {
        return failure("Invalid JSON format", Some(preview(response_text)));
    }

    let json_chunk = &raw[start_index..=end_index];
    let parsed = match serde_json::from_str::<Value>(json_chunk) {
        Ok(parsed) => parsed,
        Err(error) => {
            return failure(
                format!("JSON parse error: {}", error),
                Some(preview(json_chunk)),
            );
        }
    };

    let Some(cues_value) = parsed.get("cues").and_then(Value::as_array) else {
        return failure("Invalid JSON structure", Some(preview(json_chunk)));
    };

    if cues_value.is_empty() {
        return failure("Empty cues array", None);
    }

    let cues = cues_value
        .iter()
        .map(|cue| TranslatedCue {
            id: read_string_field(cue, &["id", "ID"]).to_string(),
            translated_text: read_string_field(cue, &["translatedText", "translated_text", "text"])
                .to_string(),
        })
        .collect::<Vec<_>>();

    let invalid_count = cues
        .iter()
        .filter(|cue| cue.id.is_empty() || cue.translated_text.is_empty())
        .count();
    let warnings = if invalid_count > 0 {
        vec![format!(
            "{} cue(s) are missing \"id\" or \"translatedText\" fields. Translation may be incomplete.",
            invalid_count
        )]
    } else {
        Vec::new()
    };

    TranslationResponseParseResult {
        success: true,
        cues,
        error: None,
        preview: None,
        warnings,
    }
}

#[tauri::command]
pub(crate) async fn parse_translation_response(
    response_text: String,
) -> Result<TranslationResponseParseResult, String> {
    tokio::task::spawn_blocking(move || parse_translation_response_text(&response_text))
        .await
        .map_err(|e| format!("Translation response parsing failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::parse_translation_response_text;

    #[test]
    fn parse_translation_response_text_extracts_json_from_wrapped_text() {
        let result = parse_translation_response_text(
            r#"Here:
            {"cues":[{"id":"1","translatedText":"Bonjour"}]}
            Done"#,
        );

        assert!(result.success);
        assert_eq!(result.cues[0].translated_text, "Bonjour");
    }

    #[test]
    fn parse_translation_response_text_accepts_snake_case_text_field() {
        let result = parse_translation_response_text(
            r#"{"cues":[{"ID":"A","translated_text":"Salut"},{"id":"B","text":"Oui"}]}"#,
        );

        assert_eq!(result.cues.len(), 2);
    }

    #[test]
    fn parse_translation_response_text_rejects_missing_cues_array() {
        let result = parse_translation_response_text(r#"{"items":[]}"#);

        assert!(!result.success);
        assert_eq!(result.error.as_deref(), Some("Invalid JSON structure"));
    }

    #[test]
    fn parse_translation_response_text_warns_about_incomplete_cues() {
        let result = parse_translation_response_text(r#"{"cues":[{"id":"1"}]}"#);

        assert_eq!(result.warnings.len(), 1);
    }
}
