import { describe, expect, it } from 'vitest';

import { applyAllRules } from '$lib/services/rename';
import {
  assignSeriesSeasonsSequentially,
  planSeriesNumbering,
} from '$lib/services/series-numbering';
import type { RenameFile, RenameRule, SortConfig } from '$lib/types/rename';
import { sourceGroupForDirectFile, type SourceGroup } from '$lib/types/source-group';

const sortConfig: SortConfig = { field: 'name', direction: 'asc' };

function file(
  id: string,
  name: string,
  groupKey = '/media/show',
  seasonNumber?: number,
): RenameFile {
  return {
    id,
    originalPath: `/media/${name}.mkv`,
    originalName: name,
    extension: '.mkv',
    newName: name,
    selected: true,
    status: 'pending',
    sourceGroup: {
      groupKey,
      selectedRoot: groupKey,
      selectedRootKind: 'folder',
      relativePath: `${name}.mkv`,
    },
    seasonNumber,
  };
}

function seriesRule(enabled = true): RenameRule {
  return {
    id: 'series',
    type: 'series-number',
    enabled,
    config: {
      position: 'suffix',
      start: 1,
      step: 1,
      padding: 2,
      separator: '_',
    },
  };
}

function directFileWithSourceGroup(
  id: string,
  path: string,
  sourceGroup: SourceGroup,
): RenameFile {
  const name = path.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, '') ?? path;
  return {
    ...file(id, name),
    originalPath: path,
    originalName: name,
    sourceGroup,
  };
}

