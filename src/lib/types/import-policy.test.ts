import { describe, expect, it } from 'vitest';

import {
  getImportPolicy,
  getToolImportPolicy,
  IMPORT_POLICIES,
  isImportPathAllowed,
  policyDialogFilter,
} from './import-policy';

describe('import policies', () => {
  it('keeps canonical media and merge-track support lists', () => {
    expect(getImportPolicy('primary').extensions).toEqual([
      '.mkv', '.mp4', '.avi', '.mov', '.webm', '.m4v', '.mks', '.mka',
    ]);
    expect(getImportPolicy('merge-track').extensions).toContain('.sup');
    expect(getImportPolicy('merge-track').extensions).not.toContain('.m2ts');
    expect(getImportPolicy('merge-track').extensions).not.toContain('.vob');
  });

  it('uses all-files and sidecar exclusion for Rename', () => {
    const policy = getToolImportPolicy('rename');
    expect(policy.extensions).toBeNull();
    expect(isImportPathAllowed('/media/clip.txt', policy)).toBe(true);
    expect(isImportPathAllowed('/media/clip.MEDIAFLOW.JSON', policy)).toBe(false);
    expect(IMPORT_POLICIES.rename).toBe(policy);
  });

  it('normalizes policy extensions for native dialog filters', () => {
    expect(policyDialogFilter(getImportPolicy('primary'))).toEqual({
      name: 'Media files',
      extensions: ['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v', 'mks', 'mka'],
    });
    expect(policyDialogFilter(getToolImportPolicy('rename'))).toBeUndefined();
  });

  it('maps Merge primary imports to video intent', () => {
    expect(getToolImportPolicy('merge').intent).toBe('merge-video');
  });

  it('keeps Merge video and track intents separate', () => {
    const videoPolicy = getToolImportPolicy('merge', 'merge-video');
    const trackPolicy = getToolImportPolicy('merge', 'merge-track');
    expect(isImportPathAllowed('/media/movie.mkv', videoPolicy)).toBe(true);
    expect(isImportPathAllowed('/media/movie.mkv', trackPolicy)).toBe(false);
    expect(isImportPathAllowed('/media/subtitle.sup', trackPolicy)).toBe(true);
    expect(isImportPathAllowed('/media/subtitle.sup', videoPolicy)).toBe(false);
  });

  it('keeps m2ts available for Subtitle OCR dialog, folder, and drop imports', () => {
    const policy = getToolImportPolicy('subtitle-ocr');
    expect(policyDialogFilter(policy)?.extensions).toContain('m2ts');
    expect(isImportPathAllowed('/media/disc.m2ts', policy)).toBe(true);
    expect(isImportPathAllowed('/media/disc.vob', policy)).toBe(false);
    expect(policy.extensions).not.toContain('.vob');
  });
});
