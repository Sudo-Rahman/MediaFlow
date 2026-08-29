import { deleteSubtitleOcrRunIdIfCurrent } from './subtitle-ocr-view-state';

export interface SubtitleOcrItemCancellationTarget {
  readonly itemId: string;
  readonly backendRunId?: string;
  readonly activeRunId?: string;
  readonly previewRunId?: string;
}

export interface SubtitleOcrItemCancellationContext {
  readonly aiCleanupControllers: Map<string, AbortController>;
  readonly activeRunIdsByItemId: Map<string, string>;
  readonly backendCancelableRunIdsByItemId: Map<string, string>;
  readonly previewRestoreRunIdsByItemId: Map<string, string>;
  getItem(itemId: string): unknown | undefined;
  isProcessing(): boolean;
  isItemCancelled(itemId: string): boolean;
  cancelProcessing(itemId: string): void;
}

export interface SubtitleOcrItemCancellationResult {
  readonly target: SubtitleOcrItemCancellationTarget;
  readonly backendError?: unknown;
}

export type CancelSubtitleOcrBackendOperation = (
  target: SubtitleOcrItemCancellationTarget & { readonly backendRunId: string },
) => Promise<void>;

function deleteRunIdIfPresent(
  runIdsByItemId: Map<string, string>,
  itemId: string,
  runId: string | undefined,
): void {
  if (runId !== undefined) {
    deleteSubtitleOcrRunIdIfCurrent(runIdsByItemId, itemId, runId);
  }
}

/**
 * Invalidate one item's event acceptance synchronously before any backend IPC.
 * The exact snapshots make a late completion unable to remove a newer run.
 */
export function prepareSubtitleOcrItemCancellation(
  context: SubtitleOcrItemCancellationContext,
  itemId: string,
): SubtitleOcrItemCancellationTarget | null {
  if (!context.isProcessing() || context.isItemCancelled(itemId) || !context.getItem(itemId)) {
    return null;
  }

  const target: SubtitleOcrItemCancellationTarget = {
    itemId,
    backendRunId: context.backendCancelableRunIdsByItemId.get(itemId),
    activeRunId: context.activeRunIdsByItemId.get(itemId),
    previewRunId: context.previewRestoreRunIdsByItemId.get(itemId),
  };

  context.cancelProcessing(itemId);
  deleteRunIdIfPresent(context.backendCancelableRunIdsByItemId, itemId, target.backendRunId);
  deleteRunIdIfPresent(context.activeRunIdsByItemId, itemId, target.activeRunId);
  deleteRunIdIfPresent(context.previewRestoreRunIdsByItemId, itemId, target.previewRunId);
  context.aiCleanupControllers.get(itemId)?.abort();
  context.aiCleanupControllers.delete(itemId);

  return target;
}

export async function cancelSubtitleOcrItem(
  context: SubtitleOcrItemCancellationContext,
  itemId: string,
  cancelBackendOperation: CancelSubtitleOcrBackendOperation,
): Promise<SubtitleOcrItemCancellationResult | null> {
  const target = prepareSubtitleOcrItemCancellation(context, itemId);
  if (!target) {
    return null;
  }

  if (!target.backendRunId) {
    return { target };
  }

  try {
    await cancelBackendOperation({ ...target, backendRunId: target.backendRunId });
    return { target };
  } catch (backendError) {
    return { target, backendError };
  }
}
