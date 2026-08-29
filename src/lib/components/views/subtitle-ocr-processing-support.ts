import {
  loadSubtitleOcrData,
  saveSubtitleOcrData,
} from '$lib/services/subtitle-ocr-storage';
import { subtitleOcrStore } from '$lib/stores';
import type { SubtitleOcrCueBitmap, SubtitleOcrSourceItem } from '$lib/types';
import { logAndToast } from '$lib/utils/log-toast';

import { mergeSubtitleOcrPersistenceForItem } from './subtitle-ocr-view-state';

export interface SubtitleOcrProcessingSupportContext {
  readonly persistenceQueues: Map<string, Promise<void>>;
  getStoreItem(itemId: string): SubtitleOcrSourceItem | undefined;
  sanitizeProcessingMessage(error: unknown): string;
}

export interface SubtitleOcrProcessingSupport {
  readonly createSubtitleOcrRunId: (itemId: string) => string;
  readonly persistItem: (itemId: string, shouldPersist?: () => boolean) => Promise<void>;
  readonly collectMissingPreviewAssets: (bitmaps: SubtitleOcrCueBitmap[]) => Promise<SubtitleOcrCueBitmap[]>;
}

export function createSubtitleOcrProcessingSupport(
  context: SubtitleOcrProcessingSupportContext,
): SubtitleOcrProcessingSupport {
  function createSubtitleOcrRunId(itemId: string): string {
    const randomSegment = Math.random().toString(36).slice(2, 10);
    return `${itemId}-${Date.now()}-${randomSegment}`;
  }

  async function persistItem(itemId: string, shouldPersist?: () => boolean): Promise<void> {
    const item = context.getStoreItem(itemId);
    if (!item) return;

    const sourcePath = item.sourcePath;
    const previous = context.persistenceQueues.get(sourcePath) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const latestItem = context.getStoreItem(itemId);
      if (!latestItem || latestItem.sourcePath !== sourcePath || (shouldPersist && !shouldPersist())) {
        return;
      }

      try {
        if (shouldPersist && !shouldPersist()) return;
        const existingData = await loadSubtitleOcrData(sourcePath);
        if (shouldPersist && !shouldPersist()) return;
        const saved = await saveSubtitleOcrData(
          sourcePath,
          mergeSubtitleOcrPersistenceForItem(latestItem, existingData, new Date().toISOString()),
        );

        if (!saved) {
          logAndToast.warning({
            source: 'subtitle-ocr',
            title: 'Subtitle OCR versions were not saved',
            details: 'The Subtitle OCR changes could not be written to the MediaFlow sidecar.',
            showAction: false,
          });
        }
      } catch (error) {
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: 'Subtitle OCR versions were not saved',
          details: context.sanitizeProcessingMessage(error),
          showAction: false,
        });
      }
    });

    context.persistenceQueues.set(sourcePath, next);
    try {
      await next;
    } finally {
      if (context.persistenceQueues.get(sourcePath) === next) {
        context.persistenceQueues.delete(sourcePath);
      }
    }
  }

  async function collectMissingPreviewAssets(bitmaps: SubtitleOcrCueBitmap[]): Promise<SubtitleOcrCueBitmap[]> {
    return invoke<SubtitleOcrCueBitmap[]>('collect_missing_subtitle_ocr_bitmap_assets', { bitmaps });
  }

  return { createSubtitleOcrRunId, persistItem, collectMissingPreviewAssets };
}
import { invoke } from '@tauri-apps/api/core';
