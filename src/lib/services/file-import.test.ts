import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openMock, invokeMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openMock }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
  expandImportRoots,
  pickImportFiles,
  pickImportFolders,
} from './file-import';
import {
  MERGE_TRACK_IMPORT_POLICY,
  PRIMARY_IMPORT_POLICY,
  RENAME_IMPORT_POLICY,
} from '$lib/types/import-policy';

describe('file import service', () => {
  beforeEach(() => {
    openMock.mockReset();
    invokeMock.mockReset();
  });

  it('normalizes a cancelled file dialog to an empty list', async () => {
    openMock.mockResolvedValue(null);

    await expect(pickImportFiles(PRIMARY_IMPORT_POLICY)).resolves.toEqual([]);
    expect(openMock).toHaveBeenCalledWith({
      multiple: true,
      title: 'Select media files',
      filters: [{
        name: 'Media files',
        extensions: ['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v', 'mks', 'mka'],
      }],
    });
  });

  it('normalizes both single and multi selections', async () => {
    openMock.mockResolvedValueOnce('/media/one.mkv').mockResolvedValueOnce(['/media/a.mkv', '/media/b.mkv']);

    await expect(pickImportFiles(PRIMARY_IMPORT_POLICY)).resolves.toEqual(['/media/one.mkv']);
    await expect(pickImportFiles(PRIMARY_IMPORT_POLICY)).resolves.toEqual(['/media/a.mkv', '/media/b.mkv']);
  });

  it('uses recursive multi-folder dialog options and policy title', async () => {
    openMock.mockResolvedValue(['/media']);

    await expect(pickImportFolders(MERGE_TRACK_IMPORT_POLICY)).resolves.toEqual(['/media']);
    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: true,
      recursive: true,
      title: 'Select track files',
    });
  });

  it('omits file filters for all-files policies', async () => {
    openMock.mockResolvedValue(null);

    await pickImportFiles(RENAME_IMPORT_POLICY);
    expect(openMock).toHaveBeenCalledWith({ multiple: true, title: 'Select files to rename' });
  });

  it('invokes expansion with policy payload and preserves the typed response', async () => {
    const response = { files: [], warnings: [] };
    invokeMock.mockResolvedValue(response);

    await expect(expandImportRoots(['/media'], MERGE_TRACK_IMPORT_POLICY)).resolves.toBe(response);
    expect(invokeMock).toHaveBeenCalledWith('expand_import_roots', {
      roots: ['/media'],
      extensions: ['.ass', '.ssa', '.srt', '.sub', '.idx', '.vtt', '.sup', '.aac', '.ac3', '.dts', '.flac', '.mp3', '.ogg', '.wav', '.eac3', '.opus'],
      excludeMediaflowSidecars: false,
    });
  });

  it('sends null extensions for all-files policies', async () => {
    invokeMock.mockResolvedValue({ files: [], warnings: [] });

    await expandImportRoots(['/media'], RENAME_IMPORT_POLICY);
    expect(invokeMock).toHaveBeenCalledWith('expand_import_roots', {
      roots: ['/media'],
      extensions: null,
      excludeMediaflowSidecars: true,
    });
  });
});
