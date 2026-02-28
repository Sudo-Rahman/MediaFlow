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

fn infer_frame_step_ms(frame_results: &[OcrFrameResult]) -> Option<u64> {
    if frame_results.len() < 2 {
        return None;
    }

    let mut deltas: Vec<u64> = frame_results
        .windows(2)
        .filter_map(|pair| {
            let delta = pair[1].time_ms.saturating_sub(pair[0].time_ms);
            (delta > 0).then_some(delta)
        })
        .collect();

    if deltas.is_empty() {
        return None;
    }

    deltas.sort_unstable();
    Some(deltas[deltas.len() / 2])
}

fn segment_end_time_ms(
    start_time: u64,
    last_seen_time: u64,
    last_seen_frame_index: u32,
    frame_step_ms: Option<u64>,
    fps: f64,
) -> u64 {
    let mut end_time = frame_step_ms
        .and_then(|step| last_seen_time.checked_add(step))
        .unwrap_or_else(|| frame_end_time_ms(last_seen_frame_index, fps));

    if end_time <= start_time {
        end_time = start_time.saturating_add(1);
    }

    end_time
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

    // Substring optimization: if one is completely contained within another,
    // and they represent a significant portion (to prevent tiny fragments matching huge sentences)
    if a_key.contains(b_key) || b_key.contains(a_key) {
        // If the size difference is very small (1 or 2 chars), or
        // the shorter text is at least a certain percentage of the longer text
        // we consider them a match to fix OCR edge truncations.
        if (max_len - min_len) <= 2 || (min_len as f64 / max_len as f64) >= 0.70 {
            return true;
        }
    }

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
    use crate::tools::ocr::{OcrFrameResult, OcrSubtitleCleanupOptions};

    #[test]
    fn texts_are_similar_merges_short_substrings() {
        assert!(super::texts_are_similar("关门", "关", 0.9));
        assert!(super::texts_are_similar("关", "关门", 0.9));
    }

    #[test]
    fn texts_are_similar_merges_long_substrings() {
        assert!(super::texts_are_similar("hello world", "hello worl", 0.9));
        assert!(super::texts_are_similar(
            "这是一个长句子的开头",
            "这是一个长句子的开头和结尾",
            0.8
        ));
    }

    #[test]
    fn texts_are_similar_rejects_too_short_substrings() {
        assert!(!super::texts_are_similar("这是一个非常长的句子", "一", 0.9));
    }

    #[test]
    fn texts_are_similar_merges_short_texts_with_single_char_difference() {
        assert!(super::texts_are_similar("吴昊 菲菲", "昊昊 菲菲", 0.85));
    }

    #[test]
    fn texts_are_similar_keeps_short_exact_matches() {
        assert!(super::texts_are_similar("哥哥", "哥哥", 0.92));
    }

    #[test]
    fn texts_are_similar_rejects_short_texts_with_multiple_char_differences() {
        assert!(!super::texts_are_similar("吴昊 菲菲", "叶昊 爸爸", 0.85));
    }

    #[test]
    fn texts_are_similar_preserves_long_text_similarity_behavior() {
        assert!(super::texts_are_similar(
            "today we fight together",
            "today we fight togather",
            0.92
        ));
        assert!(!super::texts_are_similar(
            "today we fight together",
            "tomorrow we run away",
            0.92
        ));
    }

    #[test]
    fn collapse_whitespace_trims_and_deduplicates_spaces() {
        assert_eq!(
            super::collapse_whitespace("  hello   world \n\t"),
            "hello world"
        );
    }

    #[test]
    fn normalize_text_for_compare_strips_punctuation() {
        assert_eq!(
            super::normalize_text_for_compare("《Hello, World!》"),
            "hello, world"
        );
    }

    #[test]
    fn levenshtein_distance_bounded_returns_none_when_distance_too_large() {
        let a: Vec<char> = "abc".chars().collect();
        let b: Vec<char> = "xyz".chars().collect();
        assert_eq!(super::levenshtein_distance_bounded(&a, &b, 1), None);
    }

    #[test]
    fn token_looks_like_domain_detects_common_domains() {
        assert!(super::token_looks_like_domain("example.com"));
        assert!(!super::token_looks_like_domain("not-a-domain"));
    }

    #[test]
    fn text_looks_url_like_detects_links_and_domains() {
        assert!(super::text_looks_url_like("visit https://example.com now"));
        assert!(super::text_looks_url_like("example.org"));
        assert!(!super::text_looks_url_like("plain subtitle text"));
    }

    #[test]
    fn select_segment_text_prefers_highest_confidence_candidate() {
        let candidates = vec![
            super::SegmentCandidate {
                key: "hello".to_string(),
                text: "hello".to_string(),
                confidence: 0.82,
            },
            super::SegmentCandidate {
                key: "hello".to_string(),
                text: "hello!".to_string(),
                confidence: 0.95,
            },
            super::SegmentCandidate {
                key: "hullo".to_string(),
                text: "hullo".to_string(),
                confidence: 0.90,
            },
        ];

        let selected =
            super::select_segment_text(&candidates).expect("candidate should be selected");
        assert_eq!(selected.0, "hello!");
        assert!((selected.1 - 0.95).abs() < 1e-9);
    }

    #[test]
    fn select_segment_text_prefers_longest_when_confidence_is_close() {
        let candidates = vec![
            super::SegmentCandidate {
                key: "关门".to_string(), // Longer but slightly less confident
                text: "关门".to_string(),
                confidence: 0.961,
            },
            super::SegmentCandidate {
                key: "关".to_string(), // Shorter but slightly more confident
                text: "关".to_string(),
                confidence: 0.995,
            },
            super::SegmentCandidate {
                key: "关门".to_string(), // Another slightly less confident longer one
                text: "关门".to_string(),
                confidence: 0.994, // 0.995 vs 0.994 is < 0.05
            },
        ];

        let selected =
            super::select_segment_text(&candidates).expect("candidate should be selected");
        assert_eq!(selected.0, "关门");
    }

    #[test]
    fn select_segment_text_prefers_frequent_when_confidence_is_close() {
        let candidates = vec![
            super::SegmentCandidate {
                key: "A".to_string(),
                text: "A".to_string(),
                confidence: 0.95,
            },
            super::SegmentCandidate {
                key: "A".to_string(),
                text: "A".to_string(),
                confidence: 0.95,
            },
            super::SegmentCandidate {
                key: "A".to_string(),
                text: "A".to_string(),
                confidence: 0.95,
            },
            super::SegmentCandidate {
                key: "B".to_string(), // B is slightly more confident, but only appears once
                text: "B".to_string(),
                confidence: 0.96,
            },
        ];

        let selected =
            super::select_segment_text(&candidates).expect("candidate should be selected");
        // A should win due to frequency bonus
        assert_eq!(selected.0, "A");
    }

    #[test]
    fn generate_subtitles_merges_similar_adjacent_frames() {
        let frames = vec![
            OcrFrameResult {
                frame_index: 0,
                time_ms: 0,
                text: "Hello world".to_string(),
                confidence: 0.92,
            },
            OcrFrameResult {
                frame_index: 1,
                time_ms: 500,
                text: "Hello world".to_string(),
                confidence: 0.93,
            },
            OcrFrameResult {
                frame_index: 2,
                time_ms: 1000,
                text: "Hello world".to_string(),
                confidence: 0.94,
            },
        ];

        let subtitles = super::generate_subtitles_core(
            &frames,
            2.0,
            0.5,
            OcrSubtitleCleanupOptions::default(),
            |_current, _total| {},
        )
        .expect("subtitle generation should succeed");

        assert_eq!(subtitles.len(), 1);
        assert_eq!(subtitles[0].id, "sub-1");
        assert!(subtitles[0].text.to_lowercase().contains("hello"));
        assert!(subtitles[0].end_time > subtitles[0].start_time);
    }

    #[test]
    fn generate_subtitles_uses_time_ms_for_end_time_when_fps_is_wrong() {
        let frames = vec![
            OcrFrameResult {
                frame_index: 0,
                time_ms: 0,
                text: "Timing test".to_string(),
                confidence: 0.95,
            },
            OcrFrameResult {
                frame_index: 1,
                time_ms: 67,
                text: "Timing test".to_string(),
                confidence: 0.95,
            },
            OcrFrameResult {
                frame_index: 2,
                time_ms: 133,
                text: "Timing test".to_string(),
                confidence: 0.95,
            },
        ];

        let subtitles = super::generate_subtitles_core(
            &frames,
            10.0,
            0.5,
            OcrSubtitleCleanupOptions::default(),
            |_current, _total| {},
        )
        .expect("subtitle generation should succeed");

        assert_eq!(subtitles.len(), 1);
        assert_eq!(subtitles[0].start_time, 0);
        assert_eq!(subtitles[0].end_time, 200);
    }

    #[test]
    fn generate_subtitles_falls_back_to_fps_when_time_deltas_are_unusable() {
        let frames = vec![
            OcrFrameResult {
                frame_index: 0,
                time_ms: 0,
                text: "Fallback timing".to_string(),
                confidence: 0.95,
            },
            OcrFrameResult {
                frame_index: 1,
                time_ms: 0,
                text: "Fallback timing".to_string(),
                confidence: 0.95,
            },
            OcrFrameResult {
                frame_index: 2,
                time_ms: 0,
                text: "Fallback timing".to_string(),
                confidence: 0.95,
            },
        ];

        let subtitles = super::generate_subtitles_core(
            &frames,
            10.0,
            0.5,
            OcrSubtitleCleanupOptions::default(),
            |_current, _total| {},
        )
        .expect("subtitle generation should succeed");

        assert_eq!(subtitles.len(), 1);
        assert_eq!(subtitles[0].start_time, 0);
        assert_eq!(subtitles[0].end_time, 300);
    }

    #[test]
    fn generate_subtitles_ignores_isolated_anomalous_frames() {
        // A-B-A pattern
        let frames = vec![
            OcrFrameResult {
                frame_index: 0,
                time_ms: 0,
                text: "Je suis une longue phrase".to_string(),
                confidence: 0.95,
            },
            OcrFrameResult {
                frame_index: 1,
                time_ms: 500,
                text: "Je su1s unel0ngu phrase".to_string(), // B: Anomalous
                confidence: 0.96,
            },
            OcrFrameResult {
                frame_index: 2,
                time_ms: 1000,
                text: "Je suis une longue phrase".to_string(), // A: Back to normal
                confidence: 0.95,
            },
        ];

        let cleanup = OcrSubtitleCleanupOptions {
            merge_similar: true,
            similarity_threshold: 0.95, // High threshold so B does NOT match A
            max_gap_ms: 1000,
            min_cue_duration_ms: 500,
            filter_url_like: false,
        };

        // Before fix: This would create "A", then "B", then "A".
        // After fix: It should create only "A" and absorb B.
        let subtitles =
            super::generate_subtitles_core(&frames, 2.0, 0.5, cleanup, |_current, _total| {})
                .expect("subtitle generation should succeed");

        assert_eq!(subtitles.len(), 1);
        assert_eq!(subtitles[0].start_time, 0);
        assert!(subtitles[0].end_time >= 1000);
        assert_eq!(subtitles[0].text, "Je suis une longue phrase");
    }

    #[test]
    fn generate_subtitles_aba_blip_does_not_extend_past_last_matching_frame() {
        let frames = vec![
            OcrFrameResult {
                frame_index: 0,
                time_ms: 0,
                text: "Je suis une longue phrase".to_string(),
                confidence: 0.95,
            },
            OcrFrameResult {
                frame_index: 1,
                time_ms: 500,
                text: "Je su1s unel0ngu phrase".to_string(),
                confidence: 0.96,
            },
            OcrFrameResult {
                frame_index: 2,
                time_ms: 1000,
                text: "Je suis une longue phrase".to_string(),
                confidence: 0.95,
            },
            OcrFrameResult {
                frame_index: 3,
                time_ms: 1500,
                text: "Une autre phrase".to_string(),
                confidence: 0.95,
            },
        ];

        let cleanup = OcrSubtitleCleanupOptions {
            merge_similar: true,
            similarity_threshold: 0.95,
            max_gap_ms: 1000,
            min_cue_duration_ms: 500,
            filter_url_like: false,
        };

        let subtitles =
            super::generate_subtitles_core(&frames, 2.0, 0.5, cleanup, |_current, _total| {})
                .expect("subtitle generation should succeed");

        assert_eq!(subtitles.len(), 2);
        assert_eq!(subtitles[0].text, "Je suis une longue phrase");
        assert_eq!(subtitles[0].end_time, 1500);
        assert_eq!(subtitles[1].start_time, 1500);
    }

    #[test]
    fn generate_subtitles_filters_url_like_text_when_enabled() {
        let frames = vec![
            OcrFrameResult {
                frame_index: 0,
                time_ms: 0,
                text: "www.example.com".to_string(),
                confidence: 0.99,
            },
            OcrFrameResult {
                frame_index: 1,
                time_ms: 1000,
                text: "Real subtitle".to_string(),
                confidence: 0.99,
            },
        ];

        let cleanup = OcrSubtitleCleanupOptions {
            merge_similar: false,
            similarity_threshold: 0.92,
            max_gap_ms: 250,
            min_cue_duration_ms: 300,
            filter_url_like: true,
        };

        let subtitles =
            super::generate_subtitles_core(&frames, 1.0, 0.5, cleanup, |_current, _total| {})
                .expect("subtitle generation should succeed");

        assert_eq!(subtitles.len(), 1);
        assert_eq!(subtitles[0].text, "Real subtitle");
    }

    #[test]
    fn generate_subtitles_rejects_zero_or_negative_fps() {
        let frames = vec![OcrFrameResult {
            frame_index: 0,
            time_ms: 0,
            text: "Hello".to_string(),
            confidence: 0.99,
        }];

        let zero_error = super::generate_subtitles_core(
            &frames,
            0.0,
            0.5,
            OcrSubtitleCleanupOptions::default(),
            |_current, _total| {},
        )
        .expect_err("zero fps should fail");
        assert!(zero_error.contains("FPS must be greater than 0"));

        let negative_error = super::generate_subtitles_core(
            &frames,
            -1.0,
            0.5,
            OcrSubtitleCleanupOptions::default(),
            |_current, _total| {},
        )
        .expect_err("negative fps should fail");
        assert!(negative_error.contains("FPS must be greater than 0"));
    }

    #[test]
    fn generate_subtitles_returns_empty_for_empty_frame_results() {
        let subtitles = super::generate_subtitles_core(
            &[],
            1.0,
            0.5,
            OcrSubtitleCleanupOptions::default(),
            |_current, _total| {},
        )
        .expect("empty frame input should succeed");

        assert!(subtitles.is_empty());
    }

    #[test]
    fn generate_subtitles_returns_empty_when_all_frames_below_confidence_threshold() {
        let frames = vec![
            OcrFrameResult {
                frame_index: 0,
                time_ms: 0,
                text: "Hello".to_string(),
                confidence: 0.10,
            },
            OcrFrameResult {
                frame_index: 1,
                time_ms: 1000,
                text: "World".to_string(),
                confidence: 0.15,
            },
        ];

        let subtitles = super::generate_subtitles_core(
            &frames,
            1.0,
            0.80,
            OcrSubtitleCleanupOptions::default(),
            |_current, _total| {},
        )
        .expect("subtitle generation should succeed");

        assert!(subtitles.is_empty());
    }

    #[test]
    fn generate_subtitles_handles_single_frame_input() {
        let frames = vec![OcrFrameResult {
            frame_index: 0,
            time_ms: 0,
            text: "Single frame".to_string(),
            confidence: 0.99,
        }];

        let subtitles = super::generate_subtitles_core(
            &frames,
            1.0,
            0.5,
            OcrSubtitleCleanupOptions::default(),
            |_current, _total| {},
        )
        .expect("subtitle generation should succeed");

        assert_eq!(subtitles.len(), 1);
        assert_eq!(subtitles[0].text, "Single frame");
        assert!(subtitles[0].end_time > subtitles[0].start_time);
    }

    #[test]
    fn generate_subtitles_merges_short_adjacent_cues_when_min_duration_requires_it() {
        let frames = vec![
            OcrFrameResult {
                frame_index: 0,
                time_ms: 0,
                text: "today we fight together".to_string(),
                confidence: 0.95,
            },
            OcrFrameResult {
                frame_index: 1,
                time_ms: 500,
                text: "today we fight togather".to_string(),
                confidence: 0.96,
            },
        ];

        let cleanup = OcrSubtitleCleanupOptions {
            merge_similar: true,
            similarity_threshold: 0.98,
            max_gap_ms: 1000,
            min_cue_duration_ms: 800,
            filter_url_like: false,
        };

        let subtitles =
            super::generate_subtitles_core(&frames, 2.0, 0.5, cleanup, |_current, _total| {})
                .expect("subtitle generation should succeed");

        assert_eq!(subtitles.len(), 1);
        assert_eq!(subtitles[0].start_time, 0);
        assert!(subtitles[0].end_time >= 1000);
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
    let mut best_score: f64 = -1.0;
    let mut final_confidence: f64 = -1.0;
    let mut best_text: &str = "";

    let total_candidates = candidates.len() as f64;

    for (key, (count, max_conf, text_at_max)) in stats {
        // Scoring system:
        // Base score is the maximum confidence (0.0 to 1.0)
        // Bonus for frequency: up to +0.05 if it appears in all frames
        // Bonus for length: slight bias towards longer text to prevent OCR truncation bias

        let frequency_ratio = count as f64 / total_candidates;
        let frequency_bonus = frequency_ratio * 0.05;

        // Small length bonus: 0.005 per character, capped at 0.05 (10 chars)
        let length_bonus = (text_at_max.chars().count() as f64 * 0.005).min(0.05);

        let score = max_conf + frequency_bonus + length_bonus;

        if score > best_score {
            best_key = Some(key);
            best_score = score;
            final_confidence = max_conf; // Keep the actual confidence for output
            best_text = text_at_max;
        }
    }

    best_key.map(|_| (best_text.to_string(), final_confidence))
}

pub(crate) fn generate_subtitles_core<F>(
    frame_results: &[OcrFrameResult],
    fps: f64,
    min_confidence: f64,
    cleanup: OcrSubtitleCleanupOptions,
    mut on_progress: F,
) -> Result<Vec<OcrSubtitleEntry>, String>
where
    F: FnMut(usize, usize),
{
    if fps <= 0.0 {
        return Err("FPS must be greater than 0".to_string());
    }

    let similarity_threshold = if cleanup.merge_similar {
        clamp_f64(cleanup.similarity_threshold, 0.80, 0.98)
    } else {
        1.0
    };
    let max_gap_ms = cleanup.max_gap_ms as u64;
    let min_confidence = clamp_f64(min_confidence, 0.0, 1.0);
    let min_cue_duration_ms = cleanup.min_cue_duration_ms as u64;
    let inferred_frame_step_ms = infer_frame_step_ms(frame_results);

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
                    let mut is_blip = false;

                    // Lookahead to smooth over OCR glitches (A-B-A pattern)
                    for lookahead_offset in 1..=2 {
                        if let Some(next_frame) = frame_results.get(i + lookahead_offset) {
                            let next_display_text = collapse_whitespace(next_frame.text.as_str());
                            let next_key = normalize_text_for_compare(&next_display_text);
                            let next_is_valid =
                                next_frame.confidence >= min_confidence && !next_key.is_empty();

                            if next_is_valid {
                                let next_similar = if cleanup.merge_similar {
                                    texts_are_similar(
                                        &seg.baseline_key,
                                        &next_key,
                                        similarity_threshold,
                                    )
                                } else {
                                    seg.baseline_key == next_key
                                };

                                if next_similar {
                                    is_blip = true;
                                    break;
                                }
                            }
                        }
                    }

                    if is_blip {
                        // This frame is likely an OCR glitch separating two identical valid frames.
                        // We ignore its text but consider the segment still active.
                        // Update last_seen_time so we don't trip max_gap_ms on the next valid frame.
                        seg.last_seen_time = frame.time_ms;
                        seg.last_seen_frame_index = frame.frame_index;
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

        if i % 100 == 0 {
            on_progress(i, frame_results.len());
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

        let end_time = segment_end_time_ms(
            seg.start_time,
            seg.last_seen_time,
            seg.last_seen_frame_index,
            inferred_frame_step_ms,
            fps,
        );

        subtitles.push(OcrSubtitleEntry {
            id: format!("sub-{}", subtitles.len() + 1),
            text,
            start_time: seg.start_time,
            end_time,
            confidence,
        });
    }

    if cleanup.filter_url_like {
        subtitles.retain(|s| !text_looks_url_like(&s.text));
    }

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
                let similar_short = texts_are_similar(&prev_key, &sub_key, 0.80);
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

        for (i, sub) in merged.iter_mut().enumerate() {
            sub.id = format!("sub-{}", i + 1);
        }

        subtitles = merged;
    }

    Ok(subtitles)
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
    let total_frames = frame_results.len();

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

    let app_for_progress = app.clone();
    let file_id_for_progress = file_id.clone();
    let subtitles = generate_subtitles_core(
        &frame_results,
        fps,
        min_confidence,
        cleanup,
        move |current, total| {
            let _ = app_for_progress.emit(
                "ocr-progress",
                serde_json::json!({
                    "fileId": file_id_for_progress.clone(),
                    "phase": "generating",
                    "current": current,
                    "total": total,
                    "message": format!("Processing frame {}...", current)
                }),
            );
        },
    )?;

    // Emit completion
    let _ = app.emit(
        "ocr-progress",
        serde_json::json!({
            "fileId": file_id,
            "phase": "generating",
            "current": total_frames,
            "total": total_frames,
            "message": format!("Generated {} subtitles", subtitles.len())
        }),
    );

    Ok(subtitles)
}
