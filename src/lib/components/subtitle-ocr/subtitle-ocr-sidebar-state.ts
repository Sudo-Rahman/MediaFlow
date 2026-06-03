import type { SubtitleOcrStatus } from '$lib/types';

export function shouldShowSubtitleOcrItemCancelAction(
  status: SubtitleOcrStatus,
  isProcessing: boolean,
  inProcessingScope: boolean,
): boolean {
  if (!isProcessing) {
    return false;
  }

  if (inProcessingScope) {
    return true;
  }

  return status === 'extracting'
    || status === 'decoding'
    || status === 'ocr_processing'
    || status === 'ai_cleaning';
}
