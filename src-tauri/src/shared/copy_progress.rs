use std::time::Instant;

const DEFAULT_EMA_ALPHA: f64 = 0.25;
const MIN_SPEED_SAMPLE_WINDOW_SECONDS: f64 = 0.25;

#[derive(Debug, Clone, Copy)]
pub(crate) struct CopyProgressUpdate {
    pub(crate) progress: i32,
    pub(crate) speed_bytes_per_sec: Option<f64>,
}

pub(crate) struct CopyProgressTracker {
    total_bytes: u64,
    start_instant: Instant,
    speed_window_start_bytes: Option<u64>,
    speed_window_start_elapsed_seconds: Option<f64>,
    smoothed_speed_bytes_per_sec: Option<f64>,
    ema_alpha: f64,
    min_speed_sample_window_seconds: f64,
}

impl CopyProgressTracker {
    pub(crate) fn new(total_bytes: u64) -> Self {
        Self {
            total_bytes,
            start_instant: Instant::now(),
            speed_window_start_bytes: None,
            speed_window_start_elapsed_seconds: None,
            smoothed_speed_bytes_per_sec: None,
            ema_alpha: DEFAULT_EMA_ALPHA,
            min_speed_sample_window_seconds: MIN_SPEED_SAMPLE_WINDOW_SECONDS,
        }
    }

    pub(crate) fn observe(&mut self, copied_bytes: u64) -> CopyProgressUpdate {
        self.observe_with_elapsed(copied_bytes, self.start_instant.elapsed().as_secs_f64())
    }

    fn observe_with_elapsed(
        &mut self,
        copied_bytes: u64,
        elapsed_seconds: f64,
    ) -> CopyProgressUpdate {
        let clamped_bytes = copied_bytes.min(self.total_bytes);
        self.update_speed(clamped_bytes, elapsed_seconds);

        CopyProgressUpdate {
            progress: compute_progress_percentage(clamped_bytes, self.total_bytes),
            speed_bytes_per_sec: self.smoothed_speed_bytes_per_sec,
        }
    }

    fn update_speed(&mut self, total_size_bytes: u64, elapsed_seconds: f64) {
        if !elapsed_seconds.is_finite() || elapsed_seconds < 0.0 {
            return;
        }

        let (window_start_bytes, window_start_elapsed_seconds) = match (
            self.speed_window_start_bytes,
            self.speed_window_start_elapsed_seconds,
        ) {
            (Some(bytes), Some(seconds)) => (bytes, seconds),
            _ => {
                self.speed_window_start_bytes = Some(total_size_bytes);
                self.speed_window_start_elapsed_seconds = Some(elapsed_seconds);
                return;
            }
        };

        if total_size_bytes < window_start_bytes {
            self.speed_window_start_bytes = Some(total_size_bytes);
            self.speed_window_start_elapsed_seconds = Some(elapsed_seconds);
            return;
        }

        let elapsed_delta = elapsed_seconds - window_start_elapsed_seconds;
        if elapsed_delta < self.min_speed_sample_window_seconds {
            return;
        }
        if elapsed_delta <= 0.0 {
            self.speed_window_start_bytes = Some(total_size_bytes);
            self.speed_window_start_elapsed_seconds = Some(elapsed_seconds);
            return;
        }

        let bytes_delta = total_size_bytes - window_start_bytes;
        if bytes_delta > 0 {
            let instant_speed = bytes_delta as f64 / elapsed_delta;
            if instant_speed.is_finite() && instant_speed > 0.0 {
                self.smoothed_speed_bytes_per_sec = Some(match self.smoothed_speed_bytes_per_sec {
                    Some(previous) => {
                        (self.ema_alpha * instant_speed) + ((1.0 - self.ema_alpha) * previous)
                    }
                    None => instant_speed,
                });
            }
        }

        self.speed_window_start_bytes = Some(total_size_bytes);
        self.speed_window_start_elapsed_seconds = Some(elapsed_seconds);
    }
}

fn compute_progress_percentage(copied_bytes: u64, total_bytes: u64) -> i32 {
    if total_bytes == 0 {
        return 100;
    }

    let ratio = (copied_bytes as f64 / total_bytes as f64).clamp(0.0, 1.0);
    (ratio * 100.0).round() as i32
}

#[cfg(test)]
mod tests {
    use super::{CopyProgressTracker, compute_progress_percentage};

    fn approx_eq(left: f64, right: f64, epsilon: f64) {
        assert!((left - right).abs() <= epsilon);
    }

    #[test]
    fn compute_progress_percentage_returns_100_for_empty_files() {
        assert_eq!(compute_progress_percentage(0, 0), 100);
    }

    #[test]
    fn compute_progress_percentage_clamps_to_bounds() {
        assert_eq!(compute_progress_percentage(0, 10), 0);
        assert_eq!(compute_progress_percentage(5, 10), 50);
        assert_eq!(compute_progress_percentage(15, 10), 100);
    }

    #[test]
    fn tracker_produces_speed_after_second_sample() {
        let mut tracker = CopyProgressTracker::new(10_000);

        let first = tracker.observe_with_elapsed(1_000, 0.0);
        assert_eq!(first.progress, 10);
        assert!(first.speed_bytes_per_sec.is_none());

        let second = tracker.observe_with_elapsed(3_000, 1.0);
        assert_eq!(second.progress, 30);
        let speed = second
            .speed_bytes_per_sec
            .expect("speed should be available on second sample");
        approx_eq(speed, 2_000.0, 0.1);
    }

    #[test]
    fn tracker_waits_for_minimum_window_before_reporting_speed() {
        let mut tracker = CopyProgressTracker::new(10_000);

        let _ = tracker.observe_with_elapsed(0, 0.0);
        let first_window = tracker.observe_with_elapsed(2_000, 0.10);
        assert!(first_window.speed_bytes_per_sec.is_none());

        let second_window = tracker.observe_with_elapsed(4_000, 0.20);
        assert!(second_window.speed_bytes_per_sec.is_none());
    }

    #[test]
    fn tracker_applies_smoothing_only_after_valid_windows() {
        let mut tracker = CopyProgressTracker::new(20_000);

        let _ = tracker.observe_with_elapsed(0, 0.0);
        let first = tracker.observe_with_elapsed(6_000, 0.30);
        let first_speed = first
            .speed_bytes_per_sec
            .expect("speed should exist for first valid window");
        approx_eq(first_speed, 20_000.0, 0.1);

        let skipped = tracker.observe_with_elapsed(8_000, 0.40);
        let skipped_speed = skipped
            .speed_bytes_per_sec
            .expect("speed should retain last smoothed value");
        approx_eq(skipped_speed, first_speed, 0.1);

        let second = tracker.observe_with_elapsed(10_000, 0.70);
        let second_speed = second
            .speed_bytes_per_sec
            .expect("speed should be updated by second valid window");
        approx_eq(second_speed, 17_500.0, 0.5);
    }

    #[test]
    fn tracker_ignores_non_positive_speed_samples() {
        let mut tracker = CopyProgressTracker::new(10_000);

        let _ = tracker.observe_with_elapsed(2_000, 0.0);
        let same_bytes = tracker.observe_with_elapsed(2_000, 0.30);
        assert!(same_bytes.speed_bytes_per_sec.is_none());

        let lower_bytes = tracker.observe_with_elapsed(1_000, 0.70);
        assert!(lower_bytes.speed_bytes_per_sec.is_none());
    }
}
