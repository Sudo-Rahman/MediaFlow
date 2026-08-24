import { describe, expect, it } from 'vitest';

import type { SubtitleOcrProgress } from '$lib/types';
import {
  calculateSubtitleOcrBatchProgress,
  isSubtitleOcrProgressPhaseStale,
  mergeSubtitleOcrProgress,
  type SubtitleOcrBatchProgressItem,
  type SubtitleOcrBatchProgressMetric,
} from './subtitle-ocr-progress';

function progress(overrides: Partial<SubtitleOcrProgress>): SubtitleOcrProgress {
  return {
    phase: 'ocr',
    current: 0,
    total: 0,
    totalKnown: false,
    percentage: 0,
    ...overrides,
  };
}

describe('mergeSubtitleOcrProgress', () => {
  it('keeps OCR progress fixed while the total is unknown', () => {
    const merged = mergeSubtitleOcrProgress(undefined, progress({
      current: 27,
      percentage: 0,
    }));

    expect(merged).toMatchObject({
      current: 27,
      total: 0,
      totalKnown: false,
      percentage: 0,
      overallPercentage: 10,
    });
  });

  it('updates the total when a background count finishes', () => {
    const unknown = mergeSubtitleOcrProgress(undefined, progress({
      current: 100,
      percentage: 0,
    }));
    const known = mergeSubtitleOcrProgress(unknown, progress({
      current: 100,
      total: 1_000,
      totalKnown: true,
      percentage: 10,
    }));

    expect(known).toMatchObject({
      current: 100,
      total: 1_000,
      totalKnown: true,
      percentage: 10,
    });
    expect(known.overallPercentage).toBe(28);
  });

  it('does not replace a newer current value with a stale lower count', () => {
    const unknown = mergeSubtitleOcrProgress(undefined, progress({
      current: 120,
      percentage: 0,
    }));
    const known = mergeSubtitleOcrProgress(unknown, progress({
      current: 100,
      total: 1_000,
      totalKnown: true,
      percentage: 10,
    }));

    expect(known).toMatchObject({
      current: 120,
      total: 1_000,
      totalKnown: true,
      percentage: 0,
    });
  });

  it('does not let a delayed background count overwrite the final corrected total', () => {
    const finalProgress = mergeSubtitleOcrProgress(undefined, progress({
      current: 350,
      total: 350,
      totalKnown: true,
      percentage: 100,
    }));
    const delayedCount = mergeSubtitleOcrProgress(finalProgress, progress({
      current: 300,
      total: 373,
      totalKnown: true,
      percentage: 80,
    }));

    expect(delayedCount).toMatchObject({
      current: 350,
      total: 350,
      totalKnown: true,
      percentage: 100,
    });
    expect(delayedCount.overallPercentage).toBe(finalProgress.overallPercentage);
  });

  it('keeps latest OCR counts visible when actual progress is below the previous display value', () => {
    const previous = mergeSubtitleOcrProgress(undefined, progress({
      current: 100,
      total: 1_000,
      totalKnown: true,
      percentage: 10,
      overallPercentage: 35,
    }));
    const updated = mergeSubtitleOcrProgress(previous, progress({
      current: 140,
      total: 1_000,
      totalKnown: true,
      percentage: 14,
    }));

    expect(updated).toMatchObject({
      current: 140,
      total: 1_000,
      totalKnown: true,
      percentage: 14,
    });
    expect(updated.overallPercentage).toBe(previous.overallPercentage);
  });

  it('ignores delayed unknown-total details after the total is known', () => {
    const known = mergeSubtitleOcrProgress(undefined, progress({
      current: 140,
      total: 1_000,
      totalKnown: true,
      percentage: 14,
    }));
    const delayedUnknown = mergeSubtitleOcrProgress(known, progress({
      current: 130,
      totalKnown: false,
      percentage: 0,
    }));

    expect(delayedUnknown).toMatchObject({
      current: 140,
      total: 1_000,
      totalKnown: true,
      percentage: 14,
    });
  });

  it('does not regress when stale progress events arrive', () => {
    const previous = mergeSubtitleOcrProgress(undefined, progress({
      current: 50,
      total: 100,
      totalKnown: true,
      percentage: 50,
    }));
    const stale = mergeSubtitleOcrProgress(previous, progress({
      phase: 'decoding',
      current: 1,
      total: 1,
      totalKnown: true,
      percentage: 100,
    }));

    expect(stale).toMatchObject({
      phase: 'ocr',
      current: 50,
      percentage: 50,
      overallPercentage: 58,
    });
  });

  it('identifies stale phase events before status updates are applied', () => {
    expect(isSubtitleOcrProgressPhaseStale(progress({ phase: 'ai_cleaning' }), 'ocr'))
      .toBe(true);
    expect(isSubtitleOcrProgressPhaseStale(progress({ phase: 'ocr' }), 'ai_cleaning'))
      .toBe(false);
  });
});

