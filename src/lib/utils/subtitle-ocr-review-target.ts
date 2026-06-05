export const SUBTITLE_OCR_PROCESSING_DRAFT_PREFIX = 'processing-draft:';

export function buildSubtitleOcrProcessingDraftId(runId: string): string {
  return `${SUBTITLE_OCR_PROCESSING_DRAFT_PREFIX}${runId}`;
}

export function isSubtitleOcrProcessingDraftId(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(SUBTITLE_OCR_PROCESSING_DRAFT_PREFIX);
}
