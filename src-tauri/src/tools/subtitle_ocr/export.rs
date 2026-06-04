use crate::shared::validation::validate_output_path;
use crate::tools::subtitle_ocr::{SubtitleOcrCue, SubtitleOcrPlacement};

enum SubtitleOcrExportFormat {
    Ass,
    Srt,
    Vtt,
}

#[tauri::command]
pub(crate) async fn export_subtitle_ocr_version(
    cues: Vec<SubtitleOcrCue>,
    output_path: String,
    format: String,
) -> Result<(), String> {
    validate_output_path(&output_path)?;
    let format = parse_export_format(&format)?;
    let cues = validated_sorted_nonblank_cues(&cues)?;

    let content = match format {
        SubtitleOcrExportFormat::Ass => format_ass(&cues, 1920, 1080),
        SubtitleOcrExportFormat::Srt => format_srt(&cues),
        SubtitleOcrExportFormat::Vtt => format_vtt(&cues),
    };

    std::fs::write(&output_path, content)
        .map_err(|e| format!("Failed to write Subtitle OCR export: {}", e))?;

    Ok(())
}

fn parse_export_format(format: &str) -> Result<SubtitleOcrExportFormat, String> {
    match format {
        "ass" => Ok(SubtitleOcrExportFormat::Ass),
        "srt" => Ok(SubtitleOcrExportFormat::Srt),
        "vtt" => Ok(SubtitleOcrExportFormat::Vtt),
        _ => Err(format!(
            "Unsupported Subtitle OCR export format: {}",
            format
        )),
    }
}

fn validated_sorted_nonblank_cues(cues: &[SubtitleOcrCue]) -> Result<Vec<&SubtitleOcrCue>, String> {
    for cue in cues {
        if cue.end_time_ms <= cue.start_time_ms {
            return Err(format!(
                "Invalid Subtitle OCR cue time range for cue {}",
                cue.id
            ));
        }
    }

    let mut sorted = cues
        .iter()
        .filter(|cue| !cue.text.trim().is_empty())
        .collect::<Vec<_>>();

    sorted.sort_by(|a, b| {
        a.start_time_ms
            .cmp(&b.start_time_ms)
            .then_with(|| a.end_time_ms.cmp(&b.end_time_ms))
            .then_with(|| a.id.cmp(&b.id))
    });

    Ok(sorted)
}