describe('calculateSubtitleOcrBatchProgress', () => {
  it('does not count stale completed or error statuses before retry items start', () => {
    const metric = calculateSubtitleOcrBatchProgress(
      [
        { id: 'completed', status: 'completed' },
        { id: 'error', status: 'error' },
        { id: 'queued', status: 'ready' },
      ],
      new Set(['completed', 'error', 'queued']),
      new Set(['completed', 'error', 'queued']),
      new Set(),
      new Set(),
      true,
    );

    expect(metric).toEqual({
      doneUnits: 0,
      totalUnits: 3,
      settledCount: 0,
    });
  });

  it('keeps retry progress monotonic with a stable denominator as items start and settle', () => {
    const batchItemIds = new Set(['a', 'b', 'c']);
    const scopeItemIds = new Set(batchItemIds);
    const startedItemIds = new Set<string>();
    const cancelledItemIds = new Set<string>();
    const metrics: SubtitleOcrBatchProgressMetric[] = [];
    const measure = (items: SubtitleOcrBatchProgressItem[]) => {
      metrics.push(calculateSubtitleOcrBatchProgress(
        items,
        batchItemIds,
        scopeItemIds,
        startedItemIds,
        cancelledItemIds,
        true,
      ));
    };

    measure([
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'error' },
      { id: 'c', status: 'ready' },
    ]);
    startedItemIds.add('a');
    measure([
      { id: 'a', status: 'ocr_processing', progress: progress({ percentage: 40, overallPercentage: 40 }) },
      { id: 'b', status: 'error' },
      { id: 'c', status: 'ready' },
    ]);
    measure([
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'error' },
      { id: 'c', status: 'ready' },
    ]);
    scopeItemIds.delete('a');
    measure([
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'error' },
      { id: 'c', status: 'ready' },
    ]);
    startedItemIds.add('b');
    measure([
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'ocr_processing', progress: progress({ percentage: 20, overallPercentage: 20 }) },
      { id: 'c', status: 'ready' },
    ]);
    measure([
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'error' },
      { id: 'c', status: 'ready' },
    ]);
    scopeItemIds.delete('b');
    startedItemIds.add('c');
    measure([
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'error' },
      { id: 'c', status: 'ocr_processing', progress: progress({ percentage: 70, overallPercentage: 70 }) },
    ]);

    expect(metrics.map((metric) => metric.doneUnits)).toEqual([0, 0.4, 1, 1, 1.2, 2, 2.7]);
    expect(metrics.every((metric) => metric.totalUnits === 3)).toBe(true);
    expect(metrics.map((metric) => metric.settledCount)).toEqual([0, 0, 1, 1, 1, 2, 2]);
  });

  it('keeps the original batch denominator after completed items leave the active scope', () => {
    const metric = calculateSubtitleOcrBatchProgress(
      [
        { id: 'completed', status: 'completed' },
        {
          id: 'active',
          status: 'ocr_processing',
          progress: progress({ percentage: 50, overallPercentage: 60 }),
        },
        { id: 'queued', status: 'ready' },
      ],
      new Set(['completed', 'active', 'queued']),
      new Set(['active', 'queued']),
      new Set(['active']),
      new Set(),
      true,
    );

    expect(metric).toEqual({
      doneUnits: 1.6,
      totalUnits: 3,
      settledCount: 1,
    });
  });

  it('counts individually cancelled items as settled without shrinking the batch', () => {
    const metric = calculateSubtitleOcrBatchProgress(
      [
        { id: 'cancelled', status: 'ready' },
        { id: 'active', status: 'decoding', progress: progress({ percentage: 20 }) },
      ],
      new Set(['cancelled', 'active']),
      new Set(['active']),
      new Set(['active']),
      new Set(['cancelled']),
      true,
    );

    expect(metric).toEqual({
      doneUnits: 1.2,
      totalUnits: 2,
      settledCount: 1,
    });
  });
});
