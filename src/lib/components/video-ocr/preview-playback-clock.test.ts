import { describe, expect, it } from 'vitest';

import { createPreviewPlaybackClock } from './preview-playback-clock';

describe('preview playback clock', () => {
  it('uses requestVideoFrameCallback media time when available', () => {
    let callback: ((now: number, metadata: { mediaTime: number }) => void) | undefined;
    let cancelledHandle: number | null = null;
    const frames: number[] = [];
    const video = {
      currentTime: 12,
      requestVideoFrameCallback(nextCallback: (now: number, metadata: { mediaTime: number }) => void) {
        callback = nextCallback;
        return 42;
      },
      cancelVideoFrameCallback(handle: number) {
        cancelledHandle = handle;
      },
    };

    const clock = createPreviewPlaybackClock({
      onFrame: ({ timeSeconds }) => {
        frames.push(timeSeconds);
      },
    });

    clock.start(video);
    callback?.(100, { mediaTime: 12.25 });
    clock.stop();

    expect(frames).toEqual([12.25]);
    expect(cancelledHandle).toBe(42);
  });

  it('uses currentTime when frame metadata has no media time', () => {
    let callback: ((now: number, metadata: { mediaTime?: number }) => void) | undefined;
    let cancelledHandle: number | null = null;
    const frames: number[] = [];
    const video = {
      currentTime: 5,
      requestVideoFrameCallback(nextCallback: (now: number, metadata: { mediaTime?: number }) => void) {
        callback = nextCallback;
        return 7;
      },
      cancelVideoFrameCallback(handle: number) {
        cancelledHandle = handle;
      },
    };

    const clock = createPreviewPlaybackClock({
      onFrame: ({ timeSeconds }) => {
        frames.push(timeSeconds);
      },
    });

    clock.start(video);
    video.currentTime = 5.5;
    callback?.(0, {});
    clock.stop();

    expect(frames).toEqual([5.5]);
    expect(cancelledHandle).toBe(7);
  });

  it('does not publish a stopped pending frame', () => {
    let callback: ((now: number, metadata: { mediaTime: number }) => void) | undefined;
    const frames: number[] = [];
    const video = {
      currentTime: 1,
      requestVideoFrameCallback(nextCallback: (now: number, metadata: { mediaTime: number }) => void) {
        callback = nextCallback;
        return 11;
      },
      cancelVideoFrameCallback: () => {},
    };

    const clock = createPreviewPlaybackClock({
      onFrame: ({ timeSeconds }) => {
        frames.push(timeSeconds);
      },
    });

    clock.start(video);
    clock.stop();
    callback?.(100, { mediaTime: 2 });

    expect(frames).toEqual([]);
  });

  it('cancels the pending frame when started with another video', () => {
    const cancelledHandles: number[] = [];
    const videoA = {
      currentTime: 1,
      requestVideoFrameCallback: () => 21,
      cancelVideoFrameCallback(handle: number) {
        cancelledHandles.push(handle);
      },
    };
    const videoB = {
      currentTime: 2,
      requestVideoFrameCallback: () => 22,
      cancelVideoFrameCallback(handle: number) {
        cancelledHandles.push(handle);
      },
    };

    const clock = createPreviewPlaybackClock({
      onFrame: () => {},
    });

    clock.start(videoA);
    clock.start(videoB);

    expect(cancelledHandles).toEqual([21]);
  });

  it('falls back to requestAnimationFrame when requestVideoFrameCallback is unavailable', () => {
    let callback: ((now: number) => void) | undefined;
    const cancelledHandles: number[] = [];
    const frames: number[] = [];
    const video = { currentTime: 3 };
    const clock = createPreviewPlaybackClock({
      onFrame: ({ timeSeconds }) => {
        frames.push(timeSeconds);
      },
      requestAnimationFrame(nextCallback) {
        callback = nextCallback;
        return 91;
      },
      cancelAnimationFrame(handle) {
        cancelledHandles.push(handle);
      },
    });

    clock.start(video);
    video.currentTime = 3.25;
    callback?.(10);
    clock.stop();

    expect(frames).toEqual([3.25]);
    expect(cancelledHandles).toEqual([91]);
  });
});
