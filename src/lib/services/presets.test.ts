import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RenameRule } from '$lib/types/rename';

const storeMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn(async () => storeMock),
  },
}));

import { savePreset } from './presets';

describe('rename preset serialization', () => {
  beforeEach(() => {
    storeMock.get.mockResolvedValue([]);
    storeMock.set.mockReset();
    storeMock.save.mockReset();
  });

  it('persists only the rule contract, never workspace provenance or assignments', async () => {
    const rule = {
      id: 'series-rule',
      type: 'series-number',
      enabled: true,
      config: {
        position: 'suffix',
        start: 1,
        step: 1,
        padding: 2,
        separator: '_',
      },
      sourceGroup: {
        groupKey: '/Volumes/Media/Season 2',
        selectedRoot: '/Volumes/Media/Season 2/Episode 01.mkv',
        selectedRootKind: 'file',
        relativePath: '',
      },
      assignments: { '/Volumes/Media/Season 2': 2 },
    } as unknown as RenameRule;

    await savePreset('Series naming', 'Series numbering', [rule]);

    const savedPresets = storeMock.set.mock.calls[0]?.[1] as Array<{ rules: unknown[] }>;
    expect(savedPresets[0]?.rules).toEqual([{
      type: 'series-number',
      enabled: true,
      config: {
        position: 'suffix',
        start: 1,
        step: 1,
        padding: 2,
        separator: '_',
      },
    }]);
    expect(JSON.stringify(savedPresets)).not.toContain('SourceGroup');
    expect(JSON.stringify(savedPresets)).not.toContain('assignments');
    expect(JSON.stringify(savedPresets)).not.toContain('/Volumes/Media');
  });
});
