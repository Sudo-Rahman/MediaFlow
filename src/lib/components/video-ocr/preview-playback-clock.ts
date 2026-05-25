export interface PreviewPlaybackFrame {
  timeSeconds: number;
}

export interface PreviewPlaybackClockVideo {
  currentTime: number;
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime?: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

export interface PreviewPlaybackClockOptions {
  onFrame: (frame: PreviewPlaybackFrame) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

export interface PreviewPlaybackClock {
  start: (video: PreviewPlaybackClockVideo) => void;
  stop: () => void;
  syncOnce: (video: PreviewPlaybackClockVideo) => void;
}

interface PendingFrame {
  handle: number;
  video: PreviewPlaybackClockVideo;
  type: 'video-frame' | 'animation-frame';
}

function readPlaybackTimeSeconds(video: PreviewPlaybackClockVideo, mediaTime?: number): number {
  const timeSeconds = typeof mediaTime === 'number' && Number.isFinite(mediaTime)
    ? mediaTime
    : video.currentTime;

  return Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
}

function hasVideoFrameClock(video: PreviewPlaybackClockVideo): video is PreviewPlaybackClockVideo & {
  requestVideoFrameCallback: NonNullable<PreviewPlaybackClockVideo['requestVideoFrameCallback']>;
  cancelVideoFrameCallback: NonNullable<PreviewPlaybackClockVideo['cancelVideoFrameCallback']>;
} {
  return typeof video.requestVideoFrameCallback === 'function'
    && typeof video.cancelVideoFrameCallback === 'function';
}

function getDefaultRequestAnimationFrame(): ((callback: FrameRequestCallback) => number) | undefined {
  return typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : undefined;
}

function getDefaultCancelAnimationFrame(): ((handle: number) => void) | undefined {
  return typeof globalThis.cancelAnimationFrame === 'function'
    ? globalThis.cancelAnimationFrame.bind(globalThis)
    : undefined;
}

export function createPreviewPlaybackClock({
  onFrame,
  requestAnimationFrame: requestAnimationFrameOption = getDefaultRequestAnimationFrame(),
  cancelAnimationFrame: cancelAnimationFrameOption = getDefaultCancelAnimationFrame(),
}: PreviewPlaybackClockOptions): PreviewPlaybackClock {
  let activeVideo: PreviewPlaybackClockVideo | null = null;
  let pendingFrame: PendingFrame | null = null;

  function cancelPendingFrame(): void {
    if (!pendingFrame) {
      return;
    }

    if (pendingFrame.type === 'video-frame') {
      pendingFrame.video.cancelVideoFrameCallback?.(pendingFrame.handle);
    } else {
      cancelAnimationFrameOption?.(pendingFrame.handle);
    }
    pendingFrame = null;
  }

  function publish(video: PreviewPlaybackClockVideo, mediaTime?: number): void {
    onFrame({ timeSeconds: readPlaybackTimeSeconds(video, mediaTime) });
  }

  function scheduleNextFrame(video: PreviewPlaybackClockVideo): void {
    cancelPendingFrame();

    if (!hasVideoFrameClock(video)) {
      scheduleNextAnimationFrame(video);
      return;
    }

    const handle = video.requestVideoFrameCallback((_now, metadata) => {
      if (activeVideo !== video) {
        return;
      }

      pendingFrame = null;
      publish(video, metadata.mediaTime);
      scheduleNextFrame(video);
    });

    pendingFrame = { handle, video, type: 'video-frame' };
  }

  function scheduleNextAnimationFrame(video: PreviewPlaybackClockVideo): void {
    if (!requestAnimationFrameOption || !cancelAnimationFrameOption) {
      publish(video);
      return;
    }

    const handle = requestAnimationFrameOption(() => {
      if (activeVideo !== video) {
        return;
      }

      pendingFrame = null;
      publish(video);
      scheduleNextFrame(video);
    });

    pendingFrame = { handle, video, type: 'animation-frame' };
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
