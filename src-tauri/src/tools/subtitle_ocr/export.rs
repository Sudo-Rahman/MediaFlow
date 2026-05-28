use crate::shared::validation::validate_output_path;
use crate::tools::subtitle_ocr::SubtitleOcrCue;

#[tauri::command]
pub(crate) async fn export_subtitle_ocr_version(
    cues: Vec<SubtitleOcrCue>,
    output_path: String,
    format: String,
) -> Result<(), String> {
    validate_output_path(&output_path)?;

    let content = match format.as_str() {
        "ass" => format_ass(&cues, 1920, 1080),
        "srt" => format_srt(&cues),
        "vtt" => format_vtt(&cues),
        _ => {
            return Err(format!(
                "Unsupported Subtitle OCR export format: {}",
                format
            ));
        }
    };

    std::fs::write(&output_path, content)
        .map_err(|e| format!("Failed to write Subtitle OCR export: {}", e))?;

    Ok(())
}

fn format_srt(cues: &[SubtitleOcrCue]) -> String {
    cues.iter()
        .enumerate()
        .map(|(index, cue)| {
            format!(
                "{}\n{} --> {}\n{}\n",
                index + 1,
                format_srt_time(cue.start_time_ms),
                format_srt_time(cue.end_time_ms),
                cue.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_vtt(cues: &[SubtitleOcrCue]) -> String {
    let mut output = String::from("WEBVTT\n\n");

    for cue in cues {
        output.push_str(&format!(
            "{} --> {}\n{}\n\n",
            format_vtt_time(cue.start_time_ms),
            format_vtt_time(cue.end_time_ms),
            cue.text
        ));
    }

    output
}

fn format_ass(cues: &[SubtitleOcrCue], width: u32, height: u32) -> String {
    let events = cues
        .iter()
        .map(|cue| {
            format!(
                "Dialogue: 0,{},{},Default,,0,0,0,,{}",
                format_ass_time(cue.start_time_ms),
                format_ass_time(cue.end_time_ms),
                format_ass_text(&cue.text)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    [
        "[Script Info]".to_string(),
        "ScriptType: v4.00+".to_string(),
        format!("PlayResX: {}", width),
        format!("PlayResY: {}", height),
        String::new(),
        "[V4+ Styles]".to_string(),
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding".to_string(),
        "Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,40,1".to_string(),
        String::new(),
        "[Events]".to_string(),
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text".to_string(),
        events,
    ]
    .join("\n")
}

fn format_ass_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
        .replace('\n', "\\N")
}

fn format_srt_time(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1000;
    let millis = ms % 1000;

    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, seconds, millis)
}

fn format_vtt_time(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1000;
    let millis = ms % 1000;

    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, seconds, millis)
}

fn format_ass_time(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1000;
    let centiseconds = (ms % 1000) / 10;

    format!(
        "{}:{:02}:{:02}.{:02}",
        hours, minutes, seconds, centiseconds
    )
}

#[cfg(test)]
mod tests {
    use super::export_subtitle_ocr_version;
    use crate::tools::subtitle_ocr::SubtitleOcrCue;

    fn multiline_cue() -> SubtitleOcrCue {
        SubtitleOcrCue {
            id: "cue-1".to_string(),
            source_cue_ids: vec!["raw-1".to_string()],
            start_time_ms: 1_000,
            end_time_ms: 2_500,
            text: "- Stop.\n- I cannot.".to_string(),
            confidence: 0.9,
        }
    }

    #[tokio::test]
    async fn srt_preserves_real_line_breaks() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("subtitle-ocr.srt");

        export_subtitle_ocr_version(
            vec![multiline_cue()],
            output.to_string_lossy().to_string(),
            "srt".to_string(),
        )
        .await
        .expect("export should succeed");

        let content = std::fs::read_to_string(output).expect("failed to read export");
        assert!(content.contains("- Stop.\n- I cannot."));
    }

    #[tokio::test]
    async fn vtt_preserves_real_line_breaks() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("subtitle-ocr.vtt");

        export_subtitle_ocr_version(
            vec![multiline_cue()],
            output.to_string_lossy().to_string(),
            "vtt".to_string(),
        )
        .await
        .expect("export should succeed");

        let content = std::fs::read_to_string(output).expect("failed to read export");
        assert!(content.contains("- Stop.\n- I cannot."));
    }

    #[tokio::test]
    async fn ass_serializes_line_breaks_as_ass_line_breaks() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("subtitle-ocr.ass");

        export_subtitle_ocr_version(
            vec![multiline_cue()],
            output.to_string_lossy().to_string(),
            "ass".to_string(),
        )
        .await
        .expect("export should succeed");

        let content = std::fs::read_to_string(output).expect("failed to read export");
        assert!(content.contains("- Stop.\\N- I cannot."));
    }
}
