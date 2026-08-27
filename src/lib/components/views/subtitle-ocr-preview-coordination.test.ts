import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SubtitleOcrCue,
  SubtitleOcrCueBitmap,
  SubtitleOcrSourceItem,
  SubtitleOcrVersion,
} from '$lib/types';
import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';
import { subtitleOcrStore } from '$lib/stores';

const invokeMock = vi.hoisted(() => vi.fn());
const warningMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('$lib/utils/log-toast', () => ({
  logAndToast: { warning: warningMock },
}));

import { createSubtitleOcrImportGenerationCoordinator } from './subtitle-ocr-import-generation';
import { createSubtitleOcrPreviewCoordination } from './subtitle-ocr-preview-coordination';
import { shouldApplySubtitleOcrProgressEvent } from './subtitle-ocr-view-state';

const bitmap: SubtitleOcrCueBitmap = {
  cueId: 'cue-1',
  startTimeMs: 0,
  endTimeMs: 1000,
  width: 640,
  height: 120,
};

const cue: SubtitleOcrCue = {
  id: 'cue-1',
  sourceCueIds: ['cue-1'],
  startTimeMs: 0,
  endTimeMs: 1000,
  text: 'Hello',
  confidence: 0.9,
};

function source(): SubtitleOcrSourceItem {
  const version: SubtitleOcrVersion = {
    id: 'version-1',
    name: 'Version 1',
    createdAt: '2026-08-26T00:00:00.000Z',
    mode: 'full_ocr',
    configSnapshot: DEFAULT_SUBTITLE_OCR_CONFIG,
    effectiveOcrModel: DEFAULT_SUBTITLE_OCR_CONFIG.ocrModel,
    sourceSnapshot: {
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/source.sup',
      ocrModelOverride: 'default',
    },
    bitmaps: [bitmap],
    rawOcr: [],
    stabilizedCues: [cue],
    finalCues: [cue],
    aiCleanupApplied: false,
  };

  return {
    id: 'restore',
    sourceKind: 'standalone_sup',
    sourcePath: '/subs/source.sup',
    displayName: 'source.sup',
    status: 'completed',
    ocrModelOverride: 'default',
    versions: [version],
    activeVersionId: version.id,
  };
}

function createHarness(
  collectMissingPreviewAssets: (
    bitmaps: SubtitleOcrCueBitmap[],
  ) => Promise<SubtitleOcrCueBitmap[]> = async (bitmaps) => bitmaps,
) {
  const generationCoordinator = createSubtitleOcrImportGenerationCoordinator();
  const previewRestoreRunIdsByItemId = new Map<string, string>();
  const activeRunIdsByItemId = new Map<string, string>();
  const backendCancelableRunIdsByItemId = new Map<string, string>();
  let cancelRequested = false;
  let cancelOwnerGeneration: number | null = null;

  const coordination = createSubtitleOcrPreviewCoordination({
    previewRestoreRunIdsByItemId,
    activeRunIdsByItemId,
    backendCancelableRunIdsByItemId,
    getStoreItem: (itemId) => subtitleOcrStore.getItemSnapshot(itemId),
    createSubtitleOcrRunId: (itemId) => `${itemId}-run`,
    preparePipelineSource: async (item) => item.sourcePath,
    buildPreviewRestoreArgs: (item, sourcePath, runId, bitmaps) => ({
      itemId: item.id,
      sourcePath,
      runId,
      bitmaps,
    }),
    setManualProgress: () => {},
    persistItem: async () => {},
    sanitizeProcessingMessage: (error) => String(error),
    isCancellationError: () => false,
    getCancelRequested: () => cancelRequested,
    isImportGenerationUsable: generationCoordinator.isUsable,
    isImportGenerationCancelled: generationCoordinator.isCancelled,
    retainImportGeneration: generationCoordinator.retain,
    releaseImportGeneration: generationCoordinator.release,
    getActiveImportGeneration: () => generationCoordinator.activeGeneration,
    onCancelledRestoreSettled: (generation) => {
      if (cancelOwnerGeneration === generation) {
        cancelOwnerGeneration = null;
        cancelRequested = false;
      }
    },
    collectMissingPreviewAssets,
    onActivity: () => {},
  });

  return {
    coordination,
    generationCoordinator,
    get cancelRequested() {
      return cancelRequested;
    },
    set cancelRequested(value: boolean) {
      cancelRequested = value;
    },
    set cancelOwnerGeneration(value: number | null) {
      cancelOwnerGeneration = value;
    },
    activeRunIdsByItemId,
    previewRestoreRunIdsByItemId,
    backendCancelableRunIdsByItemId,
  };
}

