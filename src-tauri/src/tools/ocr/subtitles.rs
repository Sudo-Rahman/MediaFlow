use std::collections::HashMap;

use tauri::Emitter;

use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::tools::ocr::{OcrFrameResult, OcrSubtitleCleanupOptions, OcrSubtitleEntry};

impl Default for OcrSubtitleCleanupOptions {
    fn default() -> Self {
        Self {
            merge_similar: true,
            similarity_threshold: 0.92,
            max_gap_ms: 250,
            min_cue_duration_ms: 500,
            filter_url_like: true,
        }
    }
}

fn clamp_f64(value: f64, min: f64, max: f64) -> f64 {
    if value.is_nan() {
        return min;
    }
    value.max(min).min(max)
}

fn frame_end_time_ms(frame_index: u32, fps: f64) -> u64 {
    (((frame_index as f64) + 1.0) * (1000.0 / fps)).round() as u64
}

fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last_was_space = false;

    for c in text.chars() {
        if c.is_whitespace() {
            if !last_was_space && !out.is_empty() {
                out.push(' ');
            }
            last_was_space = true;
            continue;
        }

        last_was_space = false;
        out.push(c);
    }

    out.trim().to_string()
}

fn is_edge_punctuation(c: char) -> bool {
    if c.is_whitespace() || c.is_ascii_punctuation() {
        return true;
    }

    matches!(
        c,
        '，' | '。'
            | '！'
            | '？'
            | '：'
            | '；'
            | '、'
            | '“'
            | '”'
            | '‘'
            | '’'
            | '《'
            | '》'
            | '（'
            | '）'
            | '【'
            | '】'
            | '—'
            | '…'
            | '～'
            | '·'
    )
}

fn normalize_text_for_compare(text: &str) -> String {
    let collapsed = collapse_whitespace(text);
    let trimmed = collapsed.trim_matches(is_edge_punctuation);
    trimmed.to_lowercase()
}

fn levenshtein_distance_bounded(a: &[char], b: &[char], max_dist: usize) -> Option<usize> {
    let (short, long) = if a.len() <= b.len() { (a, b) } else { (b, a) };

    let short_len = short.len();
    let long_len = long.len();

    if long_len.saturating_sub(short_len) > max_dist {
        return None;
    }

    let mut prev: Vec<usize> = (0..=short_len).collect();
    let mut cur: Vec<usize> = vec![0; short_len + 1];

    for (j, &long_ch) in long.iter().enumerate() {
        cur[0] = j + 1;
        let mut row_min = cur[0];

        for i in 0..short_len {
            let cost = usize::from(short[i] != long_ch);
            let ins = cur[i] + 1;
            let del = prev[i + 1] + 1;
            let sub = prev[i] + cost;
            let val = ins.min(del).min(sub);
            cur[i + 1] = val;
            row_min = row_min.min(val);
        }

        if row_min > max_dist {
            return None;
        }

        std::mem::swap(&mut prev, &mut cur);
    }

    if prev[short_len] <= max_dist {
        Some(prev[short_len])
    } else {
        None
    }
}

fn texts_are_similar(a_key: &str, b_key: &str, threshold: f64) -> bool {
    if a_key == b_key {
        return true;
    }

    let a_chars: Vec<char> = a_key.chars().collect();
    let b_chars: Vec<char> = b_key.chars().collect();

    let a_len = a_chars.len();
    let b_len = b_chars.len();
    let min_len = a_len.min(b_len);
    let max_len = a_len.max(b_len);

    // Conservative short-text path:
    // allow one-character OCR drift only when lengths are identical.
    if min_len < 6 {
        if a_len != b_len {
            return false;
        }

        return matches!(
            levenshtein_distance_bounded(&a_chars, &b_chars, 1),
            Some(dist) if dist <= 1
        );
    }

    let threshold = clamp_f64(threshold, 0.0, 1.0);
    let max_dist = ((1.0 - threshold) * (max_len as f64)).ceil() as usize;

    if max_dist == 0 {
        return false;
    }

    let Some(dist) = levenshtein_distance_bounded(&a_chars, &b_chars, max_dist) else {
        return false;
    };

    let similarity = 1.0 - (dist as f64 / max_len as f64);
    similarity + 1e-9 >= threshold
}

#[cfg(test)]
mod tests {
    use super::texts_are_similar;

    #[test]
    fn texts_are_similar_merges_short_texts_with_single_char_difference() {
        assert!(texts_are_similar("吴昊 菲菲", "昊昊 菲菲", 0.85));
    }

    #[test]
    fn texts_are_similar_keeps_short_exact_matches() {
        assert!(texts_are_similar("哥哥", "哥哥", 0.92));
    }

    #[test]
    fn texts_are_similar_rejects_short_texts_with_multiple_char_differences() {
        assert!(!texts_are_similar("吴昊 菲菲", "叶昊 爸爸", 0.85));
    }

