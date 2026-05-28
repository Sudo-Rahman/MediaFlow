#![allow(dead_code)]

use crate::tools::subtitle_ocr::SubtitleOcrBox;

#[derive(Debug)]
struct TextBox {
    text: String,
    x: f64,
    y: f64,
    height: f64,
}

#[derive(Debug)]
struct TextLine {
    y: f64,
    max_height: f64,
    boxes: Vec<TextBox>,
}

pub(crate) fn reconstruct_text_from_boxes(boxes: &[SubtitleOcrBox]) -> String {
    let mut text_boxes = boxes
        .iter()
        .filter_map(|ocr_box| {
            let text = collapse_whitespace(&ocr_box.text);
            (!text.is_empty()).then_some(TextBox {
                text,
                x: ocr_box.x,
                y: ocr_box.y,
                height: ocr_box.height,
            })
        })
        .collect::<Vec<_>>();

    text_boxes.sort_by(|a, b| a.y.total_cmp(&b.y).then_with(|| a.x.total_cmp(&b.x)));

    let mut lines: Vec<TextLine> = Vec::new();
    for text_box in text_boxes {
        if let Some(line) = lines
            .last_mut()
            .filter(|line| is_same_line(line.y, line.max_height, text_box.y, text_box.height))
        {
            let box_count = line.boxes.len() as f64;
            line.y = ((line.y * box_count) + text_box.y) / (box_count + 1.0);
            line.max_height = line.max_height.max(text_box.height);
            line.boxes.push(text_box);
        } else {
            lines.push(TextLine {
                y: text_box.y,
                max_height: text_box.height,
                boxes: vec![text_box],
            });
        }
    }

    let text = lines
        .iter_mut()
        .map(|line| {
            line.boxes.sort_by(|a, b| a.x.total_cmp(&b.x));
            line.boxes
                .iter()
                .map(|text_box| text_box.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n");

    split_dialogue_dash_fallback(&text)
}

pub(crate) fn split_dialogue_dash_fallback(text: &str) -> String {
    if text.contains('\n') || !starts_with_dialogue_dash(text) {
        return text.to_string();
    }

    for (index, ch) in text.char_indices().skip(1) {
        if !is_dialogue_dash(ch) {
            continue;
        }

        let previous_is_whitespace = text[..index]
            .chars()
            .next_back()
            .is_some_and(char::is_whitespace);
        let next_is_whitespace = text[index + ch.len_utf8()..]
            .chars()
            .next()
            .is_some_and(char::is_whitespace);

        if previous_is_whitespace && next_is_whitespace {
            let first = text[..index].trim_end();
            let second = text[index..].trim_start();

            if !first.trim().is_empty()
                && !second.trim().is_empty()
                && ends_with_sentence_terminal(first)
            {
                return format!("{}\n{}", first, second);
            }
        }
    }

    text.to_string()
}

fn collapse_whitespace(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut last_was_whitespace = false;

    for ch in text.chars() {
        if ch.is_whitespace() {
            if !last_was_whitespace && !output.is_empty() {
                output.push(' ');
            }
            last_was_whitespace = true;
            continue;
        }

        last_was_whitespace = false;
        output.push(ch);
    }

    output.trim().to_string()
}

fn is_same_line(line_y: f64, line_height: f64, box_y: f64, box_height: f64) -> bool {
    let height = line_height.max(box_height);
    let threshold = if height > 0.0 { height * 0.7 } else { 0.01 };

    (line_y - box_y).abs() <= threshold
}

fn starts_with_dialogue_dash(text: &str) -> bool {
    text.chars().next().is_some_and(is_dialogue_dash)
}

fn is_dialogue_dash(ch: char) -> bool {
    matches!(ch, '-' | '–' | '—')
}

fn ends_with_sentence_terminal(text: &str) -> bool {
    matches!(
        text.chars().next_back(),
        Some('.' | '!' | '?' | '…' | '。' | '！' | '？')
    )
}

#[cfg(test)]
mod tests {
    use super::{reconstruct_text_from_boxes, split_dialogue_dash_fallback};
    use crate::tools::subtitle_ocr::SubtitleOcrBox;

    fn ocr_box(text: &str, x: f64, y: f64) -> SubtitleOcrBox {
        SubtitleOcrBox {
            text: text.to_string(),
            confidence: 0.9,
            x,
            y,
            width: 20.0,
            height: 10.0,
        }
    }

    #[test]
    fn reconstruct_text_groups_boxes_by_line() {
        let boxes = vec![
            ocr_box("I cannot.", 24.0, 42.0),
            ocr_box("Stop.", 24.0, 10.0),
            ocr_box(" -  ", 10.0, 10.0),
            ocr_box("- ", 10.0, 42.0),
        ];

        let text = reconstruct_text_from_boxes(&boxes);

        assert_eq!(text, "- Stop.\n- I cannot.");
    }

    #[test]
    fn dash_fallback_splits_obvious_dialogue() {
        let text = split_dialogue_dash_fallback("- Stop. - I cannot.");

        assert_eq!(text, "- Stop.\n- I cannot.");
    }

    #[test]
    fn dash_fallback_splits_en_dash_and_em_dash_dialogue() {
        assert_eq!(
            split_dialogue_dash_fallback("– Stop. — I cannot."),
            "– Stop.\n— I cannot."
        );
    }

    #[test]
    fn dash_fallback_keeps_leading_dash_sentence_with_internal_dash() {
        let text = split_dialogue_dash_fallback("- A well-known phrase - not dialogue.");

        assert_eq!(text, "- A well-known phrase - not dialogue.");
    }

    #[test]
    fn dash_fallback_keeps_normal_hyphen_text() {
        let text = split_dialogue_dash_fallback("This is a well-known phrase - not dialogue.");

        assert_eq!(text, "This is a well-known phrase - not dialogue.");
    }
}
