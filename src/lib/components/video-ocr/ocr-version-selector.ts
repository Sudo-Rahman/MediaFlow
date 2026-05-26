import type { OcrVersion } from '$lib/types';

export interface OcrPreviewVersionOption {
  id: string | null;
  label: string;
  description: string;
  draft: boolean;
}

function formatCreatedAt(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function createOcrPreviewVersionOptions({
  versions,
  showDraft,
  draftName,
}: {
  versions: readonly OcrVersion[];
  showDraft: boolean;
  draftName: string;
}): OcrPreviewVersionOption[] {
  const completedOptions = [...versions]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map((version) => ({
      id: version.id,
      label: version.name,
      description: formatCreatedAt(version.createdAt),
      draft: false,
    }));

  if (!showDraft) {
    return completedOptions;
  }

  return [
    {
      id: null,
      label: draftName,
      description: 'Unsaved OCR zone draft',
      draft: true,
    },
    ...completedOptions,
  ];
}