    #[test]
    fn texts_are_similar_preserves_long_text_similarity_behavior() {
        assert!(texts_are_similar(
            "today we fight together",
            "today we fight togather",
            0.92
        ));
        assert!(!texts_are_similar(
            "today we fight together",
            "tomorrow we run away",
            0.92
        ));
    }
}

fn token_looks_like_domain(token: &str) -> bool {
    let token = token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-');
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 || parts.iter().any(|p| p.is_empty()) {
        return false;
    }

    let tld = parts[parts.len() - 1];
    if !(2..=6).contains(&tld.len()) || !tld.chars().all(|c| c.is_ascii_alphabetic()) {
        return false;
    }

    let domain = parts[parts.len() - 2];
    if domain.len() < 2 || !domain.chars().any(|c| c.is_ascii_alphabetic()) {
        return false;
    }

    true
}

fn text_looks_url_like(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();

    if lower.contains("http://") || lower.contains("https://") || lower.contains("www.") {
        return true;
    }

    if lower.contains(".com")
        || lower.contains(".net")
        || lower.contains(".org")
        || lower.contains(".co")
        || lower.contains(".io")
        || lower.contains(".me")
        || lower.contains(".tv")
        || lower.contains(".app")
    {
        return true;
    }

    lower.split_whitespace().any(token_looks_like_domain)
}

#[derive(Debug, Clone)]
struct SegmentCandidate {
    key: String,
    text: String,
    confidence: f64,
}

#[derive(Debug, Clone)]
struct SubtitleSegment {
    start_time: u64,
    last_seen_time: u64,
    last_seen_frame_index: u32,
    baseline_key: String,
    baseline_confidence: f64,
    candidates: Vec<SegmentCandidate>,
}

fn select_segment_text(candidates: &[SegmentCandidate]) -> Option<(String, f64)> {
    if candidates.is_empty() {
        return None;
    }

    // key -> (count, max_confidence, text_at_max_confidence)
    let mut stats: HashMap<&str, (u32, f64, &str)> = HashMap::new();

    for c in candidates {
        let entry = stats
            .entry(c.key.as_str())
            .or_insert((0, 0.0, c.text.as_str()));
        entry.0 += 1;
        if c.confidence > entry.1 {
            entry.1 = c.confidence;
            entry.2 = c.text.as_str();
        }
    }

    let mut best_key: Option<&str> = None;
    let mut best_count: u32 = 0;
    let mut best_confidence: f64 = -1.0;
    let mut best_text: &str = "";

    for (key, (count, max_conf, text_at_max)) in stats {
        if max_conf > best_confidence + 1e-9
            || ((max_conf - best_confidence).abs() <= 1e-9 && count > best_count)
        {
            best_key = Some(key);
            best_count = count;
            best_confidence = max_conf;
            best_text = text_at_max;
        }
    }

    best_key.map(|_| (best_text.to_string(), best_confidence))
}

