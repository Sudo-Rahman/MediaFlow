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

    session.startScrub(42, true);
    session.startScrub(48);

    expect(session.isActive).toBe(true);
    expect(session.isScrubbing).toBe(true);
    expect(session.pendingTargetTimeSeconds).toBe(48);
    expect(session.shouldResumePlayback).toBe(true);
    expect(session.resolvePlaybackFrame(48)).toBe('suppress');
    expect(session.resolvePlaybackFrame(12)).toBe('suppress');
  });

  it('preserves scrub resume intent when committing the final target', () => {
    const session = createPreviewSeekSession();

    session.startScrub(10, true);
    session.startScrub(30);
    session.startCommit(80);

    expect(session.isActive).toBe(true);
    expect(session.isScrubbing).toBe(false);
    expect(session.pendingTargetTimeSeconds).toBe(80);
    expect(session.shouldResumePlayback).toBe(true);
    expect(session.resolvePlaybackFrame(30)).toBe('suppress');
    expect(session.resolvePlaybackFrame(79.9)).toBe('complete');
  });

  it('does not request playback resume for a paused scrub seek', () => {
    const session = createPreviewSeekSession();

    session.startScrub(10, false);
    session.startCommit(80);

    expect(session.complete()).toEqual({ targetTimeSeconds: 80, shouldResumePlayback: false });
  });

  it('requests playback resume for a scrub seek that started while playing', () => {
    const session = createPreviewSeekSession();

    session.startScrub(10, true);
    session.startCommit(80);

    expect(session.complete()).toEqual({ targetTimeSeconds: 80, shouldResumePlayback: true });
  });

  it('completes a committed seek only when playback reaches the latest target', () => {
    const session = createPreviewSeekSession();

    session.startCommit(10);
    session.startCommit(80);

    expect(session.pendingTargetTimeSeconds).toBe(80);
    expect(session.resolvePlaybackFrame(10)).toBe('suppress');
    expect(session.resolvePlaybackFrame(79.8)).toBe('suppress');
    expect(session.resolvePlaybackFrame(79.9)).toBe('complete');
    expect(session.resolvePlaybackFrame(80.1)).toBe('complete');
    expect(session.resolvePlaybackFrame(80.2)).toBe('suppress');
  });

  it('returns the pending target when completed', () => {
    const session = createPreviewSeekSession();

    session.startCommit(42, true);

    expect(session.complete()).toEqual({ targetTimeSeconds: 42, shouldResumePlayback: true });
    expect(session.isActive).toBe(false);
    expect(session.shouldResumePlayback).toBe(false);
    expect(session.pendingTargetTimeSeconds).toBeNull();
    expect(session.resolvePlaybackFrame(42.1)).toBe('publish');
  });
});
