import { describe, expect, it } from 'vitest';

import { createPreviewSeekSession } from './preview-seek-session';

describe('preview seek session', () => {
  it('publishes playback frames when no seek is active', () => {
    const session = createPreviewSeekSession();

    expect(session.isActive).toBe(false);
    expect(session.resolvePlaybackFrame(12)).toBe('publish');
  });

  it('suppresses playback frames while a scrub preview is active', () => {
    const session = createPreviewSeekSession();

    session.startScrub(42);

    expect(session.isActive).toBe(true);
    expect(session.isScrubbing).toBe(true);
    expect(session.pendingTargetTimeSeconds).toBe(42);
    expect(session.resolvePlaybackFrame(42)).toBe('suppress');
    expect(session.resolvePlaybackFrame(12)).toBe('suppress');
  });

  it('completes a committed seek only when playback reaches the latest target', () => {
    const session = createPreviewSeekSession();

    session.startCommit(10);
    session.startCommit(80);

    expect(session.pendingTargetTimeSeconds).toBe(80);
    expect(session.resolvePlaybackFrame(10)).toBe('suppress');
    expect(session.resolvePlaybackFrame(79.2)).toBe('suppress');
    expect(session.resolvePlaybackFrame(79.3)).toBe('complete');
    expect(session.resolvePlaybackFrame(80.7)).toBe('complete');
    expect(session.resolvePlaybackFrame(80.8)).toBe('suppress');
  });

  it('returns the pending target when completed', () => {
    const session = createPreviewSeekSession();

    session.startCommit(42);

    expect(session.complete()).toBe(42);
    expect(session.isActive).toBe(false);
    expect(session.pendingTargetTimeSeconds).toBeNull();
    expect(session.resolvePlaybackFrame(42.1)).toBe('publish');
  });
});
