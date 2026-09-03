import { describe, expect, it } from 'vitest';

import { createRenameWorkspaceStore } from '$lib/stores/rename-workspace.svelte';
import { buildNewPath } from '$lib/services/rename';
import type { RenameFile } from '$lib/types/rename';

function file(id: string, name: string, groupKey = '/media/show'): RenameFile {
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
});
