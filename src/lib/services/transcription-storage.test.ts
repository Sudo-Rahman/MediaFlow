import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubtitleOcrPersistenceData, TranscriptionData } from '$lib/types';
import { deleteTranscriptionData, saveTranscriptionData } from './transcription-storage';

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

const transcriptionData: TranscriptionData = {
  version: 1,
  audioPath: '/audio/movie.wav',
  transcriptionVersions: [],
};

describe('transcription storage', () => {
  beforeEach(() => {
    deleteMediaflowDataMock.mockReset();
    loadMediaflowDataMock.mockReset();
    saveMediaflowDataMock.mockReset();
  });

  it('preserves existing subtitle OCR data when saving transcription data', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      subtitleOcr: subtitleOcrData,
    });
    saveMediaflowDataMock.mockResolvedValueOnce(true);

    await expect(saveTranscriptionData('/audio/movie.wav', transcriptionData)).resolves.toBe(true);

    expect(saveMediaflowDataMock).toHaveBeenCalledWith('/audio/movie.wav', {
      version: 1,
      audioToSubs: transcriptionData,
      videoOcr: undefined,
      translation: undefined,
      subtitleOcr: subtitleOcrData,
    });
  });

  it('preserves subtitle OCR data when deleting transcription data', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      audioToSubs: transcriptionData,
      subtitleOcr: subtitleOcrData,
    });
    saveMediaflowDataMock.mockResolvedValueOnce(true);

    await expect(deleteTranscriptionData('/audio/movie.wav')).resolves.toBe(true);

    expect(saveMediaflowDataMock).toHaveBeenCalledWith('/audio/movie.wav', {
      version: 1,
      videoOcr: undefined,
      translation: undefined,
      subtitleOcr: subtitleOcrData,
    });
    expect(deleteMediaflowDataMock).not.toHaveBeenCalled();
  });
});
