import { describe, expect, it } from 'vitest';

import { createSubtitleOcrImportGenerationCoordinator } from './subtitle-ocr-import-generation';

describe('Subtitle OCR import generation coordinator', () => {
  it('keeps overlapping owners alive until every operation finishes', () => {
    const coordinator = createSubtitleOcrImportGenerationCoordinator();
    const first = coordinator.begin();
    const overlapping = coordinator.begin();

    expect(overlapping.generation).toBe(first.generation);
    expect(overlapping.leaseId).not.toBe(first.leaseId);
    expect(coordinator.release(first)).toBe(true);
    expect(coordinator.activeGeneration).toBe(first.generation);
    expect(coordinator.isCurrent(first.generation)).toBe(true);
    expect(coordinator.release(overlapping)).toBe(true);
    expect(coordinator.activeGeneration).toBeNull();
  });

  it('creates a fresh generation after cancel while old owners are still unwinding', () => {
    const coordinator = createSubtitleOcrImportGenerationCoordinator();
    const cancelled = coordinator.begin();
    const oldRetained = coordinator.begin();
    expect(coordinator.cancelAll()).toEqual([cancelled.generation]);

    const fresh = coordinator.begin();
    expect(fresh.generation).not.toBe(cancelled.generation);
    expect(coordinator.isCancelled(cancelled.generation)).toBe(true);
    expect(coordinator.isCurrent(cancelled.generation)).toBe(false);
    expect(coordinator.isCurrent(fresh.generation)).toBe(true);

    expect(coordinator.release(cancelled)).toBe(true);
    expect(coordinator.activeGeneration).toBe(fresh.generation);
    expect(coordinator.release(oldRetained)).toBe(true);
    expect(coordinator.isCancelled(cancelled.generation)).toBe(false);
    expect(coordinator.retain(cancelled.generation)).toBeNull();
    expect(coordinator.activeGeneration).toBe(fresh.generation);
    expect(coordinator.release(fresh)).toBe(true);
    expect(coordinator.activeGeneration).toBeNull();
  });

  it('keeps a completed generation usable while deferred restores drain', () => {
    const coordinator = createSubtitleOcrImportGenerationCoordinator();
    const generation = coordinator.begin();
    const deferred = coordinator.retain(generation.generation);
    expect(deferred).not.toBeNull();
    expect(coordinator.release(generation)).toBe(true);
    expect(coordinator.isUsable(generation.generation)).toBe(true);

    coordinator.cancelAll();
    expect(coordinator.isUsable(generation.generation)).toBe(false);
  });

  it('releases a lease exactly once without changing a newer generation', () => {
    const coordinator = createSubtitleOcrImportGenerationCoordinator();
    const old = coordinator.begin();
    coordinator.cancelAll();
    const current = coordinator.begin();

    expect(coordinator.release(old)).toBe(true);
    expect(coordinator.release(old)).toBe(false);
    expect(coordinator.activeGeneration).toBe(current.generation);
    expect(coordinator.isCancelled(old.generation)).toBe(false);
    expect(coordinator.retain(old.generation)).toBeNull();
    expect(coordinator.isCancelled(current.generation)).toBe(false);
    expect(coordinator.release(current)).toBe(true);
  });

  it('rejects stale retains after cancel and supports repeated cancel', () => {
    const coordinator = createSubtitleOcrImportGenerationCoordinator();
    const lease = coordinator.begin();

    expect(coordinator.cancelAll()).toEqual([lease.generation]);
    expect(coordinator.cancelAll()).toEqual([lease.generation]);
    expect(coordinator.retain(lease.generation)).toBeNull();
    expect(coordinator.release(lease)).toBe(true);
    expect(coordinator.release(lease)).toBe(false);
  });

  it('retains cancellation rejection while owners remain and prunes on final release', () => {
    const coordinator = createSubtitleOcrImportGenerationCoordinator();
    const root = coordinator.begin();
    const retained = coordinator.retain(root.generation);
    expect(retained).not.toBeNull();

    expect(coordinator.cancelAll()).toEqual([root.generation]);
    expect(coordinator.isCancelled(root.generation)).toBe(true);
    expect(coordinator.retain(root.generation)).toBeNull();

    expect(coordinator.release(root)).toBe(true);
    expect(coordinator.isCancelled(root.generation)).toBe(true);
    expect(coordinator.release(retained!)).toBe(true);
    expect(coordinator.isCancelled(root.generation)).toBe(false);
    expect(coordinator.retain(root.generation)).toBeNull();
  });
});
