import { invoke } from '@tauri-apps/api/core';

import { subtitleOcrStore } from '$lib/stores';
import type {
  SubtitleOcrCueBitmap,
  SubtitleOcrProgress,
  SubtitleOcrSourceItem,
} from '$lib/types';
import { logAndToast } from '$lib/utils/log-toast';

import {
  collectMissingSubtitleOcrBitmapAssetsSafely,
  deleteSubtitleOcrRunIdIfCurrent,
  getSubtitleOcrPreviewRestoreRetry,
  SUBTITLE_OCR_PREVIEW_RESTORE_MAX_RETRIES,
  shouldApplySubtitleOcrRestoreResult,
} from './subtitle-ocr-view-state';
import {
  createSubtitleOcrPreviewRestoreState,
  type SubtitleOcrPreviewRestoreState,
} from './subtitle-ocr-preview-restore-state';
import type {
  SubtitleOcrImportLease,
} from './subtitle-ocr-import-generation';

export type SubtitleOcrPreviewRestoreOutcome =
  | 'completed'
  | 'deferred'
  | 'retry'
  | 'failed'
  | 'stale';

export interface SubtitleOcrPreviewCoordinationContext {
  readonly previewRestoreRunIdsByItemId: Map<string, string>;
  readonly activeRunIdsByItemId: Map<string, string>;
  readonly backendCancelableRunIdsByItemId: Map<string, string>;
  getStoreItem(itemId: string): SubtitleOcrSourceItem | undefined;
  createSubtitleOcrRunId(itemId: string): string;
  preparePipelineSource(item: SubtitleOcrSourceItem, runId: string): Promise<string>;
  buildPreviewRestoreArgs(
    item: SubtitleOcrSourceItem,
    sourcePath: string,
    runId: string,
    bitmaps: SubtitleOcrCueBitmap[],
  ): Record<string, unknown>;
  setManualProgress(itemId: string, phase: SubtitleOcrProgress['phase'], percentage?: number): void;
  persistItem(itemId: string, shouldPersist?: () => boolean): Promise<void>;
  sanitizeProcessingMessage(error: unknown): string;
  isCancellationError(error: unknown): boolean;
  getCancelRequested(): boolean;
  isImportGenerationUsable(generation: number): boolean;
  isImportGenerationCancelled(generation: number): boolean;
  retainImportGeneration(generation: number): SubtitleOcrImportLease | null;
  releaseImportGeneration(lease: SubtitleOcrImportLease): void;
  getActiveImportGeneration(): number | null;
  onCancelledRestoreSettled(generation: number): void;
  collectMissingPreviewAssets(bitmaps: SubtitleOcrCueBitmap[]): Promise<SubtitleOcrCueBitmap[]>;
  onActivity(): void;
}

export interface SubtitleOcrPreviewCoordination {
  readonly pendingPreviewRestores: SubtitleOcrPreviewRestoreState;
  readonly hasQueued: boolean;
  readonly restoringItemIds: Set<string>;
  readonly activeRestoreGenerations: ReadonlySet<number>;
  restoreMissingPreviewAssets(
    itemId: string,
    hydrationToken: string,
    generation: number,
  ): Promise<SubtitleOcrPreviewRestoreOutcome>;
  requestPendingPreviewRestoreFlush(): void;
  discardPendingPreviewRestore(itemId: string, expectedToken?: string): boolean;
  cancel(): void;
  clear(): void;
}

