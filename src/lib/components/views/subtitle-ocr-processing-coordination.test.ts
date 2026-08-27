import { beforeEach, describe, expect, it, vi } from 'vitest';

import { subtitleOcrStore } from '$lib/stores';
import type { SubtitleOcrPipelineResult, SubtitleOcrSourceItem } from '$lib/types';
import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { createSubtitleOcrProcessingCoordination } from './subtitle-ocr-processing-coordination';

function source(id: string): SubtitleOcrSourceItem {
  return {
    id,
    sourceKind: 'standalone_sup',
    sourcePath: `/subs/${id}.sup`,
    displayName: `${id}.sup`,
    status: 'ready',
    ocrModelOverride: 'default',
    versions: [],
    activeVersionId: null,
  };
}

const emptyPipelineResult: SubtitleOcrPipelineResult = {
  decodedCues: [],
  rawOcrCues: [],
  stabilizedCues: [],
  finalCues: [],
  stats: {
    decodedBitmapCount: 0,
    skippedEmptyBitmapCount: 0,
    ocrProcessedBitmapCount: 0,
    deduplicatedBitmapCount: 0,
  },
};

describe('Subtitle OCR processing coordination', () => {
  beforeEach(() => {
    subtitleOcrStore.reset();
    subtitleOcrStore.addItems([source('old'), source('new')]);
    invokeMock.mockReset();
  });

  it('does not let a stale batch mutate or stop a newer processing session', async () => {
    let finishOldRun!: (result: SubtitleOcrPipelineResult) => void;
    invokeMock.mockReturnValue(new Promise<SubtitleOcrPipelineResult>((resolve) => {
      finishOldRun = resolve;
    }));
    const activeRunIdsByItemId = new Map<string, string>();
    const backendCancelableRunIdsByItemId = new Map<string, string>();
    let cancelRequested = false;
    const coordination = createSubtitleOcrProcessingCoordination({
      aiCleanupControllers: new Map(),
      activeRunIdsByItemId,
      backendCancelableRunIdsByItemId,
      getStoreItem: (itemId) => subtitleOcrStore.getItemSnapshot(itemId),
      preparePipelineSource: async (item) => item.sourcePath,
      buildPipelineArgs: (_item, _sourcePath, runId) => ({
        config: DEFAULT_SUBTITLE_OCR_CONFIG,
        effectiveOcrModel: DEFAULT_SUBTITLE_OCR_CONFIG.ocrModel,
        args: { runId },
      }),
      setManualProgress: () => {},
      persistItem: async () => {},
      requestPendingPreviewRestoreFlush: vi.fn(),
      sanitizeProcessingMessage: (error) => String(error),
      isCancellationError: (error) => String(error).toLowerCase().includes('cancelled'),
      canUseSubtitleOcrAiCleanup: () => true,
      warnSubtitleOcrAiCleanupUnavailable: vi.fn(),
      getCancelRequested: () => cancelRequested,
      setCancelRequested: (value) => { cancelRequested = value; },
    });

    const oldBatch = coordination.runProcessingItems(['old']);
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledOnce());
    const oldSessionId = subtitleOcrStore.processingSessionId;
    expect(oldSessionId).not.toBeNull();

    subtitleOcrStore.cancelProcessing('old');
    subtitleOcrStore.stopProcessing();
    expect(subtitleOcrStore.startProcessing(['new'])).toBe(true);
    expect(subtitleOcrStore.markProcessingItemStarted('new', 'decoding')).toBe(true);
    subtitleOcrStore.setProgress('new', {
      phase: 'decoding',
      current: 5,
      total: 10,
      totalKnown: true,
      percentage: 50,
    });
    const newSessionId = subtitleOcrStore.processingSessionId;
    expect(newSessionId).not.toBe(oldSessionId);

    finishOldRun(emptyPipelineResult);
    await oldBatch;

    expect(subtitleOcrStore.isProcessing).toBe(true);
    expect(subtitleOcrStore.processingSessionId).toBe(newSessionId);
    expect([...subtitleOcrStore.processingScopeItemIds]).toEqual(['new']);
    expect(subtitleOcrStore.getItemSnapshot('new')).toMatchObject({
      status: 'decoding',
      progress: expect.objectContaining({ percentage: 50 }),
    });
  });
});
