import { beforeEach, describe, expect, it } from 'vitest';

import type { SubtitleOcrCue, SubtitleOcrSourceItem, SubtitleOcrVersion } from '$lib/types';
import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';
import { subtitleOcrStore } from './subtitle-ocr.svelte';

function source(id: string): SubtitleOcrSourceItem {
  return {
    id,
    sourceKind: 'standalone_sup',
    sourcePath: `/subs/${id}.sup`,
    displayName: `${id}.sup`,
    status: 'ready',
    ocrModelOverride: 'default',
    versions: [],
    activeVersionId: null,
  };
}

function cue(id: string, text: string): SubtitleOcrCue {
  return {
    id,
    sourceCueIds: [id],
    startTimeMs: 1000,
    endTimeMs: 2000,
    text,
    confidence: 0.9,
  };
}

function version(id: string, text: string): SubtitleOcrVersion {
  return {
    id,
    name: id,
    createdAt: `2026-05-28T00:00:0${id.slice(-1)}.000Z`,
    mode: 'full_ocr',
    configSnapshot: DEFAULT_SUBTITLE_OCR_CONFIG,
    effectiveOcrModel: DEFAULT_SUBTITLE_OCR_CONFIG.ocrModel,
    sourceSnapshot: {
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/source.sup',
      ocrModelOverride: 'default',
    },
    bitmaps: [],
    rawOcr: [],
    stabilizedCues: [cue(`raw-${id}`, text)],
    finalCues: [cue(`cue-${id}`, text)],
    aiCleanupApplied: false,
  };
}

describe('subtitleOcrStore', () => {
  beforeEach(() => {
    subtitleOcrStore.reset();
  });

  it('adds and selects source items', () => {
    subtitleOcrStore.addItems([source('a'), source('b')]);

    expect(subtitleOcrStore.items).toHaveLength(2);
    expect(subtitleOcrStore.selectedItem?.id).toBe('a');
  });

  it('sets active version and exposes active cues', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'one'));
    subtitleOcrStore.addVersion('a', version('v2', 'two'));
    subtitleOcrStore.selectVersion('a', 'v1');

    expect(subtitleOcrStore.getActiveVersion('a')?.id).toBe('v1');
    expect(subtitleOcrStore.getActiveCues('a')[0]?.text).toBe('one');
  });

  it('creates a draft from the active version without mutating final cues', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));
    subtitleOcrStore.updateCueText('a', 'cue-v1', 'after');

    expect(subtitleOcrStore.getActiveVersion('a')?.finalCues[0]?.text).toBe('before');
    expect(subtitleOcrStore.getRenderedCues('a')[0]?.text).toBe('after');
    expect(subtitleOcrStore.selectedItem?.draft?.dirty).toBe(true);
  });
});