/// Generate subtitles from OCR results with stabilization and cleanup
#[tauri::command]
pub(crate) async fn generate_subtitles_from_ocr(
    app: tauri::AppHandle,
    file_id: String,
    frame_results: Vec<OcrFrameResult>,
    fps: f64,
    min_confidence: f64,
    cleanup: Option<OcrSubtitleCleanupOptions>,
) -> Result<Vec<OcrSubtitleEntry>, String> {
    if fps <= 0.0 {
        return Err("FPS must be greater than 0".to_string());
    }

    let _sleep_guard = SleepInhibitGuard::try_acquire("Generating subtitles from OCR").ok();

    let cleanup = cleanup.unwrap_or_default();
    let similarity_threshold = if cleanup.merge_similar {
        clamp_f64(cleanup.similarity_threshold, 0.85, 0.98)
    } else {
        1.0
    };
    let max_gap_ms = cleanup.max_gap_ms as u64;
    let min_confidence = clamp_f64(min_confidence, 0.0, 1.0);
    let min_cue_duration_ms = cleanup.min_cue_duration_ms as u64;

    // Emit start
    let _ = app.emit(
        "ocr-progress",
        serde_json::json!({
            "fileId": file_id,
            "phase": "generating",
            "current": 0,
            "total": frame_results.len(),
            "message": "Generating subtitles..."
        }),
    );

    let mut segments: Vec<SubtitleSegment> = Vec::new();
    let mut current: Option<SubtitleSegment> = None;

    for (i, frame) in frame_results.iter().enumerate() {
        let display_text = collapse_whitespace(frame.text.as_str());
        let key = normalize_text_for_compare(&display_text);
        let is_valid = frame.confidence >= min_confidence && !key.is_empty();

        if !is_valid {
            if let Some(seg) = current.as_ref() {
                let gap = frame.time_ms.saturating_sub(seg.last_seen_time);
                if gap > max_gap_ms {
                    segments.push(seg.clone());
                    current = None;
                }
            }
        } else if let Some(mut seg) = current.take() {
            let gap = frame.time_ms.saturating_sub(seg.last_seen_time);

            if gap > max_gap_ms {
                segments.push(seg);
                current = Some(SubtitleSegment {
                    start_time: frame.time_ms,
                    last_seen_time: frame.time_ms,
                    last_seen_frame_index: frame.frame_index,
                    baseline_key: key.clone(),
                    baseline_confidence: frame.confidence,
                    candidates: vec![SegmentCandidate {
                        key,
                        text: display_text,
                        confidence: frame.confidence,
                    }],
                });
            } else {
                let similar = if cleanup.merge_similar {
                    texts_are_similar(&seg.baseline_key, &key, similarity_threshold)
                } else {
                    seg.baseline_key == key
                };

                if similar {
                    seg.last_seen_time = frame.time_ms;
                    seg.last_seen_frame_index = frame.frame_index;
                    seg.candidates.push(SegmentCandidate {
                        key: key.clone(),
                        text: display_text,
                        confidence: frame.confidence,
                    });
                    if frame.confidence > seg.baseline_confidence + 1e-9 {
                        seg.baseline_key = key;
                        seg.baseline_confidence = frame.confidence;
                    }
                    current = Some(seg);
                } else {
                    segments.push(seg);
                    current = Some(SubtitleSegment {
                        start_time: frame.time_ms,
                        last_seen_time: frame.time_ms,
                        last_seen_frame_index: frame.frame_index,
                        baseline_key: key.clone(),
                        baseline_confidence: frame.confidence,
                        candidates: vec![SegmentCandidate {
                            key,
                            text: display_text,
                            confidence: frame.confidence,
                        }],
                    });
                }
            }
        } else {
            current = Some(SubtitleSegment {
                start_time: frame.time_ms,
                last_seen_time: frame.time_ms,
                last_seen_frame_index: frame.frame_index,
                baseline_key: key.clone(),
                baseline_confidence: frame.confidence,
                candidates: vec![SegmentCandidate {
                    key,
                    text: display_text,
                    confidence: frame.confidence,
                }],
            });
        }

        // Emit progress
        if i % 100 == 0 {
            let _ = app.emit(
                "ocr-progress",
                serde_json::json!({
                    "fileId": file_id,
                    "phase": "generating",
                    "current": i,
                    "total": frame_results.len(),
                    "message": format!("Processing frame {}...", i)
                }),
            );
        }
    }

    if let Some(seg) = current.take() {
        segments.push(seg);
    }

    let mut subtitles: Vec<OcrSubtitleEntry> = Vec::with_capacity(segments.len());

    for seg in &segments {
        let Some((text, confidence)) = select_segment_text(&seg.candidates) else {
            continue;
        };

        let mut end_time = frame_end_time_ms(seg.last_seen_frame_index, fps);
        if end_time <= seg.start_time {
            end_time = seg.start_time.saturating_add(1);
        }

        subtitles.push(OcrSubtitleEntry {
            id: format!("sub-{}", subtitles.len() + 1),
            text,
            start_time: seg.start_time,
            end_time,
            confidence,
        });
    }

    // Drop obvious watermark/URL-like cues (optional).
    if cleanup.filter_url_like {
        subtitles.retain(|s| !text_looks_url_like(&s.text));
    }

    // Merge adjacent similar cues (optional).
    if cleanup.merge_similar && subtitles.len() > 1 {
        let mut merged: Vec<OcrSubtitleEntry> = Vec::with_capacity(subtitles.len());

        for sub in subtitles {
            if let Some(prev) = merged.last_mut() {
                let gap = sub.start_time.saturating_sub(prev.end_time);
                let prev_key = normalize_text_for_compare(&prev.text);
                let sub_key = normalize_text_for_compare(&sub.text);

                let prev_dur = prev.end_time.saturating_sub(prev.start_time);
                let sub_dur = sub.end_time.saturating_sub(sub.start_time);

                let similar_strict = texts_are_similar(&prev_key, &sub_key, similarity_threshold);
                let similar_short = texts_are_similar(&prev_key, &sub_key, 0.85);
                let is_short = prev_dur < min_cue_duration_ms || sub_dur < min_cue_duration_ms;

                if gap <= max_gap_ms && (similar_strict || (is_short && similar_short)) {
                    prev.end_time = prev.end_time.max(sub.end_time);
                    if sub.confidence > prev.confidence + 1e-9
                        || ((sub.confidence - prev.confidence).abs() <= 1e-9
                            && sub.text.len() > prev.text.len())
                    {
                        prev.text = sub.text;
                    }
                    prev.confidence = prev.confidence.max(sub.confidence);
                    continue;
                }
            }

            merged.push(sub);
        }

        // Re-number ids to be stable after merges.
        for (i, sub) in merged.iter_mut().enumerate() {
            sub.id = format!("sub-{}", i + 1);
        }

        subtitles = merged;
    }

    // Emit completion
    let _ = app.emit(
        "ocr-progress",
        serde_json::json!({
            "fileId": file_id,
            "phase": "generating",
            "current": frame_results.len(),
            "total": frame_results.len(),
            "message": format!("Generated {} subtitles", subtitles.len())
        }),
    );

    Ok(subtitles)
}
