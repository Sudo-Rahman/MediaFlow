import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubtitleOcrPersistenceData } from '$lib/types';
import { loadMediaflowData, saveMediaflowData } from './mediaflow-storage';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

const subtitleOcrData: SubtitleOcrPersistenceData = {
  version: 1,
  sourcePath: '/subs/movie.sup',
  versions: [],
  activeVersionId: null,
  createdAt: '2026-05-28T09:00:00.000Z',
  updatedAt: '2026-05-28T09:00:00.000Z',
};

describe('MediaFlow storage', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('loads data when JSON contains only subtitle OCR data', async () => {
    invokeMock.mockResolvedValueOnce(JSON.stringify({
      version: 1,
      subtitleOcr: subtitleOcrData,
    }));

    await expect(loadMediaflowData('/subs/movie.sup')).resolves.toEqual({
      version: 1,
      subtitleOcr: subtitleOcrData,
    });
  });

  it('serializes subtitle OCR data instead of dropping it', async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await expect(saveMediaflowData('/subs/movie.sup', {
      version: 1,
      subtitleOcr: subtitleOcrData,
    })).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith('save_mediaflow_data', {
      mediaPath: '/subs/movie.sup',
      data: JSON.stringify({
        version: 1,
        subtitleOcr: subtitleOcrData,
      }, null, 2),
    });
  });
});
