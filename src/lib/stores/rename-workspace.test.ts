import { describe, expect, it } from 'vitest';

import { createRenameWorkspaceStore } from '$lib/stores/rename-workspace.svelte';
import { buildNewPath } from '$lib/services/rename';
import type { RenameFile } from '$lib/types/rename';

function file(id: string, name: string, groupKey = '/media/show', seasonNumber?: number): RenameFile {
  return {
    id,
    originalPath: `${groupKey}/${name}.mkv`,
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

describe('rename workspace series numbering', () => {
  it('blocks unresolved series numbering and clears the blocker on override', () => {
    const workspace = createRenameWorkspaceStore();
    workspace.addFiles([file('a', 'Episode 1')]);
    workspace.addRule('series-number');
    workspace.recalculateImmediate();

    expect(workspace.hasSeriesNumberingIssues).toBe(true);
    expect(workspace.hasBlockingIssues).toBe(true);
    expect(workspace.seriesIssues[0]?.status).toBe('unresolved');

    workspace.setSeasonAssignment('/media/show', 3);
    workspace.recalculateImmediate();

    expect(workspace.hasSeriesNumberingIssues).toBe(false);
    expect(workspace.hasBlockingIssues).toBe(false);
    expect(workspace.files[0]?.newName).toBe('Episode 1_S03E01');

    // Test Season 0 assignment for specials
    workspace.setSeasonAssignment('/media/show', 0);
    workspace.recalculateImmediate();
    expect(workspace.hasSeriesNumberingIssues).toBe(false);
    expect(workspace.hasBlockingIssues).toBe(false);
    expect(workspace.files[0]?.newName).toBe('Episode 1_S00E01');

    // Negative values should be ignored
    workspace.setSeasonAssignment('/media/show', -1);
    workspace.recalculateImmediate();
    expect(workspace.files[0]?.newName).toBe('Episode 1_S00E01');

    workspace.destroy();
  });

  it('keeps ordinary Number global while Series Numbering resets per group', () => {
    const workspace = createRenameWorkspaceStore();
    workspace.addFiles([
      file('a', 'A', '/media/one'),
      file('b', 'B', '/media/one'),
      file('c', 'C', '/media/two'),
    ]);
    workspace.addRule('number');
    workspace.addRule('series-number');
    workspace.setSeasonAssignment('/media/one', 1);
    workspace.setSeasonAssignment('/media/two', 2);
    workspace.recalculateImmediate();

    expect(workspace.files.map((item) => item.newName)).toEqual([
      'A_01_S01E01',
      'B_02_S01E02',
      'C_03_S02E01',
    ]);
    workspace.destroy();
  });

  it('prunes assignments after the corresponding group disappears', () => {
    const workspace = createRenameWorkspaceStore();
    workspace.addFiles([file('a', 'A')]);
    workspace.setSeasonAssignment('/media/show', 4);
    workspace.removeFile('a');
    workspace.addFiles([file('b', 'B')]);
    workspace.addRule('series-number');
    workspace.recalculateImmediate();

    expect(workspace.hasBlockingIssues).toBe(true);
    workspace.destroy();
  });

  it('uses the preview basename for the final rename target', () => {
    const workspace = createRenameWorkspaceStore();
    workspace.addFiles([file('a', 'Episode 01')]);
    workspace.addRule('series-number');
    workspace.setSeasonAssignment('/media/show', 2);
    workspace.recalculateImmediate();

    const renamedFile = workspace.files[0];
    expect(renamedFile?.newName).toBe('Episode 01_S02E01');
    expect(renamedFile && buildNewPath(renamedFile)).toBe('/media/show/Episode 01_S02E01.mkv');
    workspace.destroy();
  });

  it('preserves season assignment when files in a group are deselected', () => {
    const workspace = createRenameWorkspaceStore();
    workspace.addFiles([file('a', 'A', '/media/show'), file('b', 'B', '/media/other')]);
    workspace.addRule('series-number');
    workspace.setSeasonAssignment('/media/show', 4);
    workspace.setSeasonAssignment('/media/other', 2);
    workspace.recalculateImmediate();

    expect(workspace.seasonAssignments.get('/media/show')).toBe(4);

    // Deselect file 'a'
    workspace.toggleFileSelection('a');
    workspace.recalculateImmediate();

    // The assignment for /media/show should still be preserved because file 'a' is still in the workspace
    expect(workspace.seasonAssignments.get('/media/show')).toBe(4);

    // Re-select file 'a'
    workspace.toggleFileSelection('a');
    workspace.recalculateImmediate();
    expect(workspace.seasonAssignments.get('/media/show')).toBe(4);
    expect(workspace.files.find((f) => f.id === 'a')?.newName).toBe('A_S04E01');

    workspace.destroy();
  });

  it('reflects hasEnabledSeriesRule correctly', () => {
    const workspace = createRenameWorkspaceStore();
    expect(workspace.hasEnabledSeriesRule).toBe(false);

    workspace.addRule('number');
    expect(workspace.hasEnabledSeriesRule).toBe(false);

    workspace.addRule('series-number');
    expect(workspace.hasEnabledSeriesRule).toBe(true);

    // Disable the rule
    const seriesRuleId = workspace.rules.find((r) => r.type === 'series-number')?.id;
    if (seriesRuleId) {
      workspace.toggleRule(seriesRuleId);
      expect(workspace.hasEnabledSeriesRule).toBe(false);
    }

    workspace.destroy();
  });

  it('scopes series issues and blocking checks to specified subsets of files', () => {
    const workspace = createRenameWorkspaceStore();
    const fileA = file('a', 'Show S01E01', '/media/conflict', 1);
    const fileB = file('b', 'Show S02E01', '/media/conflict', 2);
    const fileC = file('c', 'Episode 1', '/media/clean');

    workspace.addFiles([fileA, fileB, fileC]);
    workspace.addRule('series-number');
    workspace.setSeasonAssignment('/media/clean', 1);
    workspace.recalculateImmediate();

    // The whole workspace has issues due to conflict in /media/conflict
    expect(workspace.hasSeriesNumberingIssues).toBe(true);
    expect(workspace.hasBlockingIssues).toBe(true);

    const cleanFiles = workspace.files.filter((f) => f.id === 'c');
    const conflictFiles = workspace.files.filter((f) => f.id === 'a' || f.id === 'b');

    expect(workspace.hasSeriesIssuesForFiles(cleanFiles)).toBe(false);
    expect(workspace.hasBlockingIssuesForFiles(cleanFiles)).toBe(false);

    expect(workspace.hasSeriesIssuesForFiles(conflictFiles)).toBe(true);
    expect(workspace.hasBlockingIssuesForFiles(conflictFiles)).toBe(true);

    workspace.destroy();
  });
});

