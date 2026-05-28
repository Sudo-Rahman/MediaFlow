import type { SubtitleOcrStatus } from '$lib/types';

interface SubtitleOcrSummaryItem {
  status: SubtitleOcrStatus;
  versions: readonly unknown[];
}

export interface SubtitleOcrItemsSummary {
  readyCount: number;
  retryableCount: number;
  scanningCount: number;
}

export function summarizeSubtitleOcrItems(
  items: readonly SubtitleOcrSummaryItem[],
): SubtitleOcrItemsSummary {
  return items.reduce<SubtitleOcrItemsSummary>(
    (summary, item) => {
      if (item.status === 'ready') {
        summary.readyCount += 1;
      }

      if (item.status === 'scanning') {
        summary.scanningCount += 1;
      }

      if (item.status === 'error' || (item.status === 'completed' && item.versions.length > 0)) {
        summary.retryableCount += 1;
      }

      return summary;
    },
    { readyCount: 0, retryableCount: 0, scanningCount: 0 },
  );
}
