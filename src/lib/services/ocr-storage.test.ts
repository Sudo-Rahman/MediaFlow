import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoOcrPersistenceData } from '$lib/types';
import { createDefaultVideoOcrSelection } from '$lib/utils';
import { loadOcrData, saveOcrData } from './ocr-storage';

const loadMediaflowDataMock = vi.hoisted(() => vi.fn());
const saveMediaflowDataMock = vi.hoisted(() => vi.fn());

vi.mock('./mediaflow-storage', () => ({
  loadMediaflowData: loadMediaflowDataMock,
  saveMediaflowData: saveMediaflowDataMock,
}));

describe('OCR storage', () => {
  beforeEach(() => {
    loadMediaflowDataMock.mockReset();
    saveMediaflowDataMock.mockReset();
  });

  it('saves video OCR selection data', async () => {
    saveMediaflowDataMock.mockResolvedValueOnce(true);
    loadMediaflowDataMock.mockResolvedValueOnce(null);
    const data: VideoOcrPersistenceData = {
      version: 2,
      videoPath: '/movie.mp4',
      ocrSelection: createDefaultVideoOcrSelection(60_000),
      ocrVersions: [],
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    };

    await saveOcrData('/movie.mp4', data);

    expect(saveMediaflowDataMock).toHaveBeenCalledWith('/movie.mp4', expect.objectContaining({
      videoOcr: expect.objectContaining({
        version: 2,
        ocrSelection: data.ocrSelection,
      }),
    }));
  });

  it('rejects legacy OCR region persistence', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 1,
        videoPath: '/movie.mp4',
        ocrRegion: { x: 0, y: 0.75, width: 1, height: 0.25 },
        ocrRegionMode: 'custom',
        ocrVersions: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data was created with an older MediaFlow version and is not supported.',
    );
  });
});
