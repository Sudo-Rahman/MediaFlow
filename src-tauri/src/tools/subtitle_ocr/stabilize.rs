#![allow(dead_code)]

use std::borrow::Cow;

use crate::tools::subtitle_ocr::SubtitleOcrCue;

pub(crate) fn stabilize_cues(cues: &[SubtitleOcrCue]) -> Vec<SubtitleOcrCue> {
    let mut stabilized: Vec<SubtitleOcrCue> = Vec::new();

    for cue in cues {
        if cue.text.trim().is_empty() {
            continue;
        }

        if let Some(previous) = stabilized.last_mut() {
            let is_adjacent = cue.start_time_ms <= previous.end_time_ms.saturating_add(250);

            if normalize_line_endings(&previous.text) == normalize_line_endings(&cue.text)
                && is_adjacent
            {
                previous.end_time_ms = previous.end_time_ms.max(cue.end_time_ms);
                previous.confidence = previous.confidence.max(cue.confidence);
                previous
                    .source_cue_ids
                    .extend(cue.source_cue_ids.iter().cloned());
                continue;
            }
        }

        stabilized.push(cue.clone());
    }

    stabilized
}

fn normalize_line_endings(text: &str) -> Cow<'_, str> {
    if text.contains('\r') {
        Cow::Owned(text.replace("\r\n", "\n").replace('\r', "\n"))
    } else {
        Cow::Borrowed(text)
    }
}

#[cfg(test)]
mod tests {
    use super::stabilize_cues;
    use crate::tools::subtitle_ocr::SubtitleOcrCue;

    fn cue(id: &str, start_time_ms: u64, end_time_ms: u64, text: &str) -> SubtitleOcrCue {
        SubtitleOcrCue {
            id: id.to_string(),
            source_cue_ids: vec![id.to_string()],
            start_time_ms,
            end_time_ms,
            text: text.to_string(),
            confidence: 0.8,
        }
    }

    #[test]
    fn adjacent_identical_text_merges() {
        let cues = vec![
            cue("a", 0, 1_000, "Hello world"),
            cue("b", 1_200, 2_000, "Hello world"),
        ];

        let stabilized = stabilize_cues(&cues);

        assert_eq!(stabilized.len(), 1);
        assert_eq!(stabilized[0].end_time_ms, 2_000);
        assert_eq!(stabilized[0].source_cue_ids, vec!["a", "b"]);
    }

    #[test]
    fn case_and_whitespace_differences_do_not_merge() {
        let cues = vec![
            cue("a", 0, 1_000, "Hello  world"),
            cue("b", 1_100, 2_000, "Hello world"),
            cue("c", 2_100, 3_000, "hello world"),
        ];

        let stabilized = stabilize_cues(&cues);

        assert_eq!(stabilized.len(), 3);
    }

    #[test]
    fn different_text_does_not_merge() {
        let cues = vec![cue("a", 0, 1_000, "Hello"), cue("b", 1_100, 2_000, "World")];

        let stabilized = stabilize_cues(&cues);

        assert_eq!(stabilized.len(), 2);
    }

    #[test]
    fn empty_text_cues_are_dropped() {
        let cues = vec![
            cue("a", 0, 1_000, "   \n\t "),
            cue("b", 1_100, 2_000, "World"),
        ];

        let stabilized = stabilize_cues(&cues);

        assert_eq!(stabilized, vec![cue("b", 1_100, 2_000, "World")]);
    }
}
