import { invoke } from '@tauri-apps/api/core';

import { cleanupSubtitleOcrCuesWithAi } from '$lib/services/subtitle-ocr-ai-cleanup';
import { createSubtitleOcrVersion } from '$lib/services/subtitle-ocr-storage';
import { subtitleOcrStore } from '$lib/stores';
import type {
  SubtitleOcrConfig,
  SubtitleOcrCue,
  SubtitleOcrPipelineResult,
  SubtitleOcrSourceItem,
  SubtitleOcrStatus,
  SubtitleOcrVersion,
} from '$lib/types';
import { logAndToast } from '$lib/utils/log-toast';

import {
  buildSubtitleOcrSourceSnapshot,
  deleteSubtitleOcrRunIdIfCurrent,
} from './subtitle-ocr-view-state';

export type SubtitleOcrProcessItemResult = 'completed' | 'cancelled' | 'error';

type ProcessingResultCounts = Record<SubtitleOcrProcessItemResult, number>;

interface SubtitleOcrPipelineArgs {
  config: SubtitleOcrConfig;
  effectiveOcrModel: SubtitleOcrConfig['ocrModel'];
  args: Record<string, unknown>;
}

export interface SubtitleOcrProcessingCoordinationContext {
  readonly aiCleanupControllers: Map<string, AbortController>;
  readonly activeRunIdsByItemId: Map<string, string>;
  readonly backendCancelableRunIdsByItemId: Map<string, string>;
  getStoreItem(itemId: string): SubtitleOcrSourceItem | undefined;
  preparePipelineSource(item: SubtitleOcrSourceItem, runId: string): Promise<string>;
  buildPipelineArgs(
    item: SubtitleOcrSourceItem,
    sourcePath: string,
    runId: string,
    config?: SubtitleOcrConfig,
  ): SubtitleOcrPipelineArgs;
  setManualProgress(itemId: string, phase: 'extracting' | 'decoding' | 'ocr' | 'ai_cleaning', percentage?: number): void;
  persistItem(itemId: string): Promise<void>;
  requestPendingPreviewRestoreFlush(): void;
  sanitizeProcessingMessage(error: unknown): string;
  isCancellationError(error: unknown): boolean;
  canUseSubtitleOcrAiCleanup(config: SubtitleOcrConfig): boolean;
  warnSubtitleOcrAiCleanupUnavailable(): void;
  getCancelRequested(): boolean;
  setCancelRequested(value: boolean): void;
}

export interface SubtitleOcrProcessingCoordination {
  readonly getCurrentRetryableItemIds: () => string[];
  readonly getCurrentAiCleanupRetryableItemIds: () => string[];
  readonly runProcessingItems: (
    itemIds: string[],
    configByItemId?: ReadonlyMap<string, SubtitleOcrConfig>,
    versionNameByItemId?: ReadonlyMap<string, string>,
  ) => Promise<void>;
  readonly runAiCleanupRetry: (
    itemId: string,
    versionName: string,
    config: SubtitleOcrConfig,
  ) => Promise<void>;
  readonly runAiCleanupRetryItems: (
    itemIds: string[],
    config: SubtitleOcrConfig,
  ) => Promise<void>;
}

const PROCESSABLE_STATUSES = new Set<SubtitleOcrStatus>(['ready', 'completed', 'error']);

function createProcessingResultCounts(): ProcessingResultCounts {
  return {
    completed: 0,
    cancelled: 0,
    error: 0,
  };
}

function recordProcessingResult(
  counts: ProcessingResultCounts,
  result: SubtitleOcrProcessItemResult,
): void {
  counts[result] += 1;
}

function summarizeProcessingResults(counts: ProcessingResultCounts): string {
  const parts: string[] = [];
  if (counts.completed > 0) parts.push(`${counts.completed} completed`);
  if (counts.error > 0) parts.push(`${counts.error} failed`);
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);
  return parts.join(', ');
}

function reportProcessingSummary(title: string, counts: ProcessingResultCounts): void {
  const details = summarizeProcessingResults(counts);
  if (!details) return;

  const level = counts.error > 0 ? 'warning' : 'success';
  logAndToast[level]({
    source: 'subtitle-ocr',
    title: `${title}: ${details}`,
    details,
    showAction: false,
  });
}