export function createSubtitleOcrPreviewCoordination(
  context: SubtitleOcrPreviewCoordinationContext,
): SubtitleOcrPreviewCoordination {
  const pendingPreviewRestores = createSubtitleOcrPreviewRestoreState();
  const previewRestoreGenerationsByItemId = new Map<string, number>();
  const previewRestoreGenerationOwnersByItemId = new Map<string, SubtitleOcrImportLease>();
  let flushingPendingPreviewRestores = false;

  function discardPendingPreviewRestore(itemId: string, expectedToken?: string): boolean {
    const discarded = pendingPreviewRestores.discard(itemId, expectedToken);
    if (!discarded) return false;

    const owner = previewRestoreGenerationOwnersByItemId.get(itemId);
    if (owner) {
      context.releaseImportGeneration(owner);
      previewRestoreGenerationOwnersByItemId.delete(itemId);
    }
    previewRestoreGenerationsByItemId.delete(itemId);
    context.onActivity();
    return true;
  }

  function retainQueuedRestoreLease(itemId: string, generation: number): boolean {
    if (previewRestoreGenerationOwnersByItemId.has(itemId)) return true;
    const lease = context.retainImportGeneration(generation);
    if (!lease) return false;
    previewRestoreGenerationOwnersByItemId.set(itemId, lease);
    context.onActivity();
    return true;
  }

  function handleCollectionFailure(
    itemId: string,
    hydrationToken: string,
    generation: number,
    error: unknown,
  ): SubtitleOcrPreviewRestoreOutcome {
    if (
      !context.isImportGenerationUsable(generation)
      || !subtitleOcrStore.isHydrationTokenValid(itemId, hydrationToken)
    ) {
      discardPendingPreviewRestore(itemId, hydrationToken);
      return 'stale';
    }

    const retry = getSubtitleOcrPreviewRestoreRetry(
      pendingPreviewRestores.get(itemId, hydrationToken)?.attempts ?? 0,
      true,
    );
    const details = context.sanitizeProcessingMessage(error);
    if (retry.shouldRetry) {
      if (!pendingPreviewRestores.retry(itemId, hydrationToken, retry.nextAttempt)) return 'stale';
      if (!retainQueuedRestoreLease(itemId, generation)) {
        discardPendingPreviewRestore(itemId, hydrationToken);
        return 'stale';
      }
      context.onActivity();
      subtitleOcrStore.addLog(
        'warning',
        `Could not check missing Subtitle OCR previews; retry ${retry.nextAttempt}/${SUBTITLE_OCR_PREVIEW_RESTORE_MAX_RETRIES}: ${details}`,
        itemId,
      );
      return 'retry';
    }

    discardPendingPreviewRestore(itemId, hydrationToken);
    subtitleOcrStore.setItemStatus(itemId, 'completed');
    subtitleOcrStore.setProgress(itemId, undefined);
    subtitleOcrStore.addLog(
      'warning',
      `Could not check missing Subtitle OCR previews after ${SUBTITLE_OCR_PREVIEW_RESTORE_MAX_RETRIES} attempts: ${details}`,
      itemId,
    );
    logAndToast.warning({
      source: 'subtitle-ocr',
      title: 'Subtitle OCR previews were not restored',
      details: 'The OCR text remains available, but missing cue images could not be checked after several attempts.',
      showAction: false,
    });
    return 'failed';
  }

  function schedulePendingPreviewRestoreRetry(itemId: string, hydrationToken: string): void {
    if (subtitleOcrStore.isHydrationTokenValid(itemId, hydrationToken)) {
      pendingPreviewRestores.schedule(itemId, hydrationToken, requestPendingPreviewRestoreFlush);
    }
  }

  async function flushPendingPreviewRestores(): Promise<void> {
    if (flushingPendingPreviewRestores || subtitleOcrStore.isProcessing) return;

    const pendingRestore = pendingPreviewRestores.listCurrent().find((entry) => (
      entry.phase === 'queued'
      && !subtitleOcrStore.isItemHydrating(entry.itemId)
      && subtitleOcrStore.isHydrationTokenValid(entry.itemId, entry.hydrationToken)
    ));
    for (const entry of pendingPreviewRestores.listCurrent()) {
      if (entry.phase === 'queued' && !subtitleOcrStore.isHydrationTokenValid(entry.itemId, entry.hydrationToken)) {
        discardPendingPreviewRestore(entry.itemId, entry.hydrationToken);
      }
    }
    if (!pendingRestore) return;

    const { itemId, hydrationToken } = pendingRestore;
    const generation = previewRestoreGenerationsByItemId.get(itemId);
    if (generation === undefined || context.isImportGenerationCancelled(generation)) {
      discardPendingPreviewRestore(itemId, hydrationToken);
      return;
    }
    const activeGeneration = context.getActiveImportGeneration();
    if (activeGeneration !== null && activeGeneration !== generation) return;

    flushingPendingPreviewRestores = true;
    let outcome: SubtitleOcrPreviewRestoreOutcome = 'failed';
    try {
      outcome = await restoreMissingPreviewAssets(itemId, hydrationToken, generation);
    } catch (error) {
      outcome = handleCollectionFailure(itemId, hydrationToken, generation, error);
    } finally {
      flushingPendingPreviewRestores = false;
      if (outcome === 'retry' && !subtitleOcrStore.isProcessing && pendingPreviewRestores.hasQueued()) {
        schedulePendingPreviewRestoreRetry(itemId, hydrationToken);
      }
    }
    if (outcome === 'completed' || outcome === 'failed' || outcome === 'stale') {
      queueMicrotask(requestPendingPreviewRestoreFlush);
    }
  }

  function requestPendingPreviewRestoreFlush(): void {
    const activeGeneration = context.getActiveImportGeneration();
    if (activeGeneration !== null && context.isImportGenerationCancelled(activeGeneration)) return;
    void flushPendingPreviewRestores().catch(() => {
      subtitleOcrStore.addLog('warning', 'Pending Subtitle OCR preview restoration stopped unexpectedly');
    });
  }

  async function restoreMissingPreviewAssets(
    itemId: string,
    hydrationToken: string,
    generation: number,
  ): Promise<SubtitleOcrPreviewRestoreOutcome> {
    if (!context.isImportGenerationUsable(generation) || !subtitleOcrStore.isHydrationTokenValid(itemId, hydrationToken)) {
      discardPendingPreviewRestore(itemId, hydrationToken);
      return 'stale';
    }

    const claimed = pendingPreviewRestores.begin(itemId, hydrationToken, true);
    if (claimed) {
      previewRestoreGenerationsByItemId.set(itemId, generation);
      context.onActivity();
    } else {
      if (pendingPreviewRestores.getCurrent(itemId)?.hydrationToken === hydrationToken) return 'stale';
      if (!pendingPreviewRestores.queue(itemId, hydrationToken, true)) return 'stale';
      if (!retainQueuedRestoreLease(itemId, generation)) {
        discardPendingPreviewRestore(itemId, hydrationToken);
        return 'stale';
      }
      previewRestoreGenerationsByItemId.set(itemId, generation);
      context.onActivity();
      return 'deferred';
    }

    const item = context.getStoreItem(itemId);
    if (!item || item.versions.length === 0) {
      discardPendingPreviewRestore(itemId, hydrationToken);
      return 'completed';
    }

    const collection = await collectMissingSubtitleOcrBitmapAssetsSafely(
      item.versions,
      context.collectMissingPreviewAssets,
    );
    if (!collection.ok) return handleCollectionFailure(itemId, hydrationToken, generation, collection.error);
    if (
      !context.isImportGenerationUsable(generation)
      || !subtitleOcrStore.isHydrationTokenValid(itemId, hydrationToken)
    ) {
      discardPendingPreviewRestore(itemId, hydrationToken);
      return 'stale';
    }
    if (collection.bitmaps.length === 0) {
      discardPendingPreviewRestore(itemId, hydrationToken);
      return 'completed';
    }

    let processingStarted = false;
    let processingSessionId: string | null = null;
    if (!subtitleOcrStore.startProcessing([item.id])) {
      if (!pendingPreviewRestores.requeue(itemId, hydrationToken) || !retainQueuedRestoreLease(itemId, generation)) return 'stale';
      return 'deferred';
    }
    processingStarted = true;
    processingSessionId = subtitleOcrStore.processingSessionId;
    const runId = context.createSubtitleOcrRunId(`${item.id}-restore`);
    context.previewRestoreRunIdsByItemId.set(item.id, runId);
    context.activeRunIdsByItemId.set(item.id, runId);
    subtitleOcrStore.markProcessingItemStarted(item.id, 'decoding');
    subtitleOcrStore.addLog('info', `Restoring ${collection.bitmaps.length} missing preview assets`, item.id);

    try {
      context.setManualProgress(item.id, 'decoding');
      const sourcePath = await context.preparePipelineSource(item, runId);
      if (!context.isImportGenerationUsable(generation) || !shouldApplySubtitleOcrRestoreResult(
        context.getCancelRequested(),
        subtitleOcrStore.isItemCancelled(item.id),
      )) throw new Error('Subtitle OCR operation cancelled');

      context.backendCancelableRunIdsByItemId.set(item.id, runId);
      const restoredBitmaps = await invoke<SubtitleOcrCueBitmap[]>(
        'restore_subtitle_ocr_bitmap_assets',
        context.buildPreviewRestoreArgs(item, sourcePath, runId, collection.bitmaps),
      );
      deleteSubtitleOcrRunIdIfCurrent(context.backendCancelableRunIdsByItemId, item.id, runId);
      if (!context.isImportGenerationUsable(generation) || !shouldApplySubtitleOcrRestoreResult(
        context.getCancelRequested(),
        subtitleOcrStore.isItemCancelled(item.id),
      ) || !subtitleOcrStore.isHydrationTokenValid(itemId, hydrationToken)) {
        throw new Error('Subtitle OCR operation cancelled');
      }

      for (const bitmap of restoredBitmaps) subtitleOcrStore.updateRestoredBitmap(item.id, bitmap);
      subtitleOcrStore.setItemStatus(item.id, 'completed');
      await context.persistItem(item.id, () => subtitleOcrStore.isHydrationTokenValid(itemId, hydrationToken));
      if (!context.isImportGenerationUsable(generation) || !subtitleOcrStore.isHydrationTokenValid(itemId, hydrationToken)) {
        discardPendingPreviewRestore(itemId, hydrationToken);
        return 'stale';
      }
      discardPendingPreviewRestore(itemId, hydrationToken);
      subtitleOcrStore.addLog('success', `Restored ${restoredBitmaps.length}/${collection.bitmaps.length} missing preview assets`, item.id);
      if (restoredBitmaps.length < collection.bitmaps.length) {
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: 'Some Subtitle OCR previews were not restored',
          details: 'The OCR text remains available, but some cue images could not be regenerated.',
          showAction: false,
        });
      }
      return 'completed';
    } catch (error) {
      if (!context.isImportGenerationUsable(generation) || !subtitleOcrStore.isHydrationTokenValid(itemId, hydrationToken)) {
        discardPendingPreviewRestore(itemId, hydrationToken);
        return 'stale';
      }
      subtitleOcrStore.setItemStatus(item.id, 'completed');
      subtitleOcrStore.setProgress(item.id, undefined);
      if (!context.isCancellationError(error) && !context.getCancelRequested() && !subtitleOcrStore.isItemCancelled(item.id)) {
        subtitleOcrStore.addLog('warning', 'Subtitle OCR previews were not restored', item.id);
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: 'Subtitle OCR previews were not restored',
          details: 'The OCR text remains available, but missing cue images could not be regenerated.',
          showAction: false,
        });
      }
      discardPendingPreviewRestore(itemId, hydrationToken);
      return 'failed';
    } finally {
      if (claimed) {
        const current = pendingPreviewRestores.get(itemId, hydrationToken);
        if (current?.phase === 'in_flight') {
          pendingPreviewRestores.finish(itemId, hydrationToken);
          const owner = previewRestoreGenerationOwnersByItemId.get(itemId);
          if (owner) {
            context.releaseImportGeneration(owner);
            previewRestoreGenerationOwnersByItemId.delete(itemId);
          }
          previewRestoreGenerationsByItemId.delete(itemId);
          context.onActivity();
        }
      }
      deleteSubtitleOcrRunIdIfCurrent(context.backendCancelableRunIdsByItemId, item.id, runId);
      deleteSubtitleOcrRunIdIfCurrent(context.activeRunIdsByItemId, item.id, runId);
      deleteSubtitleOcrRunIdIfCurrent(context.previewRestoreRunIdsByItemId, item.id, runId);
      const stoppedProcessing = processingStarted
        && processingSessionId !== null
        && subtitleOcrStore.stopProcessing(processingSessionId);
      if (stoppedProcessing && subtitleOcrStore.isHydrationTokenValid(itemId, hydrationToken)) {
        subtitleOcrStore.setItemStatus(item.id, 'completed');
        subtitleOcrStore.setProgress(item.id, undefined);
      }
      if (stoppedProcessing) requestPendingPreviewRestoreFlush();
      if (context.isImportGenerationCancelled(generation)) {
        context.onCancelledRestoreSettled(generation);
      }
    }
  }

  function cancel(): void {
    for (const [itemId, runId] of context.previewRestoreRunIdsByItemId) {
      deleteSubtitleOcrRunIdIfCurrent(context.previewRestoreRunIdsByItemId, itemId, runId);
      deleteSubtitleOcrRunIdIfCurrent(context.activeRunIdsByItemId, itemId, runId);
      deleteSubtitleOcrRunIdIfCurrent(context.backendCancelableRunIdsByItemId, itemId, runId);
    }
    previewRestoreGenerationsByItemId.clear();
    for (const owner of previewRestoreGenerationOwnersByItemId.values()) context.releaseImportGeneration(owner);
    previewRestoreGenerationOwnersByItemId.clear();
    pendingPreviewRestores.clear();
    context.onActivity();
  }

  return {
    pendingPreviewRestores,
    get hasQueued(): boolean { return pendingPreviewRestores.hasQueued(); },
    get restoringItemIds(): Set<string> { return new Set(context.previewRestoreRunIdsByItemId.keys()); },
    get activeRestoreGenerations(): ReadonlySet<number> {
      return new Set(previewRestoreGenerationsByItemId.values());
    },
    restoreMissingPreviewAssets,
    requestPendingPreviewRestoreFlush,
    discardPendingPreviewRestore,
    cancel,
    clear: cancel,
  };
}
