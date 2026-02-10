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