export function createSubtitleOcrProcessingCoordination(
  context: SubtitleOcrProcessingCoordinationContext,
): SubtitleOcrProcessingCoordination {
  function isProcessingSessionCurrent(processingSessionId: string): boolean {
    return subtitleOcrStore.processingSessionId === processingSessionId;
  }

  function restoreCancelledItemStatus(itemId: string): void {
    const latestItem = context.getStoreItem(itemId);
    const status: SubtitleOcrStatus = latestItem && latestItem.versions.length > 0
      ? 'completed'
      : 'ready';

    subtitleOcrStore.setItemStatus(itemId, status);
    subtitleOcrStore.setProgress(itemId, undefined);
  }

  function getProcessableItemIds(itemIds: string[]): string[] {
    const requestedIds = new Set(itemIds);

    return subtitleOcrStore.itemSummaries
      .filter((item) => (
        requestedIds.has(item.id)
        && !subtitleOcrStore.isItemHydrating(item.id)
        && PROCESSABLE_STATUSES.has(item.status)
      ))
      .map((item) => item.id);
  }

  async function runAiCleanupForItem(
    itemId: string,
    cues: SubtitleOcrCue[],
    config: SubtitleOcrConfig = subtitleOcrStore.config,
  ): Promise<{ cues: SubtitleOcrCue[]; applied: boolean; cancelled: boolean }> {
    const controller = new AbortController();
    context.aiCleanupControllers.set(itemId, controller);
    context.setManualProgress(itemId, 'ai_cleaning');
    subtitleOcrStore.addLog('info', 'Running Subtitle OCR AI cleanup', itemId);

    try {
      const result = await cleanupSubtitleOcrCuesWithAi(cues, {
        provider: config.aiCleanupProvider,
        model: config.aiCleanupModel,
        signal: controller.signal,
      });

      if (result.cancelled || controller.signal.aborted) {
        return { cues, applied: false, cancelled: true };
      }

      if (subtitleOcrStore.isItemCancelled(itemId)) {
        return { cues, applied: false, cancelled: true };
      }

      if (!result.success) {
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: 'Subtitle OCR AI cleanup skipped',
          details: result.error
            ? context.sanitizeProcessingMessage(result.error)
            : 'AI cleanup failed.',
          showAction: false,
        });
        return { cues, applied: false, cancelled: false };
      }

      if (result.error) {
        subtitleOcrStore.addLog(
          'warning',
          `AI cleanup partially applied: ${context.sanitizeProcessingMessage(result.error)}`,
          itemId,
        );
      }

      subtitleOcrStore.addLog(
        'success',
        `AI cleanup completed (${cues.length} -> ${result.cues.length} cues)`,
        itemId,
      );
      return { cues: result.cues, applied: true, cancelled: false };
    } finally {
      if (context.aiCleanupControllers.get(itemId) === controller) {
        context.aiCleanupControllers.delete(itemId);
      }
    }
  }

  async function processItem(
    item: SubtitleOcrSourceItem,
    processingSessionId: string,
    configOverride?: SubtitleOcrConfig,
    versionNameOverride?: string,
  ): Promise<SubtitleOcrProcessItemResult> {
    if (!subtitleOcrStore.markProcessingItemStarted(
      item.id,
      item.sourceKind === 'container_track' ? 'extracting' : 'decoding',
    )) {
      return 'cancelled';
    }

    const runId = `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const initialItem = context.getStoreItem(item.id) ?? item;
    const versionName = versionNameOverride ?? `Version ${initialItem.versions.length + 1}`;
    context.activeRunIdsByItemId.set(item.id, runId);
    subtitleOcrStore.beginProcessingDraft(item.id, {
      runId,
      name: `${versionName} Draft`,
    });
    subtitleOcrStore.addLog('info', 'Starting Subtitle OCR run', item.id);

    try {
      context.setManualProgress(
        item.id,
        item.sourceKind === 'container_track' ? 'extracting' : 'decoding',
      );

      const sourcePath = await context.preparePipelineSource(item, runId);
      if (
        !isProcessingSessionCurrent(processingSessionId)
        || context.getCancelRequested()
        || subtitleOcrStore.isItemCancelled(item.id)
      ) {
        throw new Error('Subtitle OCR operation cancelled');
      }

      context.setManualProgress(item.id, 'decoding');
      const { args, config, effectiveOcrModel } = context.buildPipelineArgs(
        item,
        sourcePath,
        runId,
        configOverride,
      );
      context.backendCancelableRunIdsByItemId.set(item.id, runId);
      const result = await invoke<SubtitleOcrPipelineResult>('run_subtitle_ocr_pipeline', args);
      deleteSubtitleOcrRunIdIfCurrent(context.backendCancelableRunIdsByItemId, item.id, runId);
      deleteSubtitleOcrRunIdIfCurrent(context.activeRunIdsByItemId, item.id, runId);
      if (!isProcessingSessionCurrent(processingSessionId)) {
        throw new Error('Subtitle OCR operation cancelled');
      }
      const stats = result.stats;
      subtitleOcrStore.addLog(
        'info',
        `Decoded ${stats.decodedBitmapCount} bitmap cues, skipped ${stats.skippedEmptyBitmapCount} empty, reused ${stats.deduplicatedBitmapCount} duplicates, OCR processed ${stats.ocrProcessedBitmapCount}, kept ${result.rawOcrCues.length} raw cues, stabilized ${result.stabilizedCues.length} cues`,
        item.id,
      );
      if (context.getCancelRequested() || subtitleOcrStore.isItemCancelled(item.id)) {
        throw new Error('Subtitle OCR operation cancelled');
      }

      const ocrFinalCues = result.finalCues;
      const cleanup = config.aiCleanupEnabled
        ? await runAiCleanupForItem(item.id, ocrFinalCues, config)
        : { cues: ocrFinalCues, applied: false, cancelled: false };

      if (
        !isProcessingSessionCurrent(processingSessionId)
        || cleanup.cancelled
        || context.getCancelRequested()
        || subtitleOcrStore.isItemCancelled(item.id)
      ) {
        throw new Error('Subtitle OCR operation cancelled');
      }

      const latestItem = context.getStoreItem(item.id) ?? item;
      const version = createSubtitleOcrVersion({
        name: versionName,
        mode: 'full_ocr',
        configSnapshot: config,
        effectiveOcrModel,
        sourceSnapshot: buildSubtitleOcrSourceSnapshot(latestItem),
        bitmaps: result.decodedCues.map((cue) => ({ ...cue })),
        rawOcr: result.rawOcrCues.map((cue) => ({
          ...cue,
          boxes: cue.boxes.map((box) => ({ ...box })),
        })),
        stabilizedCues: result.stabilizedCues.map((cue) => ({
          ...cue,
          sourceCueIds: [...cue.sourceCueIds],
        })),
        finalCues: cleanup.cues.map((cue) => ({
          ...cue,
          sourceCueIds: [...cue.sourceCueIds],
        })),
        aiCleanupApplied: cleanup.applied,
      });

      subtitleOcrStore.completeProcessingDraft(item.id, runId, version);
      await context.persistItem(item.id);
      subtitleOcrStore.addLog('success', `Generated ${version.finalCues.length} final cues`, item.id);
      return 'completed';
    } catch (error) {
      deleteSubtitleOcrRunIdIfCurrent(context.backendCancelableRunIdsByItemId, item.id, runId);
      deleteSubtitleOcrRunIdIfCurrent(context.activeRunIdsByItemId, item.id, runId);
      subtitleOcrStore.clearProcessingDraft(item.id, runId);
      if (!isProcessingSessionCurrent(processingSessionId)) {
        return 'cancelled';
      }
      subtitleOcrStore.setProgress(item.id, undefined);

      if (
        context.isCancellationError(error)
        || context.getCancelRequested()
        || subtitleOcrStore.isItemCancelled(item.id)
      ) {
        restoreCancelledItemStatus(item.id);
        return 'cancelled';
      }

      const details = context.sanitizeProcessingMessage(error);
      subtitleOcrStore.setItemStatus(item.id, 'error', details);
      logAndToast.error({
        source: 'subtitle-ocr',
        title: 'Subtitle OCR failed',
        details,
      });
      return 'error';
    }
  }

  async function runProcessingItems(
    itemIds: string[],
    configByItemId: ReadonlyMap<string, SubtitleOcrConfig> = new Map(),
    versionNameByItemId: ReadonlyMap<string, string> = new Map(),
  ): Promise<void> {
    const processableItemIds = getProcessableItemIds(itemIds);
    if (processableItemIds.length === 0 || subtitleOcrStore.isProcessing) return;

    const unavailableAiConfig = processableItemIds
      .map((itemId) => configByItemId.get(itemId) ?? subtitleOcrStore.config)
      .find((config) => config.aiCleanupEnabled && !context.canUseSubtitleOcrAiCleanup(config));
    if (unavailableAiConfig) {
      context.warnSubtitleOcrAiCleanupUnavailable();
      return;
    }

    context.setCancelRequested(false);
    if (!subtitleOcrStore.startProcessing(processableItemIds)) return;
    const processingSessionId = subtitleOcrStore.processingSessionId;
    if (!processingSessionId) return;
    const counts = createProcessingResultCounts();
    let completedOwnSession = false;

    try {
      for (const itemId of processableItemIds) {
        if (context.getCancelRequested()) break;

        if (subtitleOcrStore.isItemCancelled(itemId)) {
          recordProcessingResult(counts, 'cancelled');
          continue;
        }

        const item = context.getStoreItem(itemId);
        if (!item) continue;

        const result = await processItem(
          item,
          processingSessionId,
          configByItemId.get(itemId),
          versionNameByItemId.get(itemId),
        );
        recordProcessingResult(counts, result);
        if (!isProcessingSessionCurrent(processingSessionId)) break;
        if (!context.getCancelRequested()) subtitleOcrStore.finishProcessingItem(itemId);
        if (result === 'cancelled' && context.getCancelRequested()) break;
      }
    } finally {
      completedOwnSession = subtitleOcrStore.stopProcessing(processingSessionId);
      if (completedOwnSession) {
        context.setCancelRequested(false);
        context.requestPendingPreviewRestoreFlush();
      }
    }

    if (completedOwnSession) reportProcessingSummary('Subtitle OCR finished', counts);
  }

  function getCurrentRetryableItemIds(): string[] {
    return subtitleOcrStore.itemSummaries
      .filter((item) => item.versionCount > 0 && !subtitleOcrStore.isItemHydrating(item.id))
      .map((item) => item.id);
  }

  function getCurrentAiCleanupRetryableItemIds(): string[] {
    return subtitleOcrStore.itemSummaries
      .filter((item) => item.hasActiveVersion && !subtitleOcrStore.isItemHydrating(item.id))
      .map((item) => item.id);
  }

  async function runAiCleanupRetry(
    itemId: string,
    versionName: string,
    config: SubtitleOcrConfig,
  ): Promise<void> {
    if (subtitleOcrStore.isProcessing || subtitleOcrStore.isItemHydrating(itemId)) return;

    if (!context.canUseSubtitleOcrAiCleanup(config)) {
      context.warnSubtitleOcrAiCleanupUnavailable();
      return;
    }

    context.setCancelRequested(false);
    if (!subtitleOcrStore.startProcessing([itemId])) return;
    const processingSessionId = subtitleOcrStore.processingSessionId;
    if (!processingSessionId) return;
    const counts = createProcessingResultCounts();
    let completedOwnSession = false;

    try {
      recordProcessingResult(counts, await processAiCleanupRetryItem(
        itemId,
        versionName,
        config,
        processingSessionId,
      ));
    } finally {
      completedOwnSession = subtitleOcrStore.stopProcessing(processingSessionId);
      if (completedOwnSession) {
        context.setCancelRequested(false);
        context.requestPendingPreviewRestoreFlush();
      }
    }

    if (completedOwnSession) {
      reportProcessingSummary('Subtitle OCR AI cleanup retry finished', counts);
    }
  }

  async function runAiCleanupRetryItems(
    itemIds: string[],
    config: SubtitleOcrConfig,
  ): Promise<void> {
    const processableItemIds = itemIds.filter((itemId) => !subtitleOcrStore.isItemHydrating(itemId));
    if (processableItemIds.length === 0 || subtitleOcrStore.isProcessing) return;

    if (!context.canUseSubtitleOcrAiCleanup(config)) {
      context.warnSubtitleOcrAiCleanupUnavailable();
      return;
    }

    context.setCancelRequested(false);
    if (!subtitleOcrStore.startProcessing(processableItemIds)) return;
    const processingSessionId = subtitleOcrStore.processingSessionId;
    if (!processingSessionId) return;
    const counts = createProcessingResultCounts();
    let completedOwnSession = false;

    try {
      for (const itemId of processableItemIds) {
        if (context.getCancelRequested()) break;

        if (subtitleOcrStore.isItemCancelled(itemId)) {
          recordProcessingResult(counts, 'cancelled');
          continue;
        }

        const result = await processAiCleanupRetryItem(
          itemId,
          undefined,
          config,
          processingSessionId,
        );
        recordProcessingResult(counts, result);
        if (!isProcessingSessionCurrent(processingSessionId)) break;
        if (!context.getCancelRequested()) subtitleOcrStore.finishProcessingItem(itemId);
        if (result === 'cancelled' && context.getCancelRequested()) break;
      }
    } finally {
      completedOwnSession = subtitleOcrStore.stopProcessing(processingSessionId);
      if (completedOwnSession) {
        context.setCancelRequested(false);
        context.requestPendingPreviewRestoreFlush();
      }
    }

    if (completedOwnSession) {
      reportProcessingSummary('Subtitle OCR AI cleanup retry finished', counts);
    }
  }

  async function processAiCleanupRetryItem(
    itemId: string,
    versionName: string | undefined,
    config: SubtitleOcrConfig,
    processingSessionId: string,
  ): Promise<SubtitleOcrProcessItemResult> {
    if (!subtitleOcrStore.markProcessingItemStarted(itemId, 'ai_cleaning')) return 'cancelled';

    const item = context.getStoreItem(itemId);
    const activeVersion = subtitleOcrStore.getActiveVersion(itemId);
    if (!item || !activeVersion) return 'error';

    try {
      const cleanup = await runAiCleanupForItem(itemId, activeVersion.finalCues, config);
      if (!isProcessingSessionCurrent(processingSessionId)) {
        return 'cancelled';
      }
      if (cleanup.cancelled || context.getCancelRequested() || subtitleOcrStore.isItemCancelled(itemId)) {
        restoreCancelledItemStatus(itemId);
        return 'cancelled';
      }

      if (!cleanup.applied) {
        restoreCancelledItemStatus(itemId);
        return 'error';
      }

      const latestItem = context.getStoreItem(itemId) ?? item;
      const version: SubtitleOcrVersion = createSubtitleOcrVersion({
        name: versionName || `Version ${latestItem.versions.length + 1}`,
        mode: 'ai_cleanup_only',
        configSnapshot: config,
        effectiveOcrModel: activeVersion.effectiveOcrModel,
        sourceSnapshot: activeVersion.sourceSnapshot,
        bitmaps: activeVersion.bitmaps,
        rawOcr: activeVersion.rawOcr,
        stabilizedCues: activeVersion.stabilizedCues,
        finalCues: cleanup.cues,
        aiCleanupApplied: true,
      });

      subtitleOcrStore.addVersion(itemId, version);
      await context.persistItem(itemId);
      subtitleOcrStore.addLog('success', `Created ${version.name} with AI cleanup`, itemId);
      return 'completed';
    } catch (error) {
      if (!isProcessingSessionCurrent(processingSessionId)) {
        return 'cancelled';
      }
      if (
        context.isCancellationError(error)
        || context.getCancelRequested()
        || subtitleOcrStore.isItemCancelled(itemId)
      ) {
        restoreCancelledItemStatus(itemId);
        return 'cancelled';
      }

      const details = context.sanitizeProcessingMessage(error);
      subtitleOcrStore.setItemStatus(itemId, 'error', details);
      logAndToast.error({
        source: 'subtitle-ocr',
        title: 'Subtitle OCR AI cleanup retry failed',
        details,
      });
      return 'error';
    }
  }

  return {
    getCurrentRetryableItemIds,
    getCurrentAiCleanupRetryableItemIds,
    runProcessingItems,
    runAiCleanupRetry,
    runAiCleanupRetryItems,
  };
}
