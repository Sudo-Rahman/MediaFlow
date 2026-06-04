#![allow(dead_code)]

use std::borrow::Cow;

use crate::tools::subtitle_ocr::{SubtitleOcrCue, SubtitleOcrPlacement};

pub(crate) fn stabilize_cues(cues: &[SubtitleOcrCue]) -> Vec<SubtitleOcrCue> {
    let mut stabilized: Vec<SubtitleOcrCue> = Vec::new();
    let mut placement_states: Vec<PlacementMergeState> = Vec::new();

    for cue in cues {
        if cue.text.trim().is_empty() {
            continue;
        }

        if let Some(previous_index) = stabilized.len().checked_sub(1) {
            let previous = &stabilized[previous_index];
            let is_adjacent = cue.start_time_ms <= previous.end_time_ms.saturating_add(250);

            if normalize_line_endings(&previous.text) == normalize_line_endings(&cue.text)
                && is_adjacent
            {
                let previous = &mut stabilized[previous_index];
                let placement_state = &mut placement_states[previous_index];
                placement_state.add(cue);
                previous.end_time_ms = previous.end_time_ms.max(cue.end_time_ms);
                previous.confidence = previous.confidence.max(cue.confidence);
                placement_state.apply_to_cue(previous);
                previous
                    .source_cue_ids
                    .extend(cue.source_cue_ids.iter().cloned());
                continue;
            }
        }

        stabilized.push(cue.clone());
        placement_states.push(PlacementMergeState::from_cue(cue));
    }

    stabilized
}

#[derive(Debug, Clone, Copy, Default)]
struct PlacementMergeState {
    placed_weight: usize,
    top_weight: usize,
}

impl PlacementMergeState {
    fn from_cue(cue: &SubtitleOcrCue) -> Self {
        let mut state = Self::default();
        state.add(cue);
        state
    }

    fn add(&mut self, cue: &SubtitleOcrCue) {
        if let Some(placed_weight) = cue.placement_source_count.filter(|count| *count > 0) {
            self.placed_weight = self.placed_weight.saturating_add(placed_weight as usize);
            self.top_weight = self.top_weight.saturating_add(
                cue.top_placement_source_count
                    .unwrap_or(0)
                    .min(placed_weight) as usize,
            );
            return;
        }

        let weight = cue.source_cue_ids.len().max(1);
        match cue.placement {
            Some(SubtitleOcrPlacement::Top) => {
                self.placed_weight = self.placed_weight.saturating_add(weight);
                self.top_weight = self.top_weight.saturating_add(weight);
            }
            Some(SubtitleOcrPlacement::Bottom) => {
                self.placed_weight = self.placed_weight.saturating_add(weight);
            }
            None => {}
        }
    }

    fn apply_to_cue(&self, cue: &mut SubtitleOcrCue) {
        cue.placement = self.placement();
        if self.placed_weight == 0 {
            cue.placement_source_count = None;
            cue.top_placement_source_count = None;
            return;
        }

        cue.placement_source_count = Some(saturating_u32(self.placed_weight));
        cue.top_placement_source_count = Some(saturating_u32(self.top_weight));
    }

    fn placement(&self) -> Option<SubtitleOcrPlacement> {
        if self.placed_weight == 0 {
            return None;
        }

        if self.top_weight > self.placed_weight / 2 {
            Some(SubtitleOcrPlacement::Top)
        } else {
            Some(SubtitleOcrPlacement::Bottom)
        }
    }
}

