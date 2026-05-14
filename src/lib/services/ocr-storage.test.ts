import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoOcrPersistenceData } from '$lib/types';
import { DEFAULT_OCR_CONFIG } from '$lib/types';
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

  it('does not persist runtime legacy OCR region keys', async () => {
    saveMediaflowDataMock.mockResolvedValueOnce(true);
    loadMediaflowDataMock.mockResolvedValueOnce(null);
    const data: VideoOcrPersistenceData & {
      ocrRegion: { x: number; y: number; width: number; height: number };
      ocrRegionMode: 'custom';
    } = {
      version: 2,
      videoPath: '/movie.mp4',
      ocrSelection: createDefaultVideoOcrSelection(60_000),
      ocrVersions: [],
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
      ocrRegion: { x: 0, y: 0.75, width: 1, height: 0.25 },
      ocrRegionMode: 'custom',
    };

    await saveOcrData('/movie.mp4', data);

    const saved = saveMediaflowDataMock.mock.calls[0]?.[1] as { videoOcr?: Record<string, unknown> };
    expect(saved.videoOcr).not.toHaveProperty('ocrRegion');
    expect(saved.videoOcr).not.toHaveProperty('ocrRegionMode');
  });

  it('loads valid video OCR selection data and normalizes versions', async () => {
    const ocrSelection = createDefaultVideoOcrSelection(60_000);
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection,
        ocrVersions: [
          {
            id: 'ocr-v-1',
            name: 'Version 1',
            createdAt: '2026-05-14T00:00:00.000Z',
            mode: 'full_pipeline',
            configSnapshot: { ...DEFAULT_OCR_CONFIG, frameRate: 12 },
            rawOcr: [],
            finalSubtitles: [],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    const data = await loadOcrData('/movie.mp4');

    expect(data?.ocrSelection).toEqual(ocrSelection);
    expect(data?.ocrVersions[0].rawFrameRate).toBe(12);
  });

  it('rejects malformed v2 OCR selection persistence', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection: {},
        ocrVersions: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data was created with an older MediaFlow version and is not supported.',
    );
  });

  it('rejects malformed v2 OCR selection segments', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection: {
          segments: ['not-a-segment'],
        },
        ocrVersions: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data was created with an older MediaFlow version and is not supported.',
    );
  });

  it('rejects malformed v2 OCR selection zones', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection: {
          segments: [
            {
              id: 'ocr-segment-1',
              startTimeMs: 0,
              endTimeMs: 60_000,
              zones: [
                {
                  id: 'ocr-zone-1',
                  role: 'commentary',
                  region: { x: 0, y: 0.75, width: 1, height: Number.NaN },
                },
              ],
            },
          ],
        },
        ocrVersions: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data was created with an older MediaFlow version and is not supported.',
    );
  });

  it.each([
    {
      name: 'empty segments',
      ocrSelection: { segments: [] },
    },
    {
      name: 'segment with empty zones',
      ocrSelection: {
        segments: [
          {
            id: 'ocr-segment-1',
            startTimeMs: 0,
            endTimeMs: 60_000,
            zones: [],
          },
        ],
      },
    },
    {
      name: 'reversed segment timing',
      ocrSelection: {
        segments: [
          {
            id: 'ocr-segment-1',
            startTimeMs: 60_000,
            endTimeMs: 60_000,
            zones: [
              {
                id: 'ocr-zone-1',
                role: 'main_subtitle',
                region: { x: 0, y: 0.75, width: 1, height: 0.25 },
              },
            ],
          },
        ],
      },
    },
    {
      name: 'out-of-frame region',
      ocrSelection: {
        segments: [
          {
            id: 'ocr-segment-1',
            startTimeMs: 0,
            endTimeMs: 60_000,
            zones: [
              {
                id: 'ocr-zone-1',
                role: 'main_subtitle',
                region: { x: 0.9, y: 0.75, width: 0.2, height: 0.25 },
              },
            ],
          },
        ],
      },
    },
    {
      name: 'zero-size region',
      ocrSelection: {
        segments: [
          {
            id: 'ocr-segment-1',
            startTimeMs: 0,
            endTimeMs: 60_000,
            zones: [
              {
                id: 'ocr-zone-1',
                role: 'main_subtitle',
                region: { x: 0, y: 0.75, width: 0, height: 0.25 },
              },
            ],
          },
        ],
      },
    },
  ])('rejects semantically invalid v2 OCR selection data: $name', async ({ ocrSelection }) => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection,
        ocrVersions: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data was created with an older MediaFlow version and is not supported.',
    );
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
