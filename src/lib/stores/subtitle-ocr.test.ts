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

  it('cancels one processing item without marking the whole batch as cancelling', () => {
    subtitleOcrStore.addItems([source('a'), source('b')]);
    subtitleOcrStore.startProcessing(['a', 'b']);
    subtitleOcrStore.setItemStatus('a', 'ocr_processing');

    subtitleOcrStore.cancelProcessing('a');

    expect(subtitleOcrStore.isItemCancelled('a')).toBe(true);
    expect(subtitleOcrStore.isCancelling).toBe(false);
    expect([...subtitleOcrStore.processingScopeItemIds]).toEqual(['b']);
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
