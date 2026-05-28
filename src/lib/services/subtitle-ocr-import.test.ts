import { describe, expect, it, vi } from 'vitest';

import {
  buildStandaloneSubtitleOcrItems,
  getSubtitleOcrImportKind,
  resolveVobSubPairCandidates,
} from './subtitle-ocr-import';

describe('subtitle OCR import helpers', () => {
  it('detects standalone PGS and VobSub extensions', () => {
    expect(getSubtitleOcrImportKind('/subs/French.sup')).toBe('standalone_sup');
    expect(getSubtitleOcrImportKind('/subs/French.idx')).toBe('standalone_vobsub_part');
    expect(getSubtitleOcrImportKind('/subs/French.sub')).toBe('standalone_vobsub_part');
    expect(getSubtitleOcrImportKind('/subs/French.srt')).toBe('unsupported');
  });

  it('treats extension-like filenames without dots as unsupported', () => {
    expect(getSubtitleOcrImportKind('/subs/sup')).toBe('unsupported');
    expect(getSubtitleOcrImportKind('/subs/idx')).toBe('unsupported');
    expect(getSubtitleOcrImportKind('/subs/sub')).toBe('unsupported');
    expect(getSubtitleOcrImportKind('sup')).toBe('unsupported');
    expect(getSubtitleOcrImportKind('idx')).toBe('unsupported');
    expect(getSubtitleOcrImportKind('sub')).toBe('unsupported');
  });

  it('detects supported container extensions', () => {
    const extensions = ['mkv', 'm2ts', 'vob', 'mp4', 'avi', 'mov', 'webm', 'm4v', 'mks'];

    for (const extension of extensions) {
      expect(getSubtitleOcrImportKind(`/media/Movie.${extension}`)).toBe('container');
    }
  });

  it('deduplicates idx and sub into one VobSub pair candidate', () => {
    const pairs = resolveVobSubPairCandidates([
      '/subs/French.idx',
      '/subs/French.sub',
      '/subs/French.idx',
    ]);

    expect(pairs).toEqual([
      {
        basePath: '/subs/French',
        idxPath: '/subs/French.idx',
        subPath: '/subs/French.sub',
        complete: true,
      },
    ]);
  });

  it('resolves missing pair files through the supplied exists callback', async () => {
    const exists = vi.fn(async (path: string) => path === '/subs/French.sub');

    const items = await buildStandaloneSubtitleOcrItems(['/subs/French.idx'], exists);

    expect(items.warnings).toEqual([]);
    expect(exists).toHaveBeenCalledWith('/subs/French.sub');
    expect(items.items).toHaveLength(1);
    expect(items.items[0]?.sourceKind).toBe('standalone_vobsub');
    expect(items.items[0]?.pair).toEqual({
      idxPath: '/subs/French.idx',
      subPath: '/subs/French.sub',
    });
  });

  it('resolves missing idx files through the supplied exists callback', async () => {
    const exists = vi.fn(async (path: string) => path === '/subs/French.idx');

    const items = await buildStandaloneSubtitleOcrItems(['/subs/French.sub'], exists);

    expect(items.warnings).toEqual([]);
    expect(exists).toHaveBeenCalledWith('/subs/French.idx');
    expect(items.items).toHaveLength(1);
    expect(items.items[0]?.sourceKind).toBe('standalone_vobsub');
    expect(items.items[0]?.pair).toEqual({
      idxPath: '/subs/French.idx',
      subPath: '/subs/French.sub',
    });
  });

  it('warns and skips incomplete VobSub pairs', async () => {
    const exists = vi.fn(async () => false);

    const items = await buildStandaloneSubtitleOcrItems(['/subs/French.sub'], exists);

    expect(items.items).toEqual([]);
    expect(items.warnings).toEqual([
      'Missing VobSub pair for French.sub. Expected /subs/French.idx.',
    ]);
  });

  it('creates a standalone PGS item', async () => {
    const items = await buildStandaloneSubtitleOcrItems(['/subs/French.sup'], async () => false);

    expect(items.warnings).toEqual([]);
    expect(items.items[0]).toMatchObject({
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/French.sup',
      displayName: 'French.sup',
      ocrModelOverride: 'default',
      status: 'ready',
    });
  });

  it('deduplicates duplicate standalone PGS imports', async () => {
    const items = await buildStandaloneSubtitleOcrItems(
      ['/subs/French.sup', '/subs/French.sup'],
      async () => false,
    );

    expect(items.warnings).toEqual([]);
    expect(items.items).toHaveLength(1);
    expect(items.items[0]).toMatchObject({
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/French.sup',
      displayName: 'French.sup',
    });
  });
});
