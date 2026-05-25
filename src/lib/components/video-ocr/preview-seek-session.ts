export type PreviewSeekFrameAction = 'publish' | 'suppress' | 'complete';

export interface PreviewSeekCompletion {
  targetTimeSeconds: number | null;
  shouldResumePlayback: boolean;
}

export interface PreviewSeekSession {
  readonly isActive: boolean;
  readonly isScrubbing: boolean;
  readonly pendingTargetTimeSeconds: number | null;
  readonly shouldResumePlayback: boolean;
  startScrub: (targetTimeSeconds: number, shouldResumePlayback?: boolean) => void;
  startCommit: (targetTimeSeconds: number, shouldResumePlayback?: boolean) => void;
  complete: () => PreviewSeekCompletion;
  clear: () => void;
  resolvePlaybackFrame: (timeSeconds: number) => PreviewSeekFrameAction;
  targetMatches: (timeSeconds: number) => boolean;
}

const SEEK_COMPLETE_TOLERANCE_SECONDS = 0.1;

type PreviewSeekMode = 'idle' | 'scrubbing' | 'committing';

function normalizeTimeSeconds(timeSeconds: number): number {
  return Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
}

export function createPreviewSeekSession(): PreviewSeekSession {
  let mode: PreviewSeekMode = 'idle';
  let pendingTargetTimeSeconds: number | null = null;
  let shouldResumePlayback = false;

  function start(
    modeToStart: Exclude<PreviewSeekMode, 'idle'>,
    targetTimeSeconds: number,
    resumePlaybackAfterSeek: boolean,
  ): void {
    const preserveResumePlayback = mode !== 'idle' && shouldResumePlayback;
    mode = modeToStart;
    pendingTargetTimeSeconds = normalizeTimeSeconds(targetTimeSeconds);
    shouldResumePlayback = preserveResumePlayback || resumePlaybackAfterSeek;
  }

  function targetMatches(timeSeconds: number): boolean {
    return pendingTargetTimeSeconds !== null
      && Math.abs(normalizeTimeSeconds(timeSeconds) - pendingTargetTimeSeconds) <= SEEK_COMPLETE_TOLERANCE_SECONDS;
  }

  return {
    get isActive() {
      return mode !== 'idle';
    },

    get isScrubbing() {
      return mode === 'scrubbing';
    },

    get pendingTargetTimeSeconds() {
      return pendingTargetTimeSeconds;
    },

    get shouldResumePlayback() {
      return shouldResumePlayback;
    },

    startScrub(targetTimeSeconds: number, resumePlaybackAfterSeek = false): void {
      start('scrubbing', targetTimeSeconds, resumePlaybackAfterSeek);
    },

    startCommit(targetTimeSeconds: number, resumePlaybackAfterSeek = false): void {
      start('committing', targetTimeSeconds, resumePlaybackAfterSeek);
    },

    complete(): PreviewSeekCompletion {
      const targetTimeSeconds = pendingTargetTimeSeconds;
      const resumePlaybackAfterSeek = shouldResumePlayback;
      mode = 'idle';
      pendingTargetTimeSeconds = null;
      shouldResumePlayback = false;
      return { targetTimeSeconds, shouldResumePlayback: resumePlaybackAfterSeek };
    },

    clear(): void {
      mode = 'idle';
      pendingTargetTimeSeconds = null;
      shouldResumePlayback = false;
    },

    resolvePlaybackFrame(timeSeconds: number): PreviewSeekFrameAction {
      if (mode === 'idle') {
        return 'publish';
      }

      if (mode === 'scrubbing') {
        return 'suppress';
      }

      return targetMatches(timeSeconds) ? 'complete' : 'suppress';
    },

    targetMatches,
  };
}
