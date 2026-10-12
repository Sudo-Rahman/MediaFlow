import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RulePreset } from '$lib/types/rename';

const presetMocks = vi.hoisted(() => ({
  loadUserPresets: vi.fn(),
  savePreset: vi.fn(),
  updatePreset: vi.fn(),
  deletePreset: vi.fn(),
  subscribeToPresetChanges: vi.fn(() => () => {}),
}));

vi.mock('$lib/services/presets', () => presetMocks);

import { createRenameWorkspaceStore } from '$lib/stores/rename-workspace.svelte';

const userPreset: RulePreset = {
  id: 'user-series',
  name: 'Series',
  description: 'Series naming',
  isBuiltIn: false,
  rules: [{
    type: 'prefix',
    enabled: true,
    config: { text: 'Show - ' },
  }],
};

describe('rename workspace active preset', () => {
  beforeEach(() => {
    presetMocks.loadUserPresets.mockReset().mockResolvedValue([userPreset]);
    presetMocks.savePreset.mockReset();
    presetMocks.updatePreset.mockReset();
    presetMocks.deletePreset.mockReset();
    presetMocks.subscribeToPresetChanges.mockClear();
  });

  it('updates the loaded user preset with the current rules', async () => {
    presetMocks.updatePreset.mockResolvedValue(userPreset);
    const workspace = createRenameWorkspaceStore();
    await workspace.loadPresets();
    workspace.applyPreset(userPreset.id);
    workspace.addRule('suffix');

    const saved = await workspace.saveActivePreset();

    expect(saved?.id).toBe(userPreset.id);
    expect(presetMocks.updatePreset).toHaveBeenCalledWith(
      userPreset.id,
      { rules: expect.arrayContaining([expect.objectContaining({ type: 'suffix' })]) },
    );
    workspace.destroy();
  });

  it('does not overwrite a built-in preset', async () => {
    const workspace = createRenameWorkspaceStore();
    workspace.applyPreset('builtin-clean-filenames');

    expect(workspace.activePreset?.isBuiltIn).toBe(true);
    await expect(workspace.saveActivePreset()).resolves.toBeNull();
    expect(presetMocks.updatePreset).not.toHaveBeenCalled();
    workspace.destroy();
  });

  it('makes a newly saved preset active and clears it when deleted', async () => {
    const savedPreset = { ...userPreset, id: 'user-copy', name: 'Series Copy' };
    presetMocks.savePreset.mockResolvedValue(savedPreset);
    presetMocks.deletePreset.mockResolvedValue(true);
    const workspace = createRenameWorkspaceStore();
    workspace.addRule('prefix');

    await workspace.saveAsPreset(savedPreset.name, savedPreset.description);
    expect(workspace.activePreset?.id).toBe(savedPreset.id);

    await workspace.deletePreset(savedPreset.id);
    expect(workspace.activePreset).toBeNull();
    workspace.destroy();
  });
});
