import { beforeEach, describe, expect, it } from 'vitest';

import type {
  SubtitleOcrCue,
  SubtitleOcrCueBitmap,
  SubtitleOcrRawCue,
  SubtitleOcrSourceItem,
  SubtitleOcrVersion,
} from '$lib/types';
import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';
import { logStore } from './logs.svelte';
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

function bitmap(cueId: string): SubtitleOcrCueBitmap {
  return {
    cueId,
    startTimeMs: 1000,
    endTimeMs: 2000,
    width: 640,
    height: 120,
    cacheKey: `cache-${cueId}`,
    previewPath: `/tmp/${cueId}.png`,
  };
}

function rawCue(cueId: string, text: string): SubtitleOcrRawCue {
  return {
    cueId,
    startTimeMs: 1000,
    endTimeMs: 2000,
    cacheKey: `cache-${cueId}`,
    boxes: [],
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
    logStore.clearLogs();
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

  it('replaces hydrated versions and active id without forcing completed status', () => {
    const hydratedVersion = version('v1', 'hydrated');
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.replaceItemVersions('a', [hydratedVersion], hydratedVersion.id);

    hydratedVersion.finalCues[0].text = 'mutated';

    expect(subtitleOcrStore.selectedItem).toMatchObject({
      id: 'a',
      status: 'ready',
      activeVersionId: 'v1',
    });
    expect(subtitleOcrStore.getActiveVersion('a')?.finalCues[0]?.text).toBe('hydrated');
  });

  it('can set a status while replacing hydrated versions', () => {
    const hydratedVersion = version('v1', 'hydrated');
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.replaceItemVersions('a', [hydratedVersion], hydratedVersion.id, {
      status: 'completed',
    });

    expect(subtitleOcrStore.selectedItem).toMatchObject({
      status: 'completed',
      activeVersionId: 'v1',
    });
  });

  it('can replace preview asset paths without clearing live review state', () => {
    const hydratedVersion = version('v1', 'before');
    const restoredVersion = version('v1', 'before');
    restoredVersion.bitmaps = [{
      cueId: 'cue-v1',
      startTimeMs: 1000,
      endTimeMs: 2000,
      width: 720,
      height: 360,
      previewPath: '/tmp/restored-preview.png',
    }];
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.replaceItemVersions('a', [hydratedVersion], hydratedVersion.id, {
      status: 'completed',
    });
    subtitleOcrStore.setProgress('a', {
      phase: 'decoding',
      current: 183,
      total: 685,
      totalKnown: true,
      percentage: 26,
      overallPercentage: 26,
    });
    expect(subtitleOcrStore.updateCueText('a', 'cue-v1', 'after')).toBe(true);

    const editedVersion = subtitleOcrStore.getActiveVersion('a');
    if (!editedVersion) {
      throw new Error('Expected edited active version');
    }
    restoredVersion.finalCues = editedVersion.finalCues;

    subtitleOcrStore.replaceItemVersions('a', [restoredVersion], restoredVersion.id, {
      preserveProgress: true,
    });

    expect(subtitleOcrStore.getActiveVersion('a')?.finalCues[0]?.text).toBe('after');
    expect(subtitleOcrStore.selectedItem?.progress).toMatchObject({
      phase: 'decoding',
      current: 183,
      total: 685,
      overallPercentage: 26,
    });
    expect(subtitleOcrStore.getActiveVersion('a')?.bitmaps[0]?.previewPath)
      .toBe('/tmp/restored-preview.png');
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

  it('ignores invalid selected version ids without dropping direct edits', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));
    subtitleOcrStore.updateCueText('a', 'cue-v1', 'after');
    subtitleOcrStore.selectVersion('a', 'missing');

    expect(subtitleOcrStore.selectedItem?.activeVersionId).toBe('v1');
    expect(subtitleOcrStore.getRenderedCues('a')[0]?.text).toBe('after');
    expect(subtitleOcrStore.getActiveVersion('a')?.finalCues[0]?.text).toBe('after');
  });

  it('updates recognized text directly on the selected version', () => {
    subtitleOcrStore.addItems([source('a')]);
    const originalVersion = version('v1', 'before');
    subtitleOcrStore.addVersion('a', originalVersion);

    expect(subtitleOcrStore.updateCueText('a', 'cue-v1', 'after')).toBe(true);

    expect(subtitleOcrStore.getActiveVersion('a')?.finalCues[0]?.text).toBe('after');
    expect(subtitleOcrStore.getRenderedCues('a')[0]?.text).toBe('after');
    expect(originalVersion.finalCues[0]?.text).toBe('before');
  });

  it('ignores unchanged or missing recognized text edits', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));

    expect(subtitleOcrStore.updateCueText('a', 'cue-v1', 'before')).toBe(false);
    expect(subtitleOcrStore.updateCueText('a', 'missing', 'after')).toBe(false);

    expect(subtitleOcrStore.getActiveVersion('a')?.finalCues[0]?.text).toBe('before');
  });

  it('renders live processing draft cues for a source without versions', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.beginProcessingDraft('a', {
      runId: 'run-1',
      name: 'Version 1 Draft',
    });
    subtitleOcrStore.appendProcessingDraftCue('a', 'run-1', {
      bitmap: bitmap('cue-live'),
      rawCue: rawCue('cue-live', 'live raw'),
      provisionalCue: cue('cue-live', 'live text'),
    });

    expect(subtitleOcrStore.selectedItem).toMatchObject({
      activeVersionId: null,
      reviewTargetId: 'processing-draft:run-1',
      processingDraft: {
        runId: 'run-1',
        name: 'Version 1 Draft',
      },
    });
    expect(subtitleOcrStore.getRenderedCues('a')[0]?.text).toBe('live text');
    expect(subtitleOcrStore.getRenderedBitmaps('a')[0]?.previewPath).toBe('/tmp/cue-live.png');
  });

  it('keeps live projection array and entry identity across append and replacement', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.beginProcessingDraft('a', {
      runId: 'run-identity',
      name: 'Version 1 Draft',
    });
    subtitleOcrStore.appendProcessingDraftCue('a', 'run-identity', {
      bitmap: bitmap('cue-one'),
      rawCue: rawCue('cue-one', 'raw one'),
      provisionalCue: cue('cue-one', 'one'),
    });

    const firstCues = subtitleOcrStore.getRenderedCues('a');
    const firstBitmaps = subtitleOcrStore.getRenderedBitmaps('a');
    const firstCue = firstCues[0];
    const firstBitmap = firstBitmaps[0];
    if (!firstCue || !firstBitmap) {
      throw new Error('Expected the first live projection entry');
    }
    expect(Object.isFrozen(firstCues)).toBe(true);
    expect(Object.isFrozen(firstCue)).toBe(true);
    expect(Object.isFrozen(firstCue.sourceCueIds)).toBe(true);
    expect(Object.isFrozen(firstBitmaps)).toBe(true);
    expect(Object.isFrozen(firstBitmap)).toBe(true);

    subtitleOcrStore.appendProcessingDraftCue('a', 'run-identity', {
      bitmap: bitmap('cue-two'),
      rawCue: rawCue('cue-two', 'raw two'),
      provisionalCue: cue('cue-two', 'two'),
    });

    const appendedCues = subtitleOcrStore.getRenderedCues('a');
    const appendedBitmaps = subtitleOcrStore.getRenderedBitmaps('a');
    expect(appendedCues).not.toBe(firstCues);
    expect(appendedBitmaps).not.toBe(firstBitmaps);
    expect(appendedCues[0]).toBe(firstCue);
    expect(appendedBitmaps[0]).toBe(firstBitmap);

    subtitleOcrStore.appendProcessingDraftCue('a', 'run-identity', {
      bitmap: { ...bitmap('cue-one'), previewPath: '/tmp/cue-one-replaced.png' },
      rawCue: rawCue('cue-one', 'raw one replaced'),
      provisionalCue: { ...cue('cue-one', 'one replaced') },
    });

    const replacedCues = subtitleOcrStore.getRenderedCues('a');
    const replacedBitmaps = subtitleOcrStore.getRenderedBitmaps('a');
    expect(replacedCues[0]).not.toBe(firstCue);
    expect(replacedBitmaps[0]).not.toBe(firstBitmap);
    expect(replacedCues[1]).toBe(appendedCues[1]);
    expect(replacedBitmaps[1]).toBe(appendedBitmaps[1]);
    expect(replacedCues[0]?.text).toBe('one replaced');
    expect(replacedBitmaps[0]?.previewPath).toBe('/tmp/cue-one-replaced.png');
  });

  it('restores one bitmap with copy-on-write sharing across versions', () => {
    subtitleOcrStore.addItems([source('a')]);
    const firstVersion = version('v1', 'one');
    firstVersion.bitmaps = [bitmap('cue-v1')];
    const secondVersion = version('v2', 'two');
    secondVersion.bitmaps = [bitmap('cue-v2')];
    subtitleOcrStore.addVersion('a', firstVersion);
    subtitleOcrStore.addVersion('a', secondVersion);

    subtitleOcrStore.selectVersion('a', 'v1');
    const firstCues = subtitleOcrStore.getRenderedCues('a');
    const firstBitmaps = subtitleOcrStore.getRenderedBitmaps('a');
    subtitleOcrStore.selectVersion('a', 'v2');
    const secondCues = subtitleOcrStore.getRenderedCues('a');
    const secondBitmaps = subtitleOcrStore.getRenderedBitmaps('a');

    subtitleOcrStore.selectVersion('a', 'v1');
    expect(subtitleOcrStore.updateRestoredBitmap('a', {
      ...bitmap('cue-v1'),
      previewPath: '/tmp/restored-v1.png',
    })).toBe(true);

    const restoredCues = subtitleOcrStore.getRenderedCues('a');
    const restoredBitmaps = subtitleOcrStore.getRenderedBitmaps('a');
    expect(restoredCues).toBe(firstCues);
    expect(restoredCues[0]).toBe(firstCues[0]);
    expect(restoredBitmaps).not.toBe(firstBitmaps);
    expect(restoredBitmaps[0]).not.toBe(firstBitmaps[0]);
    expect(restoredBitmaps[0]?.previewPath).toBe('/tmp/restored-v1.png');

    subtitleOcrStore.selectVersion('a', 'v2');
    expect(subtitleOcrStore.getRenderedCues('a')).toBe(secondCues);
    expect(subtitleOcrStore.getRenderedBitmaps('a')).not.toBe(secondBitmaps);
    expect(subtitleOcrStore.getRenderedBitmaps('a')[0]?.previewPath).toBe('/tmp/restored-v1.png');
  });

  it('keeps an existing completed version visible when a new OCR draft starts', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'one'));
    subtitleOcrStore.beginProcessingDraft('a', {
      runId: 'run-2',
      name: 'Version 2 Draft',
    });

    expect(subtitleOcrStore.selectedItem).toMatchObject({
      activeVersionId: 'v1',
      reviewTargetId: 'v1',
      processingDraft: {
        runId: 'run-2',
        name: 'Version 2 Draft',
      },
    });
    expect(subtitleOcrStore.getRenderedCues('a')[0]?.text).toBe('one');

    subtitleOcrStore.selectVersion('a', 'processing-draft:run-2');
    subtitleOcrStore.appendProcessingDraftCue('a', 'run-2', {
      bitmap: bitmap('cue-live'),
      rawCue: rawCue('cue-live', 'live raw'),
      provisionalCue: cue('cue-live', 'live text'),
    });

    expect(subtitleOcrStore.getRenderedCues('a')[0]?.text).toBe('live text');
  });

  it('ignores text edits while the processing draft is selected', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.beginProcessingDraft('a', {
      runId: 'run-1',
      name: 'Version 1 Draft',
    });
    subtitleOcrStore.appendProcessingDraftCue('a', 'run-1', {
      bitmap: bitmap('cue-live'),
      rawCue: rawCue('cue-live', 'live raw'),
      provisionalCue: cue('cue-live', 'live text'),
    });

    expect(subtitleOcrStore.updateCueText('a', 'cue-live', 'edited')).toBe(false);

    expect(subtitleOcrStore.getRenderedCues('a')[0]?.text).toBe('live text');
  });

  it('keeps completed versions editable while an OCR draft is processing', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));
    subtitleOcrStore.beginProcessingDraft('a', {
      runId: 'run-2',
      name: 'Version 2 Draft',
    });

    expect(subtitleOcrStore.updateCueText('a', 'cue-v1', 'after')).toBe(true);

    expect(subtitleOcrStore.getRenderedCues('a')[0]?.text).toBe('after');
    expect(subtitleOcrStore.getActiveVersion('a')?.finalCues[0]?.text).toBe('after');
  });

  it('completion clears only the processing draft and preserves edited completed versions', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));
    subtitleOcrStore.updateCueText('a', 'cue-v1', 'after');
    subtitleOcrStore.beginProcessingDraft('a', {
      runId: 'run-2',
      name: 'Version 2 Draft',
    });

    subtitleOcrStore.completeProcessingDraft('a', 'run-2', version('v2', 'new ocr'));

    expect(subtitleOcrStore.selectedItem?.processingDraft).toBeUndefined();
    expect(subtitleOcrStore.selectedItem?.activeVersionId).toBe('v1');
    expect(subtitleOcrStore.getRenderedCues('a')[0]?.text).toBe('after');
    expect(subtitleOcrStore.items[0]?.versions.map((entry) => entry.id)).toEqual(['v1', 'v2']);
  });

  it('keeps direct edits isolated when a new OCR version is added', () => {
    subtitleOcrStore.addItems([source('a')]);
    const originalVersion = version('v1', 'before');
    subtitleOcrStore.addVersion('a', originalVersion);
    subtitleOcrStore.updateCueText('a', 'cue-v1', 'after');

    subtitleOcrStore.addVersion('a', {
      ...version('v2', 'placeholder'),
      bitmaps: originalVersion.bitmaps.map((bitmap) => ({ ...bitmap })),
      rawOcr: originalVersion.rawOcr.map((rawCue) => ({
        ...rawCue,
        boxes: rawCue.boxes.map((box) => ({ ...box })),
      })),
      stabilizedCues: originalVersion.stabilizedCues.map((stabilizedCue) => ({
        ...stabilizedCue,
        sourceCueIds: [...stabilizedCue.sourceCueIds],
      })),
      finalCues: [cue('cue-v2', 'new text')],
    });

    expect(subtitleOcrStore.getActiveVersion('a')?.id).toBe('v2');
    expect(subtitleOcrStore.getReviewVersion('a')?.finalCues[0]?.text).toBe('new text');
    subtitleOcrStore.selectVersion('a', 'v1');
    expect(subtitleOcrStore.getReviewVersion('a')?.finalCues[0]?.text).toBe('after');
    expect(originalVersion.finalCues[0]?.text).toBe('before');
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

  it('returns a cloned processing scope set', () => {
    subtitleOcrStore.startProcessing(['a', 'b']);

    const scope = subtitleOcrStore.processingScopeItemIds;
    scope.delete('a');

    expect([...subtitleOcrStore.processingScopeItemIds]).toEqual(['a', 'b']);
  });

  it('keeps the original batch scope after an item finishes', () => {
    subtitleOcrStore.startProcessing(['a', 'b', 'c']);

    subtitleOcrStore.finishProcessingItem('a');

    expect([...subtitleOcrStore.processingScopeItemIds]).toEqual(['b', 'c']);
    expect([...subtitleOcrStore.processingBatchItemIds]).toEqual(['a', 'b', 'c']);
  });

  it('returns a cloned processing batch set', () => {
    subtitleOcrStore.startProcessing(['a', 'b']);

    const batch = subtitleOcrStore.processingBatchItemIds;
    batch.delete('a');

    expect([...subtitleOcrStore.processingBatchItemIds]).toEqual(['a', 'b']);
  });

  it('tracks only items that have entered the current processing run', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.setItemStatus('a', 'completed');
    subtitleOcrStore.setProgress('a', {
      phase: 'ocr',
      current: 100,
      total: 100,
      totalKnown: true,
      percentage: 100,
    });
    subtitleOcrStore.startProcessing(['a', 'b']);

    expect([...subtitleOcrStore.processingStartedItemIds]).toEqual([]);
    expect(subtitleOcrStore.markProcessingItemStarted('a', 'ocr_processing')).toBe(true);
    expect([...subtitleOcrStore.processingStartedItemIds]).toEqual(['a']);
    expect(subtitleOcrStore.getItemSnapshot('a')).toMatchObject({
      status: 'ocr_processing',
      progress: undefined,
      error: undefined,
    });

    const detachedStartedIds = subtitleOcrStore.processingStartedItemIds;
    detachedStartedIds.delete('a');
    expect([...subtitleOcrStore.processingStartedItemIds]).toEqual(['a']);

    subtitleOcrStore.stopProcessing();
    expect([...subtitleOcrStore.processingStartedItemIds]).toEqual([]);
  });

  it('refuses a second processing owner without overwriting the active batch', () => {
    expect(subtitleOcrStore.startProcessing(['a', 'b'])).toBe(true);
    subtitleOcrStore.markProcessingItemStarted('a', 'ocr_processing');

    expect(subtitleOcrStore.startProcessing(['replacement'])).toBe(false);
    expect([...subtitleOcrStore.processingBatchItemIds]).toEqual(['a', 'b']);
    expect([...subtitleOcrStore.processingScopeItemIds]).toEqual(['a', 'b']);
    expect([...subtitleOcrStore.processingStartedItemIds]).toEqual(['a']);
  });

  it('keeps an exposed import non-runnable until current hydration completes', () => {
    subtitleOcrStore.addItems([source('a')]);
    const firstToken = subtitleOcrStore.startHydration('a');

    expect(subtitleOcrStore.isItemHydrating('a')).toBe(true);
    expect(subtitleOcrStore.startProcessing(['a'])).toBe(false);
    expect(subtitleOcrStore.processingBatchItemIds.size).toBe(0);

    subtitleOcrStore.finishHydration('a', firstToken);
    expect(subtitleOcrStore.isHydrationCurrent('a', firstToken)).toBe(false);
    expect(subtitleOcrStore.isHydrationTokenValid('a', firstToken)).toBe(true);

    const replacementToken = subtitleOcrStore.startHydration('a');
    expect(subtitleOcrStore.isHydrationTokenValid('a', firstToken)).toBe(false);
    expect(subtitleOcrStore.isHydrationCurrent('a', replacementToken)).toBe(true);

    expect(subtitleOcrStore.replaceHydratedItemVersions(
      'a',
      firstToken,
      [version('stale', 'stale')],
      'stale',
    )).toBe(false);
    expect(subtitleOcrStore.getItemSnapshot('a')?.versions).toHaveLength(0);

    expect(subtitleOcrStore.replaceHydratedItemVersions(
      'a',
      replacementToken,
      [version('hydrated', 'hydrated')],
      'hydrated',
    )).toBe(true);
    subtitleOcrStore.finishHydration('a', replacementToken);
    expect(subtitleOcrStore.startProcessing(['a'])).toBe(true);
    subtitleOcrStore.markProcessingItemStarted('a');
    expect(subtitleOcrStore.getItemSnapshot('a')?.status).toBe('decoding');
  });

  it('completes hydration without stealing an active processing owner', () => {
    subtitleOcrStore.addItems([source('a'), source('b')]);
    const hydrationToken = subtitleOcrStore.startHydration('a');

    expect(subtitleOcrStore.startProcessing(['b'])).toBe(true);
    subtitleOcrStore.markProcessingItemStarted('b', 'ocr_processing');
    expect(subtitleOcrStore.replaceHydratedItemVersions(
      'a',
      hydrationToken,
      [version('hydrated', 'hydrated')],
      'hydrated',
    )).toBe(true);
    subtitleOcrStore.finishHydration('a', hydrationToken);

    expect([...subtitleOcrStore.processingBatchItemIds]).toEqual(['b']);
    expect(subtitleOcrStore.startProcessing(['a'])).toBe(false);
    subtitleOcrStore.stopProcessing();
    expect(subtitleOcrStore.startProcessing(['a'])).toBe(true);
  });

  it('invalidates current and completed hydration tokens for cancel-all', () => {
    subtitleOcrStore.addItems([source('a')]);
    const token = subtitleOcrStore.startHydration('a');

    expect(subtitleOcrStore.invalidateHydration('a', token)).toBe(true);
    expect(subtitleOcrStore.isItemHydrating('a')).toBe(false);
    expect(subtitleOcrStore.isHydrationCurrent('a', token)).toBe(false);
    expect(subtitleOcrStore.isHydrationTokenValid('a', token)).toBe(false);
    expect(subtitleOcrStore.invalidateHydration('a', token)).toBe(false);

    const completedToken = subtitleOcrStore.startHydration('a');
    subtitleOcrStore.finishHydration('a', completedToken);
    expect(subtitleOcrStore.invalidateHydration('a', completedToken)).toBe(true);
    expect(subtitleOcrStore.isHydrationTokenValid('a', completedToken)).toBe(false);
  });

  it('cancels one processing item without marking the whole batch as cancelling', () => {
    subtitleOcrStore.addItems([source('a'), source('b')]);
    subtitleOcrStore.startProcessing(['a', 'b']);
    subtitleOcrStore.setItemStatus('a', 'ocr_processing');

    subtitleOcrStore.cancelProcessing('a');

    expect(subtitleOcrStore.isItemCancelled('a')).toBe(true);
    expect(subtitleOcrStore.isCancelling).toBe(false);
    expect([...subtitleOcrStore.processingScopeItemIds]).toEqual(['b']);
    expect([...subtitleOcrStore.processingBatchItemIds]).toEqual(['a', 'b']);
    expect(subtitleOcrStore.items.find((item) => item.id === 'a')?.status).toBe('ready');
  });

  it('restores a cancelled versioned item to completed status', () => {
    subtitleOcrStore.addItems([source('a'), source('b')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));
    subtitleOcrStore.startProcessing(['a', 'b']);
    subtitleOcrStore.setItemStatus('a', 'ai_cleaning');

    subtitleOcrStore.cancelProcessing('a');

    const item = subtitleOcrStore.items.find((entry) => entry.id === 'a');
    expect(item?.status).toBe('completed');
    expect(item?.progress).toBeUndefined();
    expect(item?.activeVersionId).toBe('v1');
    expect([...subtitleOcrStore.processingScopeItemIds]).toEqual(['b']);
    expect([...subtitleOcrStore.processingBatchItemIds]).toEqual(['a', 'b']);
  });

  it('settles every active item before a cancel-all backend request completes', () => {
    subtitleOcrStore.addItems([source('a'), source('b')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));
    subtitleOcrStore.startProcessing(['a', 'b']);
    subtitleOcrStore.markProcessingItemStarted('a', 'decoding');
    subtitleOcrStore.markProcessingItemStarted('b', 'extracting');
    subtitleOcrStore.setProgress('a', {
      phase: 'decoding',
      current: 1,
      total: 10,
      totalKnown: true,
      percentage: 10,
    });
    subtitleOcrStore.setProgress('b', {
      phase: 'extracting',
      current: 1,
      total: 4,
      totalKnown: true,
      percentage: 25,
    });

    subtitleOcrStore.cancelProcessingBatch(['a', 'b']);

    const versionedItem = subtitleOcrStore.getItemSnapshot('a');
    const unversionedItem = subtitleOcrStore.getItemSnapshot('b');
    expect(versionedItem?.status).toBe('completed');
    expect(versionedItem?.progress).toBeUndefined();
    expect(versionedItem?.activeVersionId).toBe('v1');
    expect(unversionedItem?.status).toBe('ready');
    expect(unversionedItem?.progress).toBeUndefined();
    expect([...subtitleOcrStore.processingScopeItemIds]).toEqual([]);
    expect(subtitleOcrStore.isItemCancelled('a')).toBe(true);
    expect(subtitleOcrStore.isItemCancelled('b')).toBe(true);
    expect(subtitleOcrStore.isProcessing).toBe(true);

    subtitleOcrStore.setProgress('a', {
      phase: 'decoding',
      current: 2,
      total: 10,
      totalKnown: true,
      percentage: 20,
    });
    subtitleOcrStore.cancelProcessingBatch(['a', 'b']);
    expect(subtitleOcrStore.getItemSnapshot('a')?.progress).toBeUndefined();

    subtitleOcrStore.stopProcessing();
    expect(subtitleOcrStore.startProcessing(['a'])).toBe(true);
    expect(subtitleOcrStore.markProcessingItemStarted('a', 'decoding')).toBe(true);
  });

  it('settles map-owned processing items even after they left the active scope', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));
    subtitleOcrStore.startProcessing(['a']);
    subtitleOcrStore.markProcessingItemStarted('a', 'decoding');
    subtitleOcrStore.finishProcessingItem('a');

    subtitleOcrStore.cancelProcessingBatch(['a']);

    expect(subtitleOcrStore.getItemSnapshot('a')).toMatchObject({
      status: 'completed',
      activeVersionId: 'v1',
    });
    expect(subtitleOcrStore.isItemCancelled('a')).toBe(true);
  });

  it('ignores cancellation requests for items that left the active scope', () => {
    subtitleOcrStore.addItems([source('a'), source('b')]);
    subtitleOcrStore.startProcessing(['a', 'b']);
    subtitleOcrStore.markProcessingItemStarted('a');
    subtitleOcrStore.finishProcessingItem('a');

    subtitleOcrStore.cancelProcessing('a');

    expect(subtitleOcrStore.isItemCancelled('a')).toBe(false);
    expect([...subtitleOcrStore.processingScopeItemIds]).toEqual(['b']);
    expect([...subtitleOcrStore.processingBatchItemIds]).toEqual(['a', 'b']);
  });

  it('exposes lightweight detached item and export summaries', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.addVersion('a', version('v1', 'before'));
    subtitleOcrStore.setProgress('a', {
      phase: 'ocr',
      current: 10,
      total: 100,
      percentage: 10,
    });

    const itemSummary = subtitleOcrStore.itemSummaries[0];
    const exportSummary = subtitleOcrStore.exportItemSummaries[0];
    if (!itemSummary || !exportSummary) {
      throw new Error('Expected Subtitle OCR summaries');
    }

    itemSummary.displayName = 'mutated.sup';
    if (itemSummary.progress) {
      itemSummary.progress.percentage = 99;
    }
    exportSummary.versions[0].name = 'mutated';

    expect(itemSummary.versionCount).toBe(1);
    expect(itemSummary.hasActiveVersion).toBe(true);
    expect('versions' in itemSummary).toBe(false);
    expect(subtitleOcrStore.itemSummaries[0]).toMatchObject({
      displayName: 'a.sup',
      progress: { percentage: 10 },
    });
    expect(subtitleOcrStore.exportItemSummaries[0]?.versions[0]?.name).toBe('v1');
    expect(subtitleOcrStore.getItemSnapshot('a')?.versions[0]?.finalCues[0]?.text).toBe('before');

    const workspaceSummary = subtitleOcrStore.getWorkspaceItemSummary('a');
    expect(workspaceSummary?.versions[0]).toEqual({
      id: 'v1',
      name: 'v1',
      createdAt: '2026-05-28T00:00:01.000Z',
      mode: 'full_ocr',
    });
    expect('finalCues' in (workspaceSummary?.versions[0] ?? {})).toBe(false);
  });

  it('ignores stale progress after an item is cancelled', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.startProcessing(['a']);
    subtitleOcrStore.setItemStatus('a', 'ocr_processing');
    subtitleOcrStore.setProgress('a', {
      phase: 'ocr',
      current: 10,
      total: 100,
      percentage: 10,
    });

    subtitleOcrStore.cancelProcessing('a');
    subtitleOcrStore.setProgress('a', {
      phase: 'ocr',
      current: 80,
      total: 100,
      percentage: 80,
    });

    const item = subtitleOcrStore.items.find((entry) => entry.id === 'a');
    expect(item?.status).toBe('ready');
    expect(item?.progress).toBeUndefined();
  });

  it('derives overall progress from streamed OCR bitmap progress', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.setProgress('a', {
      phase: 'ocr',
      current: 27,
      total: 373,
      percentage: 7,
    });

    expect(subtitleOcrStore.selectedItem?.progress).toMatchObject({
      phase: 'ocr',
      current: 27,
      total: 373,
      percentage: 7,
      overallPercentage: 25,
    });
  });

  it('keeps subtitle OCR progress monotonic within and across phases', () => {
    subtitleOcrStore.addItems([source('a')]);
    subtitleOcrStore.setProgress('a', {
      phase: 'ocr',
      current: 50,
      total: 100,
      percentage: 50,
    });
    subtitleOcrStore.setProgress('a', {
      phase: 'ocr',
      current: 10,
      total: 100,
      percentage: 10,
    });
    subtitleOcrStore.setProgress('a', {
      phase: 'decoding',
      current: 1,
      total: 1,
      percentage: 100,
    });

    expect(subtitleOcrStore.selectedItem?.progress).toMatchObject({
      phase: 'ocr',
      current: 50,
      percentage: 50,
      overallPercentage: 58,
    });
  });

  it('removes items and moves selection to the next available item', () => {
    subtitleOcrStore.addItems([source('a'), source('b'), source('c')]);
    subtitleOcrStore.selectItem('b');

    subtitleOcrStore.removeItem('b');

    expect(subtitleOcrStore.items.map((item) => item.id)).toEqual(['a', 'c']);
    expect(subtitleOcrStore.selectedItem?.id).toBe('c');

    subtitleOcrStore.removeItem('c');
    subtitleOcrStore.removeItem('a');

    expect(subtitleOcrStore.items).toEqual([]);
    expect(subtitleOcrStore.selectedItemId).toBeNull();
  });

  it('clears all items and selection', () => {
    subtitleOcrStore.addItems([source('a'), source('b')]);
    subtitleOcrStore.selectItem('b');

    subtitleOcrStore.clearItems();

    expect(subtitleOcrStore.items).toEqual([]);
    expect(subtitleOcrStore.selectedItemId).toBeNull();
  });

  it('writes Subtitle OCR logs to the global log store with item context', () => {
    subtitleOcrStore.addItems([source('a')]);

    subtitleOcrStore.addLog('success', 'Generated 2 cues', 'a');

    expect(subtitleOcrStore.logs).toMatchObject([
      {
        level: 'success',
        message: '[a.sup] Generated 2 cues',
      },
    ]);
    expect(logStore.logs[0]).toMatchObject({
      level: 'success',
      source: 'subtitle-ocr',
      title: 'Generated 2 cues',
      details: '[a.sup] Generated 2 cues',
      context: { filePath: '/subs/a.sup' },
    });
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
      processingDraft: undefined,
    } as unknown as Parameters<typeof subtitleOcrStore.updateItem>[1];

    subtitleOcrStore.updateItem('a', unsafeUpdates);

    expect(subtitleOcrStore.selectedItem).toMatchObject({
      id: 'a',
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/a.sup',
      activeVersionId: 'v1',
    });
    expect(subtitleOcrStore.getActiveVersion('a')?.id).toBe('v1');
  });
});
