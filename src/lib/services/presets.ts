/**
 * Preset storage service for saving and loading user-defined rule presets
 */

import { Store } from '@tauri-apps/plugin-store';
import type { RulePreset, RenameRule } from '$lib/types/rename';
import { BUILT_IN_PRESETS } from '$lib/types/rename';

const PRESETS_STORE_KEY = 'userPresets';

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('rename-presets.json');
  }
  return store;
}

/**
 * Generate a unique ID for user presets
 */
function generatePresetId(): string {
  return `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Load all user-defined presets from storage
 */
export async function loadUserPresets(): Promise<RulePreset[]> {
  try {
    const s = await getStore();
    const presets = await s.get<RulePreset[]>(PRESETS_STORE_KEY);
    return presets ?? [];
  } catch (error) {
    console.error('Failed to load user presets:', error);
    return [];
  }
}

/**
 * Save all user-defined presets to storage
 */
async function saveUserPresets(presets: RulePreset[]): Promise<void> {
  try {
    const s = await getStore();
    await s.set(PRESETS_STORE_KEY, presets);
    await s.save();
  } catch (error) {
    console.error('Failed to save user presets:', error);
    throw new Error('Failed to save presets');
  }
}

/**
 * Get all presets (built-in + user-defined)
 */
export async function getAllPresets(): Promise<RulePreset[]> {
  const userPresets = await loadUserPresets();
  return [...BUILT_IN_PRESETS, ...userPresets];
}

/**
 * Save current rules as a new preset
 */
export async function savePreset(
  name: string,
  description: string,
  rules: RenameRule[]
): Promise<RulePreset> {
  const userPresets = await loadUserPresets();

  const newPreset: RulePreset = {
    id: generatePresetId(),
    name,
    description,
    isBuiltIn: false,
    rules: rules.map(({ type, enabled, config }) => ({ type, enabled, config })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  userPresets.push(newPreset);
  await saveUserPresets(userPresets);

  return newPreset;
}

/**
 * Update an existing user preset
 */
export async function updatePreset(
  id: string,
  updates: Partial<Pick<RulePreset, 'name' | 'description' | 'rules'>>
): Promise<RulePreset | null> {
  const userPresets = await loadUserPresets();
  const index = userPresets.findIndex(p => p.id === id);

  if (index === -1) {
    console.error('Preset not found:', id);
    return null;
  }

  const preset = userPresets[index];
  if (preset.isBuiltIn) {
    console.error('Cannot update built-in preset');
    return null;
  }

  const updatedPreset: RulePreset = {
    ...preset,
    ...updates,
    rules: updates.rules
      ? updates.rules.map(({ type, enabled, config }) => ({ type, enabled, config }))
      : preset.rules,
    updatedAt: Date.now(),
  };

  userPresets[index] = updatedPreset;
  await saveUserPresets(userPresets);

  return updatedPreset;
}

/**
 * Delete a user preset
 */
export async function deletePreset(id: string): Promise<boolean> {
  const userPresets = await loadUserPresets();
  const preset = userPresets.find(p => p.id === id);

  if (!preset) {
    console.error('Preset not found:', id);
    return false;
  }

  if (preset.isBuiltIn) {
    console.error('Cannot delete built-in preset');
    return false;
  }

  const filteredPresets = userPresets.filter(p => p.id !== id);
  await saveUserPresets(filteredPresets);

  return true;
}

/**
 * Check if a preset name already exists
 */
export async function isPresetNameTaken(name: string, excludeId?: string): Promise<boolean> {
  const allPresets = await getAllPresets();
  return allPresets.some(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== excludeId);
}

/**
 * Duplicate a preset (creates a user copy)
 */
export async function duplicatePreset(id: string): Promise<RulePreset | null> {
  const allPresets = await getAllPresets();
  const preset = allPresets.find(p => p.id === id);

  if (!preset) {
    console.error('Preset not found:', id);
    return null;
  }

  // Find a unique name
  let baseName = preset.name;
  let copyNum = 1;
  let newName = `${baseName} (Copy)`;

  while (await isPresetNameTaken(newName)) {
    copyNum++;
    newName = `${baseName} (Copy ${copyNum})`;
  }

  return savePreset(newName, preset.description, preset.rules as RenameRule[]);
}
