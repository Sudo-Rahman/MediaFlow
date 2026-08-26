import { describe, expect, it } from 'vitest';

import { shouldApplySubtitleOcrProgressEvent } from './subtitle-ocr-view-state';
import {
  cancelSubtitleOcrItem,
  type SubtitleOcrItemCancellationContext,
} from './subtitle-ocr-item-cancellation';

function createHarness(): SubtitleOcrItemCancellationContext & {
  readonly cancelledItemIds: Set<string>;
  readonly itemIds: Set<string>;
  processing: boolean;
} {
  const cancelledItemIds = new Set<string>();
  const itemIds = new Set(['first', 'other']);
  return {
    aiCleanupControllers: new Map(),
    activeRunIdsByItemId: new Map([
      ['first', 'first-run'],
      ['other', 'other-run'],
    ]),
    backendCancelableRunIdsByItemId: new Map([
      ['first', 'first-run'],
      ['other', 'other-run'],
    ]),
    previewRestoreRunIdsByItemId: new Map([
      ['first', 'first-run'],
      ['other', 'other-run'],
    ]),
    cancelledItemIds,
    itemIds,
    processing: true,
    getItem(itemId) {
      return itemIds.has(itemId) ? { id: itemId } : undefined;
    },
    isProcessing() {
      return this.processing;
    },
    isItemCancelled(itemId) {
      return cancelledItemIds.has(itemId);
    },
    cancelProcessing(itemId) {
      cancelledItemIds.add(itemId);
    },
  };
}

function acceptsEvent(
  itemId: string,
  runId: string,
  activeRunIdsByItemId: ReadonlyMap<string, string>,
): boolean {
  return shouldApplySubtitleOcrProgressEvent(itemId, runId, activeRunIdsByItemId, false);
}

describe('Subtitle OCR item cancellation', () => {
  it('rejects late progress, bitmap, and live-cue events while IPC awaits', async () => {
    const harness = createHarness();
    let finishCancel!: () => void;
    const cancelPromise = new Promise<void>((resolve) => {
      finishCancel = resolve;
    });

    const pendingCancellation = cancelSubtitleOcrItem(harness, 'first', async (target) => {
      expect(target.backendRunId).toBe('first-run');
      await cancelPromise;
    });

    expect(harness.cancelledItemIds.has('first')).toBe(true);
    expect(harness.activeRunIdsByItemId.has('first')).toBe(false);
    expect(harness.backendCancelableRunIdsByItemId.has('first')).toBe(false);
    expect(harness.previewRestoreRunIdsByItemId.has('first')).toBe(false);
    for (const eventKind of ['progress', 'bitmap', 'live-cue']) {
      expect(
        acceptsEvent('first', 'first-run', harness.activeRunIdsByItemId),
        `${eventKind} for cancelled item should be rejected during IPC`,
      ).toBe(false);
    }
    expect(acceptsEvent('other', 'other-run', harness.activeRunIdsByItemId)).toBe(true);

    // A replacement mapping must survive the old cancellation's eventual settle.
    harness.activeRunIdsByItemId.set('first', 'first-retry-run');
    harness.previewRestoreRunIdsByItemId.set('first', 'first-retry-run');
    finishCancel();
    await expect(pendingCancellation).resolves.toMatchObject({
      target: { itemId: 'first', backendRunId: 'first-run' },
    });
    expect(harness.activeRunIdsByItemId.get('first')).toBe('first-retry-run');
    expect(harness.previewRestoreRunIdsByItemId.get('first')).toBe('first-retry-run');

    // A later retry can clear the old item cancellation and accept its new run.
    harness.processing = false;
    harness.cancelledItemIds.clear();
    harness.processing = true;
    expect(acceptsEvent('first', 'first-retry-run', harness.activeRunIdsByItemId)).toBe(true);
  });

  it('keeps the item cancelled and retryable when backend cancellation fails', async () => {
    const harness = createHarness();
    const result = await cancelSubtitleOcrItem(harness, 'first', async () => {
      throw new Error('cancel IPC unavailable');
    });

    expect(result?.backendError).toBeInstanceOf(Error);
    expect(harness.cancelledItemIds.has('first')).toBe(true);
    expect(harness.activeRunIdsByItemId.has('first')).toBe(false);

    harness.processing = false;
    harness.cancelledItemIds.clear();
    harness.processing = true;
    harness.activeRunIdsByItemId.set('first', 'first-retry-run');
    expect(acceptsEvent('first', 'first-retry-run', harness.activeRunIdsByItemId)).toBe(true);
  });
});
