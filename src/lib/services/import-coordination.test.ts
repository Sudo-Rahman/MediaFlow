import { beforeEach, describe, expect, it, vi } from 'vitest';

const { expandImportRootsMock, warningMock } = vi.hoisted(() => ({
  expandImportRootsMock: vi.fn(),
  warningMock: vi.fn(),
}));

vi.mock('./file-import', () => ({
  expandImportRoots: expandImportRootsMock,
  pickImportFiles: vi.fn(),
  pickImportFolders: vi.fn(),
}));
vi.mock('$lib/utils/log-toast', () => ({
  logAndToast: { warning: warningMock },
}));

import { expandToolImportRoots, summarizeImportWarnings } from './import-coordination';
import { getToolImportPolicy } from '$lib/types/import-policy';

describe('import warning aggregation', () => {
  beforeEach(() => {
    expandImportRootsMock.mockReset();
    warningMock.mockReset();
  });

  it('combines native warnings into one stable summary', () => {
    expect(summarizeImportWarnings([
      {
        code: 'duplicate',
        path: '/media/a.mkv',
        relatedPath: '/media/a.mkv',
        count: 1,
        message: 'Duplicate import was skipped',
      },
      {
        code: 'duplicate',
        path: '/media/b.mkv',
        relatedPath: '/media/b.mkv',
        count: 2,
        message: 'Duplicate import was skipped',
      },
      {
        code: 'overlap',
        path: '/media/c.mkv',
        relatedPath: '/media/c.mkv',
        count: 1,
        message: 'Overlapping import was skipped',
      },
    ])).toBe('Duplicate import was skipped (3); Overlapping import was skipped (1)');
  });

  it('warns once when nonempty roots produce no supported files', async () => {
    expandImportRootsMock.mockResolvedValue({ files: [], warnings: [] });

    await expect(expandToolImportRoots(
      ['/media/unsupported.txt'],
      getToolImportPolicy('subtitle-ocr'),
      'subtitle-ocr',
    )).resolves.toEqual([]);

    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(warningMock).toHaveBeenCalledWith({
      source: 'subtitle-ocr',
      title: 'No supported imports found',
      details: 'No files matching the selected import policy were found.',
      showAction: false,
    });
  });

  it('keeps cancellation silent without invoking native expansion', async () => {
    await expect(expandToolImportRoots(
      [],
      getToolImportPolicy('rename'),
      'rename',
    )).resolves.toEqual([]);
    expect(expandImportRootsMock).not.toHaveBeenCalled();
    expect(warningMock).not.toHaveBeenCalled();
  });

  it('reports native warnings once when all expanded files were skipped', async () => {
    expandImportRootsMock.mockResolvedValue({
      files: [],
      warnings: [{
        code: 'non-regular-root',
        path: '/media/missing',
        relatedPath: null,
        count: 1,
        message: 'Import root could not be inspected',
      }],
    });

    await expandToolImportRoots(['/media/missing'], getToolImportPolicy('info'), 'system');

    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(warningMock).toHaveBeenCalledWith({
      source: 'system',
      title: 'Some imports were skipped',
      details: 'Import root could not be inspected (1)',
      showAction: false,
    });
  });

  it('converts native expansion rejection into one sanitized warning and empty output', async () => {
    expandImportRootsMock.mockRejectedValue(new Error('secret path and backend token'));

    await expect(expandToolImportRoots(
      ['/media/input.mkv'],
      getToolImportPolicy('extract'),
      'extraction',
    )).resolves.toEqual([]);

    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(warningMock).toHaveBeenCalledWith({
      source: 'extraction',
      title: 'Import expansion failed',
      details: 'The selected imports could not be read. No files were imported.',
      showAction: false,
    });
    expect(JSON.stringify(warningMock.mock.calls)).not.toContain('secret path and backend token');
  });
});