fn format_srt(cues: &[&SubtitleOcrCue]) -> String {
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

fn format_vtt(cues: &[&SubtitleOcrCue]) -> String {
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

fn format_ass(cues: &[&SubtitleOcrCue], width: u32, height: u32) -> String {
    let events = cues
        .iter()
        .map(|cue| {
            let text = format_ass_cue_text(cue);
            format!(
                "Dialogue: 0,{},{},Default,,0,0,0,,{}",
                format_ass_time(cue.start_time_ms),
                format_ass_time(cue.end_time_ms),
                text
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

fn format_ass_cue_text(cue: &SubtitleOcrCue) -> String {
    let text = format_ass_text(&cue.text);
    if cue.placement == Some(SubtitleOcrPlacement::Top) {
        format!("{{\\an8}}{}", text)
    } else {
        text
    }
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
    use crate::tools::subtitle_ocr::{SubtitleOcrCue, SubtitleOcrPlacement};

    fn cue(id: &str, start_time_ms: u64, end_time_ms: u64, text: &str) -> SubtitleOcrCue {
        SubtitleOcrCue {
            id: id.to_string(),
            source_cue_ids: vec!["raw-1".to_string()],
            start_time_ms,
            end_time_ms,
            text: text.to_string(),
            confidence: 0.9,
            placement: Some(SubtitleOcrPlacement::Bottom),
            placement_source_count: Some(1),
            top_placement_source_count: Some(0),
        }
    }

    fn top_cue(id: &str, start_time_ms: u64, end_time_ms: u64, text: &str) -> SubtitleOcrCue {
        SubtitleOcrCue {
            placement: Some(SubtitleOcrPlacement::Top),
            placement_source_count: Some(1),
            top_placement_source_count: Some(1),
            ..cue(id, start_time_ms, end_time_ms, text)
        }
    }

    fn multiline_cue() -> SubtitleOcrCue {
        cue("cue-1", 1_000, 2_500, "- Stop.\n- I cannot.")
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

    #[tokio::test]
    async fn ass_prefixes_top_cues_with_alignment_override() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("subtitle-ocr.ass");

        export_subtitle_ocr_version(
            vec![
                top_cue("top", 1_000, 2_000, "Top line"),
                cue("bottom", 3_000, 4_000, "Bottom line"),
            ],
            output.to_string_lossy().to_string(),
            "ass".to_string(),
        )
        .await
        .expect("export should succeed");

        let content = std::fs::read_to_string(output).expect("failed to read export");
        assert!(content.contains(r"{\an8}Top line"));
        assert!(content.contains(",,Bottom line"));
        assert!(!content.contains(r"{\an8}Bottom line"));
    }

    #[tokio::test]
    async fn srt_and_vtt_ignore_top_alignment() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let srt_output = dir.path().join("subtitle-ocr.srt");
        let vtt_output = dir.path().join("subtitle-ocr.vtt");

        export_subtitle_ocr_version(
            vec![top_cue("top", 1_000, 2_000, "Top line")],
            srt_output.to_string_lossy().to_string(),
            "srt".to_string(),
        )
        .await
        .expect("srt export should succeed");
        export_subtitle_ocr_version(
            vec![top_cue("top", 1_000, 2_000, "Top line")],
            vtt_output.to_string_lossy().to_string(),
            "vtt".to_string(),
        )
        .await
        .expect("vtt export should succeed");

        let srt = std::fs::read_to_string(srt_output).expect("failed to read srt export");
        let vtt = std::fs::read_to_string(vtt_output).expect("failed to read vtt export");
        assert!(!srt.contains(r"{\an8}"));
        assert!(!vtt.contains(r"{\an8}"));
    }

    #[tokio::test]
    async fn invalid_time_range_rejects_with_cue_id() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("subtitle-ocr.srt");

        let error = export_subtitle_ocr_version(
            vec![cue("bad-cue", 2_000, 2_000, "Bad range")],
            output.to_string_lossy().to_string(),
            "srt".to_string(),
        )
        .await
        .expect_err("invalid timing should fail");

        assert!(error.contains("bad-cue"));
    }

    #[tokio::test]
    async fn whitespace_only_cue_is_omitted_and_numbering_remains_correct() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("subtitle-ocr.srt");

        export_subtitle_ocr_version(
            vec![
                cue("blank", 0, 500, " \n\t "),
                cue("visible", 1_000, 2_000, "Visible"),
            ],
            output.to_string_lossy().to_string(),
            "srt".to_string(),
        )
        .await
        .expect("export should succeed");

        let content = std::fs::read_to_string(output).expect("failed to read export");
        assert!(content.starts_with("1\n00:00:01,000 --> 00:00:02,000\nVisible"));
        assert!(!content.contains("2\n"));
    }

    #[tokio::test]
    async fn unsorted_input_exports_chronologically() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("subtitle-ocr.vtt");

        export_subtitle_ocr_version(
            vec![
                cue("later", 2_000, 3_000, "Later"),
                cue("earlier", 500, 1_000, "Earlier"),
            ],
            output.to_string_lossy().to_string(),
            "vtt".to_string(),
        )
        .await
        .expect("export should succeed");

        let content = std::fs::read_to_string(output).expect("failed to read export");
        let earlier_index = content.find("Earlier").expect("earlier cue should exist");
        let later_index = content.find("Later").expect("later cue should exist");
        assert!(earlier_index < later_index);
    }

    #[tokio::test]
    async fn unsupported_format_rejects() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("subtitle-ocr.txt");

        let error = export_subtitle_ocr_version(
            vec![multiline_cue()],
            output.to_string_lossy().to_string(),
            "txt".to_string(),
        )
        .await
        .expect_err("unsupported format should fail");

        assert_eq!(error, "Unsupported Subtitle OCR export format: txt");
    }

    #[tokio::test]
    async fn ass_escapes_braces_backslashes_and_line_breaks() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let output = dir.path().join("subtitle-ocr.ass");

        export_subtitle_ocr_version(
            vec![cue(
                "escaped",
                1_000,
                2_000,
                r"Path C:\Temp\{file}
Next",
            )],
            output.to_string_lossy().to_string(),
            "ass".to_string(),
        )
        .await
        .expect("export should succeed");

        let content = std::fs::read_to_string(output).expect("failed to read export");
        assert!(content.contains(r"Path C:\\Temp\\\{file\}\NNext"));
    }
}
