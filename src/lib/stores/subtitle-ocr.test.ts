import { beforeEach, describe, expect, it } from 'vitest';

import type { SubtitleOcrCue, SubtitleOcrSourceItem, SubtitleOcrVersion } from '$lib/types';
import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';
import { subtitleOcrStore } from './subtitle-ocr.svelte';

function assertUpdateItemTyping(): void {
  // @ts-expect-error Version changes must go through dedicated version methods.
  subtitleOcrStore.updateItem('a', { versions: [] });
  // @ts-expect-error Source paths are immutable through updateItem.
  subtitleOcrStore.updateItem('a', { sourcePath: '/subs/other.sup' });
}

void assertUpdateItemTyping;

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

function containerSource(id: string): SubtitleOcrSourceItem {
  return {
    id,
    sourceKind: 'container_track',
    sourcePath: `/media/${id}.mkv`,
    displayName: `${id}.mkv`,
    status: 'ready',
    ocrModelOverride: 'default',
    track: {
      streamIndex: 4,
      codec: 'hdmv_pgs_subtitle',
      codecLabel: 'PGS',
      language: 'eng',
      title: 'English forced',
      forced: true,
      default: false,
    },
    versions: [],
    activeVersionId: null,
  };
}

function vobSubSource(id: string): SubtitleOcrSourceItem {
  return {
    id,
    sourceKind: 'standalone_vobsub',
    sourcePath: `/subs/${id}.idx`,
    displayName: `${id}.idx/${id}.sub`,
    status: 'ready',
    ocrModelOverride: 'default',
    pair: {
      idxPath: `/subs/${id}.idx`,
      subPath: `/subs/${id}.sub`,
    },
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

  it('deduplicates source items by id within and across import batches', () => {
    subtitleOcrStore.addItems([source('a'), source('a'), source('b')]);
    subtitleOcrStore.addItems([source('a')]);

    expect(subtitleOcrStore.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('preserves container and VobSub discriminated source fields', () => {
    subtitleOcrStore.addItems([containerSource('movie'), vobSubSource('subs')]);

    const container = subtitleOcrStore.items.find((item) => item.id === 'movie');
    const vobSub = subtitleOcrStore.items.find((item) => item.id === 'subs');

    expect(container?.sourceKind).toBe('container_track');
    if (container?.sourceKind !== 'container_track') {
      throw new Error('Expected a container subtitle OCR item');
    }
    expect(container.track).toMatchObject({
      streamIndex: 4,
      codecLabel: 'PGS',
      language: 'eng',
      title: 'English forced',
    });
    expect('pair' in container).toBe(false);

    expect(vobSub?.sourceKind).toBe('standalone_vobsub');
    if (vobSub?.sourceKind !== 'standalone_vobsub') {
      throw new Error('Expected a VobSub subtitle OCR item');
    }
    expect(vobSub.pair).toEqual({
      idxPath: '/subs/subs.idx',
      subPath: '/subs/subs.sub',
    });
    expect('track' in vobSub).toBe(false);
  });

  it('sets active version and exposes active cues', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'one'));
    subtitleOcrStore.addVersion('a', version('v2', 'two'));
    subtitleOcrStore.selectVersion('a', 'v1');

    expect(subtitleOcrStore.getActiveVersion('a')?.id).toBe('v1');
    expect(subtitleOcrStore.getActiveCues('a')[0]?.text).toBe('one');
  });

  it('normalizes invalid selected version ids', () => {
    const item = source('a');
    item.versions = [version('v1', 'one')];
    item.activeVersionId = 'missing';
    subtitleOcrStore.addItems([item]);
    subtitleOcrStore.selectVersion('a', 'still-missing');

    expect(subtitleOcrStore.selectedItem?.activeVersionId).toBe('v1');
    expect(subtitleOcrStore.getActiveCues('a')[0]?.text).toBe('one');
  });

  it('ignores invalid selected version ids without dropping the active draft', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));
    subtitleOcrStore.updateCueText('a', 'cue-v1', 'after');
    subtitleOcrStore.selectVersion('a', 'missing');

    expect(subtitleOcrStore.selectedItem?.activeVersionId).toBe('v1');
    expect(subtitleOcrStore.selectedItem?.draft?.dirty).toBe(true);
    expect(subtitleOcrStore.getRenderedCues('a')[0]?.text).toBe('after');
  });

  it('creates a draft from the active version without mutating final cues', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));
    subtitleOcrStore.updateCueText('a', 'cue-v1', 'after');

    expect(subtitleOcrStore.getActiveVersion('a')?.finalCues[0]?.text).toBe('before');
    expect(subtitleOcrStore.getRenderedCues('a')[0]?.text).toBe('after');
    expect(subtitleOcrStore.selectedItem?.draft?.dirty).toBe(true);
  });

  it('returns cloned item objects from the items getter', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));

    const item = subtitleOcrStore.items[0];
    if (!item) {
      throw new Error('Expected a subtitle OCR item');
    }

    item.displayName = 'mutated.sup';
    item.versions[0].finalCues[0].text = 'mutated';

    expect(subtitleOcrStore.items[0]?.displayName).toBe('a.sup');
    expect(subtitleOcrStore.getActiveVersion('a')?.finalCues[0]?.text).toBe('before');
  });

  it('returns a cloned selected item', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));

    const selected = subtitleOcrStore.selectedItem;
    if (!selected) {
      throw new Error('Expected a selected subtitle OCR item');
    }

    selected.displayName = 'mutated.sup';
    selected.versions[0].finalCues[0].text = 'mutated';

    expect(subtitleOcrStore.selectedItem?.displayName).toBe('a.sup');
    expect(subtitleOcrStore.getActiveVersion('a')?.finalCues[0]?.text).toBe('before');
  });

  it('updates only safe item metadata through updateItem', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'one'));
    subtitleOcrStore.updateItem('a', {
      displayName: 'updated.sup',
      status: 'scanning',
      size: 123,
      duration: 45,
      error: 'Scan pending',
      progress: {
        phase: 'decoding',
        current: 1,
        total: 2,
        percentage: 50,
        message: 'Decoding',
      },
      ocrModelOverride: 'latin',
    });

    expect(subtitleOcrStore.selectedItem).toMatchObject({
      id: 'a',
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/a.sup',
      displayName: 'updated.sup',
      status: 'scanning',
      size: 123,
      duration: 45,
      error: 'Scan pending',
      ocrModelOverride: 'latin',
      activeVersionId: 'v1',
    });
    expect(subtitleOcrStore.selectedItem?.progress).toMatchObject({
      phase: 'decoding',
      percentage: 50,
    });

    const unsafeUpdates = {
      id: 'mutated',
      sourceKind: 'standalone_vobsub',
      sourcePath: '/subs/mutated.idx',
      pair: {
        idxPath: '/subs/mutated.idx',
        subPath: '/subs/mutated.sub',
      },
      versions: [],
      activeVersionId: null,
      draft: {
        baseVersionId: 'v1',
        cues: [],
        dirty: true,
        updatedAt: '2026-05-28T00:00:00.000Z',
      },
    } as unknown as Parameters<typeof subtitleOcrStore.updateItem>[1];

    subtitleOcrStore.updateItem('a', unsafeUpdates);

    expect(subtitleOcrStore.selectedItem).toMatchObject({
      id: 'a',
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/a.sup',
      activeVersionId: 'v1',
    });
    expect(subtitleOcrStore.getActiveVersion('a')?.id).toBe('v1');
    expect(subtitleOcrStore.selectedItem?.draft).toBeUndefined();
  });
});