fn saturating_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
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
    use crate::tools::subtitle_ocr::{SubtitleOcrCue, SubtitleOcrPlacement};

    fn cue(id: &str, start_time_ms: u64, end_time_ms: u64, text: &str) -> SubtitleOcrCue {
        SubtitleOcrCue {
            id: id.to_string(),
            source_cue_ids: vec![id.to_string()],
            start_time_ms,
            end_time_ms,
            text: text.to_string(),
            confidence: 0.8,
            placement: Some(SubtitleOcrPlacement::Bottom),
            placement_source_count: Some(1),
            top_placement_source_count: Some(0),
        }
    }

    fn placed_cue(
        id: &str,
        start_time_ms: u64,
        end_time_ms: u64,
        text: &str,
        placement: SubtitleOcrPlacement,
    ) -> SubtitleOcrCue {
        let top_placement_source_count = match placement {
            SubtitleOcrPlacement::Top => 1,
            SubtitleOcrPlacement::Bottom => 0,
        };

        SubtitleOcrCue {
            placement: Some(placement),
            top_placement_source_count: Some(top_placement_source_count),
            ..cue(id, start_time_ms, end_time_ms, text)
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
    fn non_adjacent_identical_text_does_not_merge() {
        let cues = vec![cue("a", 0, 1_000, "OK"), cue("b", 60_000, 61_000, "OK")];

        let stabilized = stabilize_cues(&cues);

        assert_eq!(stabilized.len(), 2);
        assert_eq!(stabilized[0].source_cue_ids, vec!["a"]);
        assert_eq!(stabilized[1].source_cue_ids, vec!["b"]);
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

    #[test]
    fn merged_cue_keeps_top_only_for_majority_top_sources() {
        let mut previous_top = placed_cue("a", 0, 1_000, "Hello", SubtitleOcrPlacement::Top);
        previous_top.source_cue_ids = vec!["a1".to_string(), "a2".to_string()];
        previous_top.placement_source_count = Some(2);
        previous_top.top_placement_source_count = Some(2);
        let bottom = placed_cue("b", 1_100, 2_000, "Hello", SubtitleOcrPlacement::Bottom);

        let stabilized = stabilize_cues(&[previous_top, bottom]);

        assert_eq!(stabilized.len(), 1);
        assert_eq!(stabilized[0].placement, Some(SubtitleOcrPlacement::Top));
    }

    #[test]
    fn merged_cue_defaults_bottom_when_top_is_not_majority() {
        let top = placed_cue("a", 0, 1_000, "Hello", SubtitleOcrPlacement::Top);
        let bottom = placed_cue("b", 1_100, 2_000, "Hello", SubtitleOcrPlacement::Bottom);

        let stabilized = stabilize_cues(&[top, bottom]);

        assert_eq!(stabilized.len(), 1);
        assert_eq!(stabilized[0].placement, Some(SubtitleOcrPlacement::Bottom));
    }

    #[test]
    fn merged_cue_tracks_top_majority_across_three_sources() {
        let cues = vec![
            placed_cue("a", 0, 1_000, "Hello", SubtitleOcrPlacement::Top),
            placed_cue("b", 1_100, 2_000, "Hello", SubtitleOcrPlacement::Bottom),
            placed_cue("c", 2_100, 3_000, "Hello", SubtitleOcrPlacement::Top),
        ];

        let stabilized = stabilize_cues(&cues);

        assert_eq!(stabilized.len(), 1);
        assert_eq!(stabilized[0].placement, Some(SubtitleOcrPlacement::Top));
        assert_eq!(stabilized[0].placement_source_count, Some(3));
        assert_eq!(stabilized[0].top_placement_source_count, Some(2));
    }

    #[test]
    fn merged_cue_preserves_missing_placement_when_sources_have_none() {
        let mut first = cue("a", 0, 1_000, "Hello");
        first.placement = None;
        first.placement_source_count = None;
        first.top_placement_source_count = None;
        let mut second = cue("b", 1_100, 2_000, "Hello");
        second.placement = None;
        second.placement_source_count = None;
        second.top_placement_source_count = None;

        let stabilized = stabilize_cues(&[first, second]);

        assert_eq!(stabilized.len(), 1);
        assert_eq!(stabilized[0].placement, None);
        assert_eq!(stabilized[0].placement_source_count, None);
        assert_eq!(stabilized[0].top_placement_source_count, None);
    }

    #[test]
    fn merged_cue_uses_existing_placement_source_counts() {
        let mut mixed = placed_cue("a", 0, 2_000, "Hello", SubtitleOcrPlacement::Bottom);
        mixed.source_cue_ids = vec!["a1".to_string(), "a2".to_string()];
        mixed.placement_source_count = Some(2);
        mixed.top_placement_source_count = Some(1);
        let top = placed_cue("b", 2_100, 3_000, "Hello", SubtitleOcrPlacement::Top);

        let stabilized = stabilize_cues(&[mixed, top]);

        assert_eq!(stabilized.len(), 1);
        assert_eq!(stabilized[0].placement, Some(SubtitleOcrPlacement::Top));
        assert_eq!(stabilized[0].placement_source_count, Some(3));
        assert_eq!(stabilized[0].top_placement_source_count, Some(2));
    }
}
