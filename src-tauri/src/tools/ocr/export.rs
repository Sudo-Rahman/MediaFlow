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

#[cfg(test)]
mod tests {
    use super::{export_ocr_subtitles, format_srt, format_srt_time, format_txt, format_vtt, format_vtt_time};
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
