import { describe, expect, it, vi } from 'vitest';

import {
  buildStandaloneSubtitleOcrItems,
  getSubtitleOcrImportKind,
  resolveVobSubPairCandidates,
} from './subtitle-ocr-import';

describe('subtitle OCR import helpers', () => {
  const unusedResolver = async () => ({
    idxPath: '/unused.idx',
    subPath: '/unused.sub',
  });

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

  it('resolves missing pair files through the supplied backend resolver', async () => {
    const resolveVobSubPair = vi.fn(async (path: string) => {
      expect(path).toBe('/subs/French.idx');
      return {
        idxPath: '/subs/French.idx',
        subPath: '/subs/French.sub',
      };
    });

    const items = await buildStandaloneSubtitleOcrItems(['/subs/French.idx'], resolveVobSubPair);

    expect(items.warnings).toEqual([]);
    expect(resolveVobSubPair).toHaveBeenCalledWith('/subs/French.idx');
    expect(resolveVobSubPair).toHaveBeenCalledTimes(1);
    expect(items.items).toHaveLength(1);
    expect(items.items[0]?.sourceKind).toBe('standalone_vobsub');
    expect(items.items[0]?.pair).toEqual({
      idxPath: '/subs/French.idx',
      subPath: '/subs/French.sub',
    });
  });

  it('resolves missing idx files through the supplied backend resolver', async () => {
    const resolveVobSubPair = vi.fn(async (path: string) => {
      expect(path).toBe('/subs/French.sub');
      return {
        idxPath: '/subs/French.idx',
        subPath: '/subs/French.sub',
      };
    });

    const items = await buildStandaloneSubtitleOcrItems(['/subs/French.sub'], resolveVobSubPair);

    expect(items.warnings).toEqual([]);
    expect(resolveVobSubPair).toHaveBeenCalledWith('/subs/French.sub');
    expect(resolveVobSubPair).toHaveBeenCalledTimes(1);
    expect(items.items).toHaveLength(1);
    expect(items.items[0]?.sourceKind).toBe('standalone_vobsub');
    expect(items.items[0]?.pair).toEqual({
      idxPath: '/subs/French.idx',
      subPath: '/subs/French.sub',
    });
  });

  it('warns and skips incomplete VobSub pairs', async () => {
    const resolveVobSubPair = vi.fn(async () => {
      throw new Error('VobSub .idx sidecar not found: /subs/French.idx');
    });

    const items = await buildStandaloneSubtitleOcrItems(['/subs/French.sub'], resolveVobSubPair);

    expect(items.items).toEqual([]);
    expect(items.warnings).toEqual([
      'Missing VobSub pair for French.sub. VobSub .idx sidecar not found: /subs/French.idx',
    ]);
  });

  it('creates a standalone PGS item', async () => {
    const items = await buildStandaloneSubtitleOcrItems(['/subs/French.sup'], unusedResolver);

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
      unusedResolver,
    );

    expect(items.warnings).toEqual([]);
    expect(items.items).toHaveLength(1);
    expect(items.items[0]).toMatchObject({
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/French.sup',
      displayName: 'French.sup',
    });
  });

  it('creates distinct IDs for standalone PGS paths that collided under the old hash', async () => {
    const items = await buildStandaloneSubtitleOcrItems(
      ['/subs/Aa.sup', '/subs/BB.sup'],
      unusedResolver,
    );

    expect(items.warnings).toEqual([]);
    expect(items.items).toHaveLength(2);
    expect(new Set(items.items.map((item) => item.id)).size).toBe(2);
  });
});
