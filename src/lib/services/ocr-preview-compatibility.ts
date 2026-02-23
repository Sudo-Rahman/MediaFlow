import { convertFileSrc } from '@tauri-apps/api/core';

import type { Track } from '$lib/types';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_AUDIO_SETTLE_MS = 350;

interface ProbeVideoElement extends HTMLVideoElement {
  readonly webkitAudioDecodedByteCount?: number;
  readonly mozHasAudio?: boolean;
  readonly audioTracks?: { length: number };
}

export interface OcrSourcePreviewCompatibilityInput {
  sourcePath: string;
  tracks: Track[];
  timeoutMs?: number;
  audioSettleMs?: number;
}

export interface OcrSourcePreviewCompatibilityResult {
  isCompatible: boolean;
  reason: string;
}

function hasAudioTrack(tracks: Track[]): boolean {
  return tracks.some((track) => track.type === 'audio');
}

function describeMediaError(error: MediaError | null): string {
  if (!error) {
    return 'Unknown media error';
  }

  switch (error.code) {
    case 1:
      return 'Playback aborted';
    case 2:
      return 'Network error while loading media';
    case 3:
      return 'Media decoding failed';
    case 4:
      return 'Unsupported media format';
    default:
      return `Media error code ${error.code}`;
  }
}

function cleanupProbe(video: HTMLVideoElement): void {
  try {
    video.pause();
  } catch {
    // Ignore pause errors during cleanup.
  }

  video.removeAttribute('src');
  video.load();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error(describeMediaError(video.error)));
    };

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);
  });
}

function evaluateAudioSupport(video: ProbeVideoElement): OcrSourcePreviewCompatibilityResult {
  if (video.error) {
    return {
      isCompatible: false,
      reason: describeMediaError(video.error),
    };
  }

  if (typeof video.mozHasAudio === 'boolean') {
    if (!video.mozHasAudio) {
      return {
        isCompatible: false,
        reason: 'Browser reports no playable audio track',
      };
    }

    return {
      isCompatible: true,
      reason: 'Source video/audio playback supported',
    };
  }

  if (video.audioTracks && typeof video.audioTracks.length === 'number') {
    if (video.audioTracks.length === 0) {
      return {
        isCompatible: false,
        reason: 'Browser reports no playable audio tracks',
      };
    }

    return {
      isCompatible: true,
      reason: 'Source video/audio playback supported',
    };
  }

  if (typeof video.webkitAudioDecodedByteCount === 'number') {
    if (video.webkitAudioDecodedByteCount > 0) {
      return {
        isCompatible: true,
        reason: 'Source video/audio playback supported',
      };
    }

    return {
      isCompatible: true,
      reason: 'No explicit audio decode failure detected',
    };
  }

  return {
    isCompatible: true,
    reason: 'No browser audio probe available; no explicit error detected',
  };
}

export async function checkOcrSourcePreviewCompatibility(
  input: OcrSourcePreviewCompatibilityInput,
): Promise<OcrSourcePreviewCompatibilityResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const audioSettleMs = input.audioSettleMs ?? DEFAULT_AUDIO_SETTLE_MS;
  const expectsAudio = hasAudioTrack(input.tracks);

  const video = document.createElement('video') as ProbeVideoElement;
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = convertFileSrc(input.sourcePath);

  try {
    video.load();

    await withTimeout(
      waitForVideoReady(video),
      timeoutMs,
      `Compatibility check timed out after ${timeoutMs}ms`,
    );

    await withTimeout(
      Promise.resolve(video.play()),
      timeoutMs,
      `Playback start timed out after ${timeoutMs}ms`,
    );

    if (audioSettleMs > 0) {
      await wait(audioSettleMs);
    }

    if (video.error) {
      return {
        isCompatible: false,
        reason: describeMediaError(video.error),
      };
    }

    if (!expectsAudio) {
      return {
        isCompatible: true,
        reason: 'Source video playback supported (no audio track detected)',
      };
    }

    return evaluateAudioSupport(video);
  } catch (error) {
    return {
      isCompatible: false,
      reason: error instanceof Error ? error.message : 'Unknown compatibility check error',
    };
  } finally {
    cleanupProbe(video);
  }
}