describe('series numbering', () => {
  it('defaults to OriginalName_S01E01 with a two-digit season', () => {
    expect(applyAllRules('OriginalName', [seriesRule()], {
      globalIndex: 0,
      seriesIndex: 0,
      seasonNumber: 1,
    })).toBe('OriginalName_S01E01');
  });

  it('uses group-local indexes and preserves global Number indexes', () => {
    const first = file('a', 'Episode 2', '/media/a', 1);
    const second = file('b', 'Episode 10', '/media/a', 1);
    const third = file('c', 'Episode 1', '/media/b', 2);
    const plan = planSeriesNumbering([first, second, third], sortConfig);
    const rules: RenameRule[] = [
      {
        id: 'number',
        type: 'number',
        enabled: true,
        config: { position: 'prefix', start: 1, step: 1, padding: 2, separator: '_' },
      },
      seriesRule(),
    ];

    expect(plan.contextsByFileId.get('c')).toEqual({ globalIndex: 0, seriesIndex: 0, seasonNumber: 2 });
    expect(plan.contextsByFileId.get('a')).toEqual({ globalIndex: 1, seriesIndex: 0, seasonNumber: 1 });
    expect(plan.contextsByFileId.get('b')).toEqual({ globalIndex: 2, seriesIndex: 1, seasonNumber: 1 });
    expect(applyAllRules('Episode 2', rules, plan.contextsByFileId.get('a')!)).toBe('02_Episode 2_S01E01');
    expect(applyAllRules('Episode 10', rules, plan.contextsByFileId.get('b')!)).toBe('03_Episode 10_S01E02');
  });

  it('resolves explicit assignments over conflicting evidence', () => {
    const files = [file('a', 'Show S01E01', '/media/show', 1), file('b', 'Show S02E02', '/media/show', 2)];
    const conflict = planSeriesNumbering(files, sortConfig);
    expect(conflict.issues[0]?.status).toBe('conflict');

    const resolved = planSeriesNumbering(files, sortConfig, new Map([['/media/show', 3]]));
    expect(resolved.issues).toHaveLength(0);
    expect(resolved.resolutions[0]?.explicitSeasonNumber).toBe(3);
    expect(resolved.contextsByFileId.get('a')?.seasonNumber).toBe(3);
  });

  it('uses season-labeled folder evidence and reports unresolved groups', () => {
    const folderFile = file('a', 'Show 01', '/media/show/Season 4');
    const unresolvedFile = file('b', 'Bonus clip', '/media/other');
    const plan = planSeriesNumbering([folderFile, unresolvedFile], sortConfig);

    expect(plan.resolutions.find((item) => item.groupKey === '/media/show/Season 4')?.seasonNumber).toBe(4);
    expect(plan.resolutions.find((item) => item.groupKey === '/media/other')?.status).toBe('unresolved');
  });

  it('keeps folder-root evidence scoped to the selected folder', () => {
    const folderFile = {
      ...file('folder', 'Episode 01', '/Season 2 canonical'),
      sourceGroup: {
        groupKey: '/Season 2 canonical',
        selectedRoot: '/media/show',
        selectedRootKind: 'folder' as const,
        relativePath: 'Episode 01.mkv',
      },
    };
    const plan = planSeriesNumbering([folderFile], sortConfig);

    expect(plan.resolutions[0]?.status).toBe('unresolved');
  });

  it('ignores season labels in ancestors of the selected folder', () => {
    const selectedRoot = '/media/Season 1 archive/Amagami SS S02 1080p BDRip';
    const seasonTwoFile = {
      ...file('season-two', 'S02E01-Temptation', selectedRoot, 2),
      sourceGroup: {
        groupKey: selectedRoot,
        selectedRoot,
        selectedRootKind: 'folder' as const,
        relativePath: 'S02E01-Temptation.mkv',
      },
    };

    const plan = planSeriesNumbering([seasonTwoFile], sortConfig);

    expect(plan.resolutions[0]).toMatchObject({
      status: 'resolved',
      seasonNumber: 2,
      candidates: [2],
    });
    expect(plan.issues).toHaveLength(0);
  });

  it('assigns groups by stable normalized group key', () => {
    const files = [
      file('b', 'B', 'C:\\Media\\Season-B'),
      file('a', 'A', 'c:/media/season-a'),
    ];
    expect([...assignSeriesSeasonsSequentially(files)]).toEqual([
      ['c:/media/season-a', 1],
      ['c:/media/season-b', 2],
    ]);
  });

  it('supports legacy direct-file grouping by parent directory', () => {
    const first = { ...file('a', 'one'), sourceGroup: undefined, originalPath: '/media/direct/one.mkv' };
    const second = { ...file('b', 'two'), sourceGroup: undefined, originalPath: '/media/direct/two.mkv' };
    const plan = planSeriesNumbering([first, second], sortConfig, new Map([
      [sourceGroupForDirectFile('/media/direct/one.mkv').groupKey, 5],
    ]));
    expect(plan.resolutions).toHaveLength(1);
    expect(plan.contextsByFileId.get('b')?.seriesIndex).toBe(1);
  });

  it('uses the parent of a directly selected file for season evidence', () => {
    const path = '/Season 2/Episode 01.mkv';
    const sourceGroup: SourceGroup = {
      groupKey: '/Season 2',
      selectedRoot: path,
      selectedRootKind: 'file',
      relativePath: '',
    };
    const plan = planSeriesNumbering([
      directFileWithSourceGroup('direct', path, sourceGroup),
    ], sortConfig);

    expect(plan.resolutions[0]).toMatchObject({
      groupKey: '/Season 2',
      status: 'resolved',
      seasonNumber: 2,
    });
    expect(plan.issues).toHaveLength(0);
  });

  it('uses Windows-style direct-file parent evidence', () => {
    const path = 'C:\\Media\\Season 3\\Episode 01.mkv';
    const plan = planSeriesNumbering([
      directFileWithSourceGroup('windows', path, {
        groupKey: 'C:\\Media\\Season 3',
        selectedRoot: path,
        selectedRootKind: 'file',
        relativePath: '',
      }),
    ], sortConfig);

    expect(plan.resolutions[0]?.seasonNumber).toBe(3);
    expect(plan.issues).toHaveLength(0);
  });

  it('uses UNC-like and Unicode direct-file parent evidence', () => {
    const uncPath = '\\\\SERVER\\Share\\Season 4\\Episode 01.mkv';
    const unicodePath = '/Médias/Émission Name/Season 5 - 再生/Episode 01.mkv';
    const plan = planSeriesNumbering([
      directFileWithSourceGroup('unc', uncPath, {
        groupKey: '\\\\SERVER\\Share\\Season 4',
        selectedRoot: uncPath,
        selectedRootKind: 'file',
        relativePath: '',
      }),
      directFileWithSourceGroup('unicode', unicodePath, {
        groupKey: '/Médias/Émission Name/Season 5 - 再生',
        selectedRoot: unicodePath,
        selectedRootKind: 'file',
        relativePath: '',
      }),
    ], sortConfig);

    expect(plan.resolutions.find((resolution) => resolution.seasonNumber === 4)?.status).toBe('resolved');
    expect(plan.resolutions.find((resolution) => resolution.seasonNumber === 5)?.status).toBe('resolved');
    expect(plan.issues).toHaveLength(0);
  });

  it('keeps a disabled series rule inert', () => {
    const rule = seriesRule(false);
    expect(applyAllRules('Episode', [rule], {
      globalIndex: 4,
      seriesIndex: 0,
      seasonNumber: 2,
    })).toBe('Episode');
  });
});
