export interface PreviewPlaybackFrame {
  timeSeconds: number;
}

export interface PreviewPlaybackClockVideo {
  currentTime: number;
  requestVideoFrameCallback: (
    callback: (now: number, metadata: { mediaTime?: number }) => void,
  ) => number;
  cancelVideoFrameCallback: (handle: number) => void;
}

export interface PreviewPlaybackClockOptions {
  onFrame: (frame: PreviewPlaybackFrame) => void;
}

export interface PreviewPlaybackClock {
  start: (video: PreviewPlaybackClockVideo) => void;
  stop: () => void;
  syncOnce: (video: PreviewPlaybackClockVideo) => void;
}

interface PendingFrame {
  handle: number;
  video: PreviewPlaybackClockVideo;
}

function readPlaybackTimeSeconds(video: PreviewPlaybackClockVideo, mediaTime?: number): number {
  const timeSeconds = typeof mediaTime === 'number' && Number.isFinite(mediaTime)
    ? mediaTime
    : video.currentTime;

  return Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
}

export function createPreviewPlaybackClock({ onFrame }: PreviewPlaybackClockOptions): PreviewPlaybackClock {
  let activeVideo: PreviewPlaybackClockVideo | null = null;
  let pendingFrame: PendingFrame | null = null;

  function cancelPendingFrame(): void {
    if (!pendingFrame) {
      return;
    }

    pendingFrame.video.cancelVideoFrameCallback(pendingFrame.handle);
    pendingFrame = null;
  }

  function publish(video: PreviewPlaybackClockVideo, mediaTime?: number): void {
    onFrame({ timeSeconds: readPlaybackTimeSeconds(video, mediaTime) });
  }

  function scheduleNextFrame(video: PreviewPlaybackClockVideo): void {
    cancelPendingFrame();

    const handle = video.requestVideoFrameCallback((_now, metadata) => {
      if (activeVideo !== video) {
        return;
      }

      pendingFrame = null;
      publish(video, metadata.mediaTime);
      scheduleNextFrame(video);
    });

    pendingFrame = { handle, video };
  }

  return {
    start(video) {
      if (activeVideo === video && pendingFrame) {
        return;
      }

      activeVideo = video;
      scheduleNextFrame(video);
    },

    stop() {
      activeVideo = null;
      cancelPendingFrame();
    },

    syncOnce(video) {
      publish(video);
    },
  };
}
