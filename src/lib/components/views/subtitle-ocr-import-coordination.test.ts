import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubtitleOcrPersistenceData, SubtitleOcrTrackMetadata } from '$lib/types';
import { subtitleOcrStore } from '$lib/stores';

const invokeMock = vi.hoisted(() => vi.fn());
const loadSubtitleOcrDataMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('$lib/services/subtitle-ocr-storage', () => ({
  loadSubtitleOcrData: loadSubtitleOcrDataMock,
}));

import { createSubtitleOcrImportCoordination } from './subtitle-ocr-import-coordination';
import { createSubtitleOcrImportGenerationCoordinator } from './subtitle-ocr-import-generation';

const track: SubtitleOcrTrackMetadata = {
  streamIndex: 3,
  codec: 'hdmv_pgs_subtitle',
  codecLabel: 'PGS',
};

function persistence(sourcePath: string): SubtitleOcrPersistenceData {
  return {
    version: 1,
    sourcePath,
    versions: [],
    activeVersionId: null,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  };
}

function createHarness() {
  const generationCoordinator = createSubtitleOcrImportGenerationCoordinator();
  const dialogStates: { open: boolean; sourcePath: string }[] = [];
  let activityCount = 0;

  const coordination = createSubtitleOcrImportCoordination({
    beginImportGeneration: generationCoordinator.begin,
    retainImportGeneration: generationCoordinator.retain,
    releaseImportGeneration: generationCoordinator.release,
    isImportGenerationCurrent: generationCoordinator.isCurrent,
    isImportGenerationCancelled: generationCoordinator.isCancelled,
    restoreMissingPreviewAssets: vi.fn(async () => 'completed' as const),
    requestPendingPreviewRestoreFlush: vi.fn(),
    resolveVobSubPair: vi.fn(async () => ({
      idxPath: '/subs/source.idx',
      subPath: '/subs/source.sub',
    })),
    sanitizeProcessingMessage: (error) => String(error),
    reportImportError: vi.fn(),
    onDialogStateChange: (state) => {
      dialogStates.push({ open: state.open, sourcePath: state.sourcePath });
    },
    onActivity: () => {
      activityCount += 1;
    },
  });

  return {
    coordination,
    generationCoordinator,
    dialogStates,
    get activityCount() {
      return activityCount;
    },
  };
}

describe('Subtitle OCR import coordination', () => {
  beforeEach(() => {
    subtitleOcrStore.reset();
    invokeMock.mockReset();
    loadSubtitleOcrDataMock.mockReset();
  });

  it('settles hydration ownership for success, no-data, and error completions', async () => {
    const harness = createHarness();
    loadSubtitleOcrDataMock
      .mockResolvedValueOnce(persistence('/subs/success.sup'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('sidecar unavailable'));

    await harness.coordination.importPaths(['/subs/success.sup']);
    expect(harness.coordination.hasHydrationWork).toBe(false);
    expect(subtitleOcrStore.hydratingItemIds.size).toBe(0);

    await harness.coordination.importPaths(['/subs/no-data.sup']);
    expect(harness.coordination.hasHydrationWork).toBe(false);
    expect(subtitleOcrStore.hydratingItemIds.size).toBe(0);

    await harness.coordination.importPaths(['/subs/error.sup']);
    expect(harness.coordination.hasHydrationWork).toBe(false);
    expect(subtitleOcrStore.hydratingItemIds.size).toBe(0);
    expect(harness.activityCount).toBeGreaterThanOrEqual(6);
  });

  it('ignores a late probe completion after teardown tombstones the generation', async () => {
    const harness = createHarness();
    let finishProbe!: (value: { tracks: SubtitleOcrTrackMetadata[]; durationSeconds: number }) => void;
    const probePromise = new Promise<{ tracks: SubtitleOcrTrackMetadata[]; durationSeconds: number }>((resolve) => {
      finishProbe = resolve;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'probe_subtitle_ocr_media') return probePromise;
      throw new Error(`Unexpected invoke: ${command}`);
    });

    const pendingImport = harness.coordination.importPaths(['/media/movie.mkv']);
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith('probe_subtitle_ocr_media', { path: '/media/movie.mkv' });
    expect(harness.generationCoordinator.activeGeneration).not.toBeNull();

    // This is the component teardown ordering: tombstone roots before clearing queues/tokens.
    harness.generationCoordinator.cancelAll();
    harness.coordination.clear();
    finishProbe({ tracks: [track], durationSeconds: 120 });
    await pendingImport;

    expect(harness.coordination.hasDialogWork).toBe(false);
    expect(harness.dialogStates).toEqual([]);
  });
});
