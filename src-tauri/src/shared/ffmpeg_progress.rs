use std::time::Instant;

const DEFAULT_EMA_ALPHA: f64 = 0.25;

#[derive(Debug, Clone, Copy)]
pub(crate) struct FfmpegProgressUpdate {
    pub(crate) progress: Option<i32>,
    pub(crate) speed_bytes_per_sec: Option<f64>,
    pub(crate) current_frame: Option<u64>,
    pub(crate) total_frames: Option<u64>,
    pub(crate) frames_per_second: Option<f64>,
    pub(crate) is_end: bool,
}

pub(crate) struct FfmpegProgressTracker {
    duration_us: Option<u64>,
    total_frames: Option<u64>,
    start_instant: Instant,
    last_out_time_us: Option<u64>,
    current_frame: Option<u64>,
    frames_per_second: Option<f64>,
    last_total_size_bytes: Option<u64>,
    last_total_size_elapsed_seconds: Option<f64>,
    smoothed_speed_bytes_per_sec: Option<f64>,
    ema_alpha: f64,
}

impl FfmpegProgressTracker {
    pub(crate) fn new(duration_us: Option<u64>) -> Self {
        Self::with_total_frames(duration_us, None)
    }

    pub(crate) fn with_total_frames(duration_us: Option<u64>, total_frames: Option<u64>) -> Self {
        Self {
            duration_us: duration_us.filter(|value| *value > 0),
            total_frames: total_frames.filter(|value| *value > 0),
            start_instant: Instant::now(),
            last_out_time_us: None,
            current_frame: None,
            frames_per_second: None,
            last_total_size_bytes: None,
            last_total_size_elapsed_seconds: None,
            smoothed_speed_bytes_per_sec: None,
            ema_alpha: DEFAULT_EMA_ALPHA,
        }
    }

    pub(crate) fn handle_line(&mut self, line: &str) -> Option<FfmpegProgressUpdate> {
        let (key, value) = parse_progress_kv(line)?;

        match key {
            "out_time_us" => {
                let out_time_us = value.parse::<u64>().ok()?;
                self.last_out_time_us = Some(out_time_us);
                Some(self.build_update(self.compute_running_progress(), false))
            }
            "frame" => {
                self.current_frame = value.parse::<u64>().ok();
                Some(self.build_update(self.compute_running_progress(), false))
            }
            "fps" => {
                let frames_per_second = value.parse::<f64>().ok()?;
                if frames_per_second.is_finite() && frames_per_second >= 0.0 {
                    self.frames_per_second = Some(frames_per_second);
                }
                Some(self.build_update(self.compute_running_progress(), false))
            }
            "total_size" => {
                let total_size_bytes = value.parse::<u64>().ok()?;
                self.update_speed(total_size_bytes, self.start_instant.elapsed().as_secs_f64());
                self.smoothed_speed_bytes_per_sec
                    .map(|_| self.build_update(self.compute_running_progress(), false))
            }
            "progress" if value == "end" => Some(self.build_update(Some(100), true)),
            _ => None,
        }
    }

    fn build_update(&self, progress: Option<i32>, is_end: bool) -> FfmpegProgressUpdate {
        FfmpegProgressUpdate {
            progress,
            speed_bytes_per_sec: self.smoothed_speed_bytes_per_sec,
            current_frame: self.current_frame,
            total_frames: self.total_frames,
            frames_per_second: self.frames_per_second,
            is_end,
        }
    }

    fn compute_running_progress(&self) -> Option<i32> {
        [self.compute_time_progress(), self.compute_frame_progress()]
            .into_iter()
            .flatten()
            .max()
    }

    fn compute_time_progress(&self) -> Option<i32> {
        let duration_us = self.duration_us?;
        let out_time_us = self.last_out_time_us?;

        let raw_progress = ((out_time_us as f64 / duration_us as f64) * 100.0).clamp(0.0, 99.0);
        Some(raw_progress.round() as i32)
    }

    fn compute_frame_progress(&self) -> Option<i32> {
        let total_frames = self.total_frames?;
        let current_frame = self.current_frame?;

        let raw_progress = ((current_frame as f64 / total_frames as f64) * 100.0).clamp(0.0, 99.0);
        Some(raw_progress.round() as i32)
    }

