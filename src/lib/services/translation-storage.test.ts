import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubtitleOcrPersistenceData, TranslationPersistenceData } from '$lib/types';
import { deleteTranslationData, saveTranslationData } from './translation-storage';

const deleteMediaflowDataMock = vi.hoisted(() => vi.fn());
const loadMediaflowDataMock = vi.hoisted(() => vi.fn());
const saveMediaflowDataMock = vi.hoisted(() => vi.fn());

vi.mock('./mediaflow-storage', () => ({
  deleteMediaflowData: deleteMediaflowDataMock,
  loadMediaflowData: loadMediaflowDataMock,
  saveMediaflowData: saveMediaflowDataMock,
}));

const subtitleOcrData: SubtitleOcrPersistenceData = {
  version: 1,
  sourcePath: '/subs/movie.sup',
  versions: [],
  activeVersionId: null,
  createdAt: '2026-05-28T09:00:00.000Z',
  updatedAt: '2026-05-28T09:00:00.000Z',
};

const translationData: TranslationPersistenceData = {
  version: 1,
  filePath: '/subs/movie.srt',
  translationVersions: [],
  createdAt: '2026-05-28T09:30:00.000Z',
  updatedAt: '2026-05-28T09:30:00.000Z',
};

describe('translation storage', () => {
  beforeEach(() => {
    deleteMediaflowDataMock.mockReset();
    loadMediaflowDataMock.mockReset();
    saveMediaflowDataMock.mockReset();
  });

  it('preserves existing subtitle OCR data when saving translation data', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      subtitleOcr: subtitleOcrData,
    });
    saveMediaflowDataMock.mockResolvedValueOnce(true);

    await expect(saveTranslationData('/subs/movie.srt', translationData)).resolves.toBe(true);

    expect(saveMediaflowDataMock).toHaveBeenCalledWith('/subs/movie.srt', expect.objectContaining({
      subtitleOcr: subtitleOcrData,
      translation: expect.objectContaining({
        version: 1,
        filePath: '/subs/movie.srt',
      }),
    }));
  });

  it('preserves subtitle OCR data when deleting translation data', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      translation: translationData,
      subtitleOcr: subtitleOcrData,
    });
    saveMediaflowDataMock.mockResolvedValueOnce(true);

    await expect(deleteTranslationData('/subs/movie.srt')).resolves.toBe(true);

    expect(saveMediaflowDataMock).toHaveBeenCalledWith('/subs/movie.srt', {
      version: 1,
      audioToSubs: undefined,
      videoOcr: undefined,
      subtitleOcr: subtitleOcrData,
    });
    expect(deleteMediaflowDataMock).not.toHaveBeenCalled();
  });
});
