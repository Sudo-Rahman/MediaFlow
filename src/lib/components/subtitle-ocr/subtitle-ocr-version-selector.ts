import type {
  SubtitleOcrProcessingDraftSummary,
  SubtitleOcrVersionSummary,
} from '$lib/stores';
import type { SubtitleOcrProcessingDraft } from '$lib/types';
import { buildSubtitleOcrProcessingDraftId } from '$lib/utils/subtitle-ocr-review-target';

export interface SubtitleOcrVersionOption {
  id: string;
  label: string;
  description: string;
  processingDraft: boolean;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function getSubtitleOcrVersionModeLabel(version: SubtitleOcrVersionSummary): string {
  return version.mode === 'ai_cleanup_only' ? 'AI cleanup' : 'Full OCR';
}

export function formatSubtitleOcrVersionDate(createdAt: string): string {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) {
    return 'Unknown date';
  }

  return dateFormatter.format(new Date(timestamp));
}

export function toCompactSubtitleOcrVersionLabel(label: string): string {
  const draftMatch = /^Version\s+(.+)\s+Draft$/i.exec(label.trim());
  if (draftMatch) {
    return `V${draftMatch[1]} Draft`;
  }

  const match = /^Version\s+(.+)$/i.exec(label.trim());
  return match ? `V${match[1]}` : label;
}

export function buildSubtitleOcrVersionOptions({
  versions,
  processingDraft,
}: {
  versions: readonly SubtitleOcrVersionSummary[];
  processingDraft?: SubtitleOcrProcessingDraftSummary | SubtitleOcrProcessingDraft;
}): SubtitleOcrVersionOption[] {
  const versionOptions = versions.map((version) => ({
    id: version.id,
    label: version.name,
    description: `${getSubtitleOcrVersionModeLabel(version)} · ${formatSubtitleOcrVersionDate(version.createdAt)}`,
    processingDraft: false,
  }));

  if (!processingDraft) {
    return versionOptions;
  }

  return [
    ...versionOptions,
    {
      id: buildSubtitleOcrProcessingDraftId(processingDraft.runId),
      label: processingDraft.name,
      description: 'OCR in progress',
      processingDraft: true,
    },
  ];
}