    fn update_speed(&mut self, total_size_bytes: u64, elapsed_seconds: f64) {
        if let (Some(last_size), Some(last_elapsed_seconds)) = (
            self.last_total_size_bytes,
            self.last_total_size_elapsed_seconds,
        ) {
            let elapsed_delta = elapsed_seconds - last_elapsed_seconds;
            if elapsed_delta > 0.0 && total_size_bytes >= last_size {
                let bytes_delta = total_size_bytes - last_size;
                let instant_speed = bytes_delta as f64 / elapsed_delta;
                if instant_speed.is_finite() && instant_speed > 0.0 {
                    self.smoothed_speed_bytes_per_sec =
                        Some(match self.smoothed_speed_bytes_per_sec {
                            Some(previous) => {
                                (self.ema_alpha * instant_speed)
                                    + ((1.0 - self.ema_alpha) * previous)
                            }
                            None => instant_speed,
                        });
                }
            }
        }

        self.last_total_size_bytes = Some(total_size_bytes);
        self.last_total_size_elapsed_seconds = Some(elapsed_seconds);
    }
}

fn parse_progress_kv(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim();
    let (key, value) = trimmed.split_once('=')?;
    Some((key.trim(), value.trim()))
}

#[cfg(test)]
mod tests {
    use super::{FfmpegProgressTracker, parse_progress_kv};

    fn approx_eq(left: f64, right: f64, epsilon: f64) {
        assert!((left - right).abs() <= epsilon);
    }

    #[test]
    fn parse_progress_kv_extracts_key_and_value() {
        assert_eq!(
            parse_progress_kv("out_time_us=123456"),
            Some(("out_time_us", "123456"))
        );
        assert_eq!(
            parse_progress_kv("total_size = 1024"),
            Some(("total_size", "1024"))
        );
        assert_eq!(parse_progress_kv("invalid"), None);
    }

    #[test]
    fn tracker_parses_out_time_us_and_computes_progress() {
        let mut tracker = FfmpegProgressTracker::new(Some(1_000_000));
        let update = tracker
            .handle_line("out_time_us=500000")
            .expect("progress update should exist");
        assert_eq!(update.progress, Some(50));
        assert!(!update.is_end);
    }

    #[test]
    fn tracker_clamps_running_progress_and_sets_100_on_end() {
        let mut tracker = FfmpegProgressTracker::new(Some(1_000_000));
        let running = tracker
            .handle_line("out_time_us=5000000")
            .expect("running progress should exist");
        assert_eq!(running.progress, Some(99));

        let finished = tracker
            .handle_line("progress=end")
            .expect("end progress should exist");
        assert_eq!(finished.progress, Some(100));
        assert!(finished.is_end);
    }

    #[test]
    fn tracker_calculates_smoothed_speed_with_ema() {
        let mut tracker = FfmpegProgressTracker::new(Some(1_000_000));

        tracker.update_speed(1_000_000, 1.0);
        assert!(tracker.smoothed_speed_bytes_per_sec.is_none());

        tracker.update_speed(2_000_000, 2.0);
        let first_speed = tracker
            .smoothed_speed_bytes_per_sec
            .expect("speed should be available after second sample");
        approx_eq(first_speed, 1_000_000.0, 0.1);

        tracker.update_speed(4_000_000, 3.0);
        let second_speed = tracker
            .smoothed_speed_bytes_per_sec
            .expect("speed should remain available");
        approx_eq(second_speed, 1_250_000.0, 0.1);
    }

    #[test]
    fn tracker_ignores_non_positive_speed_samples() {
        let mut tracker = FfmpegProgressTracker::new(None);
        tracker.update_speed(2_000, 1.0);
        tracker.update_speed(2_000, 2.0);
        assert!(tracker.smoothed_speed_bytes_per_sec.is_none());
    }

    #[test]
    fn tracker_emits_speed_update_from_total_size_without_duration() {
        let mut tracker = FfmpegProgressTracker::new(None);

        let first = tracker.handle_line("total_size=1000000");
        assert!(first.is_none());

        let second = tracker
            .handle_line("total_size=2000000")
            .expect("speed update should be emitted");
        assert_eq!(second.progress, None);
        assert!(second.speed_bytes_per_sec.is_some());
        assert!(!second.is_end);
    }

    #[test]
    fn tracker_uses_frame_progress_when_timestamps_lag() {
        let mut tracker = FfmpegProgressTracker::with_total_frames(Some(100_000_000), Some(1_000));

        let timestamp_update = tracker
            .handle_line("out_time_us=5000000")
            .expect("timestamp progress should exist");
        assert_eq!(timestamp_update.progress, Some(5));

        let frame_update = tracker
            .handle_line("frame=500")
            .expect("frame progress should exist");
        assert_eq!(frame_update.progress, Some(50));
        assert_eq!(frame_update.current_frame, Some(500));
        assert_eq!(frame_update.total_frames, Some(1_000));
    }

    #[test]
    fn tracker_parses_fps_metric() {
        let mut tracker = FfmpegProgressTracker::with_total_frames(Some(100_000_000), Some(1_000));

        let update = tracker
            .handle_line("fps=123.45")
            .expect("fps metric should emit an update");
        assert_eq!(update.frames_per_second, Some(123.45));
    }
}
