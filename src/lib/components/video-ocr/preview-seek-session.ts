export type PreviewSeekFrameAction = 'publish' | 'suppress' | 'complete';

export interface PreviewSeekSession {
  readonly isActive: boolean;
  readonly isScrubbing: boolean;
  readonly pendingTargetTimeSeconds: number | null;
  startScrub: (targetTimeSeconds: number) => void;
  startCommit: (targetTimeSeconds: number) => void;
  complete: () => number | null;
  clear: () => void;
  resolvePlaybackFrame: (timeSeconds: number) => PreviewSeekFrameAction;
  targetMatches: (timeSeconds: number) => boolean;
}

const SEEK_COMPLETE_TOLERANCE_SECONDS = 0.75;

type PreviewSeekMode = 'idle' | 'scrubbing' | 'committing';

function normalizeTimeSeconds(timeSeconds: number): number {
  return Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
}

export function createPreviewSeekSession(): PreviewSeekSession {
  let mode: PreviewSeekMode = 'idle';
  let pendingTargetTimeSeconds: number | null = null;

  function start(modeToStart: Exclude<PreviewSeekMode, 'idle'>, targetTimeSeconds: number): void {
    mode = modeToStart;
    pendingTargetTimeSeconds = normalizeTimeSeconds(targetTimeSeconds);
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

    startScrub(targetTimeSeconds: number): void {
      start('scrubbing', targetTimeSeconds);
    },

    startCommit(targetTimeSeconds: number): void {
      start('committing', targetTimeSeconds);
    },

    complete(): number | null {
      const targetTimeSeconds = pendingTargetTimeSeconds;
      mode = 'idle';
      pendingTargetTimeSeconds = null;
      return targetTimeSeconds;
    },

    clear(): void {
      mode = 'idle';
      pendingTargetTimeSeconds = null;
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