describe('Subtitle OCR preview coordination', () => {
  beforeEach(() => {
    subtitleOcrStore.reset();
    subtitleOcrStore.addItems([source()]);
    invokeMock.mockReset();
    warningMock.mockReset();
  });

  it('warns when the backend restores only part of the missing previews', async () => {
    const secondBitmap: SubtitleOcrCueBitmap = {
      ...bitmap,
      cueId: 'cue-2',
      startTimeMs: 1000,
      endTimeMs: 2000,
    };
    const harness = createHarness(async () => [bitmap, secondBitmap]);
    const lease = harness.generationCoordinator.begin();
    const token = subtitleOcrStore.startHydration('restore');
    subtitleOcrStore.finishHydration('restore', token);
    invokeMock.mockResolvedValue([bitmap]);

    await expect(
      harness.coordination.restoreMissingPreviewAssets('restore', token, lease.generation),
    ).resolves.toBe('completed');
    expect(warningMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Some Subtitle OCR previews were not restored',
    }));
  });

  it('warns when preview restoration fails without cancellation', async () => {
    const harness = createHarness();
    const lease = harness.generationCoordinator.begin();
    const token = subtitleOcrStore.startHydration('restore');
    subtitleOcrStore.finishHydration('restore', token);
    invokeMock.mockRejectedValue(new Error('restore unavailable'));

    await expect(
      harness.coordination.restoreMissingPreviewAssets('restore', token, lease.generation),
    ).resolves.toBe('failed');
    expect(warningMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Subtitle OCR previews were not restored',
    }));
  });

  it('resets an active restore cancellation and allows a fresh restore', async () => {
    const harness = createHarness();
    const firstLease = harness.generationCoordinator.begin();
    const firstToken = subtitleOcrStore.startHydration('restore');
    subtitleOcrStore.finishHydration('restore', firstToken);

    let finishRestore!: (bitmaps: SubtitleOcrCueBitmap[]) => void;
    const restorePromise = new Promise<SubtitleOcrCueBitmap[]>((resolve) => {
      finishRestore = resolve;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_subtitle_ocr_bitmap_assets') return restorePromise;
      throw new Error(`Unexpected invoke: ${command}`);
    });

    const firstRestore = harness.coordination.restoreMissingPreviewAssets(
      'restore',
      firstToken,
      firstLease.generation,
    );
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'restore_subtitle_ocr_bitmap_assets',
        expect.objectContaining({ itemId: 'restore' }),
      );
    });

    harness.cancelRequested = true;
    harness.cancelOwnerGeneration = firstLease.generation;
    harness.generationCoordinator.cancelAll();
    harness.coordination.cancel();
    harness.coordination.cancel();
    finishRestore([]);

    await expect(firstRestore).resolves.toBe('stale');
    expect(harness.cancelRequested).toBe(false);

    const freshLease = harness.generationCoordinator.begin();
    const freshToken = subtitleOcrStore.startHydration('restore');
    subtitleOcrStore.finishHydration('restore', freshToken);
    invokeMock.mockResolvedValue([]);

    await expect(
      harness.coordination.restoreMissingPreviewAssets('restore', freshToken, freshLease.generation),
    ).resolves.toBe('completed');
    expect(harness.cancelRequested).toBe(false);
  });

  it('rejects late events from a cancelled preview after a new import starts', async () => {
    const harness = createHarness();
    const firstLease = harness.generationCoordinator.begin();
    const firstToken = subtitleOcrStore.startHydration('restore');
    subtitleOcrStore.finishHydration('restore', firstToken);

    let finishRestore!: (bitmaps: SubtitleOcrCueBitmap[]) => void;
    const restorePromise = new Promise<SubtitleOcrCueBitmap[]>((resolve) => {
      finishRestore = resolve;
    });
    invokeMock.mockResolvedValue(restorePromise);

    const firstRestore = harness.coordination.restoreMissingPreviewAssets(
      'restore',
      firstToken,
      firstLease.generation,
    );
    await vi.waitFor(() => {
      expect(harness.previewRestoreRunIdsByItemId.get('restore')).toBeDefined();
    });
    const cancelledRunId = harness.previewRestoreRunIdsByItemId.get('restore');
    expect(cancelledRunId).toBeDefined();

    harness.cancelRequested = true;
    harness.generationCoordinator.cancelAll();
    harness.coordination.cancel();

    expect(harness.previewRestoreRunIdsByItemId.has('restore')).toBe(false);
    expect(harness.activeRunIdsByItemId.has('restore')).toBe(false);

    const freshLease = harness.generationCoordinator.begin();
    const freshToken = subtitleOcrStore.startHydration('restore');
    subtitleOcrStore.finishHydration('restore', freshToken);
    expect(freshLease.generation).not.toBe(firstLease.generation);
    const freshRunId = 'restore-fresh-run';
    harness.activeRunIdsByItemId.set('restore', freshRunId);
    harness.previewRestoreRunIdsByItemId.set('restore', freshRunId);
    harness.backendCancelableRunIdsByItemId.set('restore', freshRunId);

    finishRestore([]);
    await expect(firstRestore).resolves.toBe('stale');
    expect(harness.activeRunIdsByItemId.get('restore')).toBe(freshRunId);
    expect(harness.previewRestoreRunIdsByItemId.get('restore')).toBe(freshRunId);
    expect(harness.backendCancelableRunIdsByItemId.get('restore')).toBe(freshRunId);

    for (const eventKind of ['progress', 'bitmap', 'live-cue']) {
      expect(
        shouldApplySubtitleOcrProgressEvent(
          'restore',
          cancelledRunId,
          harness.activeRunIdsByItemId,
          false,
        ),
        `${eventKind} from cancelled preview should be rejected`,
      ).toBe(false);
    }
    expect(
      shouldApplySubtitleOcrProgressEvent(
        'restore',
        freshRunId,
        harness.activeRunIdsByItemId,
        false,
      ),
    ).toBe(true);
    harness.generationCoordinator.release(freshLease);
  });

  it('keeps run tracking bounded across repeated preview cancellations', () => {
    const harness = createHarness();

    for (let index = 0; index < 2048; index += 1) {
      const runId = `restore-cancelled-${index}`;
      harness.previewRestoreRunIdsByItemId.set('restore', runId);
      harness.activeRunIdsByItemId.set('restore', runId);
      harness.backendCancelableRunIdsByItemId.set('restore', runId);
      harness.coordination.cancel();

      expect(harness.previewRestoreRunIdsByItemId.size).toBe(0);
      expect(harness.activeRunIdsByItemId.size).toBe(0);
      expect(harness.backendCancelableRunIdsByItemId.size).toBe(0);
      expect(
        shouldApplySubtitleOcrProgressEvent('restore', runId, harness.activeRunIdsByItemId, false),
      ).toBe(false);
    }

    const currentRunId = 'restore-current';
    harness.activeRunIdsByItemId.set('restore', currentRunId);
    expect(
      shouldApplySubtitleOcrProgressEvent(
        'restore',
        currentRunId,
        harness.activeRunIdsByItemId,
        false,
      ),
    ).toBe(true);
  });
});
