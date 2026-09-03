import { describe, expect, it } from 'vitest';

import {
  getImportPathParent,
  normalizePathForIdentity,
  sameSourceGroup,
  sourceGroupForDirectFile,
  sourceGroupForDirectFileParent,
} from './source-group';

describe('source group helpers', () => {
  it('normalizes Windows drive and UNC identity paths', () => {
    expect(normalizePathForIdentity('C:\\Media\\..\\Movies\\Film.mkv')).toBe('c:/movies/film.mkv');
    expect(normalizePathForIdentity('\\\\SERVER\\Share\\Film.mkv')).toBe('//server/share/film.mkv');
  });

  it('uses component-aware parent paths', () => {
    expect(getImportPathParent('/media/foo/bar.mkv')).toBe('/media/foo');
    expect(getImportPathParent('C:\\media\\bar.mkv')).toBe('C:/media');
    expect(getImportPathParent('bar.mkv')).toBe('.');
  });

  it('groups direct files by their parent while retaining selected root details', () => {
    const group = sourceGroupForDirectFile('/media/one.mkv');
    expect(group).toEqual({
      groupKey: '/media',
      selectedRoot: '/media/one.mkv',
      selectedRootKind: 'file',
      relativePath: 'one.mkv',
    });
  });

  it('provides a folder-shaped parent fallback for direct files', () => {
    expect(sourceGroupForDirectFileParent('/media/one.mkv')).toEqual({
      groupKey: '/media',
      selectedRoot: '/media',
      selectedRootKind: 'folder',
      relativePath: 'one.mkv',
    });
  });

  it('compares groups by canonical group identity', () => {
    expect(
      sameSourceGroup(
        sourceGroupForDirectFile('C:\\Media\\one.mkv'),
        sourceGroupForDirectFile('c:/media/two.mkv'),
      ),
    ).toBe(true);
    expect(sameSourceGroup(null, sourceGroupForDirectFile('/media/one.mkv'))).toBe(false);
  });
});
