use crate::shared::validation::validate_output_path;
use crate::tools::ocr::OcrSubtitleEntry;

/// Export subtitles to file
#[tauri::command]
pub(crate) async fn export_ocr_subtitles(
    subtitles: Vec<OcrSubtitleEntry>,
    output_path: String,
    format: String,
) -> Result<(), String> {
    validate_output_path(&output_path)?;

    let content = match format.as_str() {
        "srt" => format_srt(&subtitles),
        "vtt" => format_vtt(&subtitles),
        "ass" => format_ass(&subtitles),
        "txt" => format_txt(&subtitles),
        _ => return Err(format!("Unsupported format: {}", format)),
    };

    std::fs::write(&output_path, content)
        .map_err(|e| format!("Failed to write subtitle file: {}", e))?;

    Ok(())
}

/// Format subtitles as SRT
fn format_srt(subtitles: &[OcrSubtitleEntry]) -> String {
    subtitles
        .iter()
        .enumerate()
        .map(|(i, sub)| {
            format!(
                "{}\n{} --> {}\n{}\n",
                i + 1,
                format_srt_time(sub.start_time),
                format_srt_time(sub.end_time),
                sub.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Format subtitles as VTT
fn format_vtt(subtitles: &[OcrSubtitleEntry]) -> String {
    let mut output = String::from("WEBVTT\n\n");
    for sub in subtitles {
        output.push_str(&format!(
            "{} --> {}\n{}\n\n",
            format_vtt_time(sub.start_time),
            format_vtt_time(sub.end_time),
            sub.text
        ));
    }
    output
}

/// Format subtitles as plain text
fn format_txt(subtitles: &[OcrSubtitleEntry]) -> String {
    subtitles
        .iter()
        .map(|sub| sub.text.clone())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Format subtitles as ASS with a single default bottom subtitle style.
fn format_ass(subtitles: &[OcrSubtitleEntry]) -> String {
    let events = subtitles
        .iter()
        .map(|sub| {
            format!(
                "Dialogue: 0,{},{},Default,,0,0,0,,{}",
                format_ass_time(sub.start_time),
                format_ass_time(sub.end_time),
                format_ass_text(&sub.text)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    [
        "[Script Info]".to_string(),
        "ScriptType: v4.00+".to_string(),
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
        .replace('\n', "\\N")
        .replace(['{', '}'], "")
}

/// Format time for SRT (00:00:00,000)
fn format_srt_time(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1000;
    let millis = ms % 1000;
    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, seconds, millis)
}

/// Format time for VTT (00:00:00.000)
fn format_vtt_time(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1000;
    let millis = ms % 1000;
    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, seconds, millis)
}

/// Format time for ASS (0:00:00.00)
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
    use super::{
        export_ocr_subtitles, format_ass, format_ass_time, format_srt, format_srt_time, format_txt,
        format_vtt, format_vtt_time,
    };
    use crate::tools::ocr::OcrSubtitleEntry;

    fn sample_subtitles() -> Vec<OcrSubtitleEntry> {
        vec![
            OcrSubtitleEntry {
                id: "sub-1".to_string(),
                text: "Hello".to_string(),
                start_time: 0,
                end_time: 1200,
                confidence: 0.95,
            },
            OcrSubtitleEntry {
                id: "sub-2".to_string(),
                text: "World".to_string(),
                start_time: 1500,
                end_time: 2600,
                confidence: 0.92,
            },
        ]
    }

    #[test]
    fn format_srt_and_vtt_time_render_expected_formats() {
        assert_eq!(format_srt_time(3723004), "01:02:03,004");
        assert_eq!(format_vtt_time(3723004), "01:02:03.004");
        assert_eq!(format_ass_time(3723004), "1:02:03.00");
    }

    #[test]
    fn formatters_render_expected_content() {
        let subtitles = sample_subtitles();
        let srt = format_srt(&subtitles);
        assert!(srt.contains("1\n00:00:00,000 --> 00:00:01,200\nHello"));

        let vtt = format_vtt(&subtitles);
        assert!(vtt.starts_with("WEBVTT"));
        assert!(vtt.contains("00:00:01.500 --> 00:00:02.600"));

        let txt = format_txt(&subtitles);
        assert_eq!(txt, "Hello\nWorld");
    }

    #[test]
    fn format_ass_renders_position_capable_subtitles() {
        let mut subtitles = sample_subtitles();
        subtitles[0].text = "Hello\n{ignored}".to_string();

        let ass = format_ass(&subtitles);

        assert!(ass.starts_with("[Script Info]\nScriptType: v4.00+"));
        assert!(ass.contains("[V4+ Styles]"));
        assert!(ass.contains("[Events]"));
        assert!(ass.contains("Dialogue: 0,0:00:00.00,0:00:01.20,Default,,0,0,0,,Hello\\Nignored"));
    }

    #[tokio::test]
    async fn export_ocr_subtitles_writes_requested_format() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("export.srt");
        export_ocr_subtitles(
            sample_subtitles(),
            output.to_string_lossy().to_string(),
            "srt".to_string(),
        )
        .await
        .expect("export should succeed");

        let content = std::fs::read_to_string(&output).expect("failed to read exported file");
        assert!(content.contains("Hello"));
        assert!(content.contains("World"));
    }
}
