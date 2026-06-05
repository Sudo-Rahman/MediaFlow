import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubtitleOcrPersistenceData, VideoOcrPersistenceData } from '$lib/types';
import { DEFAULT_OCR_CONFIG } from '$lib/types';
import { createDefaultVideoOcrSelection } from '$lib/utils';
import { addOcrVersion, loadOcrData, saveOcrData } from './ocr-storage';

const loadMediaflowDataMock = vi.hoisted(() => vi.fn());
const saveMediaflowDataMock = vi.hoisted(() => vi.fn());
const OCR_RESULT_METADATA = {
  segmentId: 'ocr-segment-1',
  zoneId: 'ocr-zone-1',
  role: 'on_screen_text',
  region: {
    x: 0.25,
    y: 0.1,
    width: 0.4,
    height: 0.2,
  },
} as const;

const SUBTITLE_OCR_DATA: SubtitleOcrPersistenceData = {
  version: 1,
  sourcePath: '/subs/movie.sup',
  versions: [],
  activeVersionId: null,
  createdAt: '2026-05-28T09:00:00.000Z',
  updatedAt: '2026-05-28T09:00:00.000Z',
};

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

  it('preserves existing subtitle OCR data when saving video OCR data', async () => {
    saveMediaflowDataMock.mockResolvedValueOnce(true);
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      subtitleOcr: SUBTITLE_OCR_DATA,
    });
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
      subtitleOcr: SUBTITLE_OCR_DATA,
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

  it('sanitizes nested OCR selection fields before saving', async () => {
    saveMediaflowDataMock.mockResolvedValueOnce(true);
    loadMediaflowDataMock.mockResolvedValueOnce(null);
    const ocrSelection = {
      unexpectedSelection: 'drop me',
      segments: [
        {
          id: 'ocr-segment-1',
          startTimeMs: 0,
          endTimeMs: 60_000,
          unexpectedSegment: 'drop me',
          zones: [
            {
              id: 'ocr-zone-1',
              role: 'main_subtitle',
              label: 'Main',
              unexpectedZone: 'drop me',
              region: {
                x: 0,
                y: 0.75,
                width: 1,
                height: 0.25,
                unexpectedRegion: 'drop me',
              },
            },
          ],
        },
      ],
    } as unknown as VideoOcrPersistenceData['ocrSelection'];
    const data: VideoOcrPersistenceData = {
      version: 2,
      videoPath: '/movie.mp4',
      ocrSelection,
      ocrVersions: [],
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    };

    await saveOcrData('/movie.mp4', data);

    const saved = saveMediaflowDataMock.mock.calls[0]?.[1] as { videoOcr?: VideoOcrPersistenceData };
    expect(saved.videoOcr?.ocrSelection).toEqual({
      segments: [
        {
          id: 'ocr-segment-1',
          startTimeMs: 0,
          endTimeMs: 60_000,
          zones: [
            {
              id: 'ocr-zone-1',
              role: 'main_subtitle',
              label: 'Main',
              region: {
                x: 0,
                y: 0.75,
                width: 1,
                height: 0.25,
              },
            },
          ],
        },
      ],
    });
  });

  it('sanitizes preview source identity fields before saving', async () => {
    saveMediaflowDataMock.mockResolvedValueOnce(true);
    loadMediaflowDataMock.mockResolvedValueOnce(null);
    const data: VideoOcrPersistenceData = {
      version: 2,
      videoPath: '/movie.mp4',
      previewSourceIdentity: {
        path: '/movie.mp4',
        size: 123,
        modifiedMs: 1_778_000_000_000,
        unexpectedIdentity: 'drop me',
      } as unknown as VideoOcrPersistenceData['previewSourceIdentity'],
      ocrSelection: createDefaultVideoOcrSelection(60_000),
      ocrVersions: [],
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    };

    await saveOcrData('/movie.mp4', data);

    const saved = saveMediaflowDataMock.mock.calls[0]?.[1] as { videoOcr?: VideoOcrPersistenceData };
    expect(saved.videoOcr?.previewSourceIdentity).toEqual({
      path: '/movie.mp4',
      size: 123,
      modifiedMs: 1_778_000_000_000,
    });
  });

  it('sanitizes OCR version fields before saving', async () => {
    saveMediaflowDataMock.mockResolvedValueOnce(true);
    loadMediaflowDataMock.mockResolvedValueOnce(null);
    const ocrSelection = createDefaultVideoOcrSelection(60_000);
    const data: VideoOcrPersistenceData = {
      version: 2,
      videoPath: '/movie.mp4',
      ocrSelection,
      ocrVersions: [
        {
          id: 'ocr-v-1',
          name: 'Version 1',
          createdAt: '2026-05-14T00:00:00.000Z',
          mode: 'full_pipeline',
          configSnapshot: {
            ...DEFAULT_OCR_CONFIG,
            frameRate: 12,
            unexpectedConfig: 'drop me',
          },
          selectionSnapshot: ocrSelection,
          rawOcr: [
            {
              frameIndex: 0,
              timeMs: 1_000,
              text: 'Detected',
              confidence: 0.91,
              ...OCR_RESULT_METADATA,
              unexpectedRawFrame: 'drop me',
            },
          ],
          finalSubtitles: [
            {
              id: 'sub-1',
              text: 'Detected',
              startTime: 1_000,
              endTime: 2_000,
              confidence: 0.91,
              ...OCR_RESULT_METADATA,
              unexpectedSubtitle: 'drop me',
            },
          ],
          unexpectedVersion: 'drop me',
        } as unknown as VideoOcrPersistenceData['ocrVersions'][number],
      ],
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    };

    await saveOcrData('/movie.mp4', data);

    const saved = saveMediaflowDataMock.mock.calls[0]?.[1] as { videoOcr?: VideoOcrPersistenceData };
    expect(saved.videoOcr?.ocrVersions[0]).toEqual({
      id: 'ocr-v-1',
      name: 'Version 1',
      createdAt: '2026-05-14T00:00:00.000Z',
      mode: 'full_pipeline',
      configSnapshot: { ...DEFAULT_OCR_CONFIG, frameRate: 12 },
      selectionSnapshot: data.ocrSelection,
      rawFrameRate: 12,
      rawOcr: [
        {
          frameIndex: 0,
          timeMs: 1_000,
          text: 'Detected',
          confidence: 0.91,
          ...OCR_RESULT_METADATA,
        },
      ],
      finalSubtitles: [
        {
          id: 'sub-1',
          text: 'Detected',
          startTime: 1_000,
          endTime: 2_000,
          confidence: 0.91,
          ...OCR_RESULT_METADATA,
        },
      ],
    });
  });

  it('loads OCR version result metadata', async () => {
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
            selectionSnapshot: ocrSelection,
            rawOcr: [
              {
                frameIndex: 0,
                timeMs: 1_000,
                text: 'Detected',
                confidence: 0.91,
                ...OCR_RESULT_METADATA,
              },
            ],
            finalSubtitles: [
              {
                id: 'sub-1',
                text: 'Detected',
                startTime: 1_000,
                endTime: 2_000,
                confidence: 0.91,
                ...OCR_RESULT_METADATA,
              },
            ],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    const data = await loadOcrData('/movie.mp4');

    expect(data?.ocrVersions[0].rawOcr[0]).toEqual({
      frameIndex: 0,
      timeMs: 1_000,
      text: 'Detected',
      confidence: 0.91,
      ...OCR_RESULT_METADATA,
    });
    expect(data?.ocrVersions[0].finalSubtitles[0]).toEqual({
      id: 'sub-1',
      text: 'Detected',
      startTime: 1_000,
      endTime: 2_000,
      confidence: 0.91,
      ...OCR_RESULT_METADATA,
    });
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
            selectionSnapshot: ocrSelection,
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

  it('saves OCR version selection snapshots', async () => {
    saveMediaflowDataMock.mockResolvedValueOnce(true);
    loadMediaflowDataMock.mockResolvedValueOnce(null);
    const ocrSelection = createDefaultVideoOcrSelection(60_000);
    const selectionSnapshot = createDefaultVideoOcrSelection(30_000);
    selectionSnapshot.segments[0].zones[0].region.y = 0.42;
    const data: VideoOcrPersistenceData = {
      version: 2,
      videoPath: '/movie.mp4',
      activeOcrVersionId: 'ocr-v-1',
      ocrSelection,
      ocrVersions: [
        {
          id: 'ocr-v-1',
          name: 'Version 1',
          createdAt: '2026-05-14T00:00:00.000Z',
          mode: 'full_pipeline',
          configSnapshot: DEFAULT_OCR_CONFIG,
          selectionSnapshot,
          rawOcr: [],
          finalSubtitles: [],
        },
      ],
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    };

    await saveOcrData('/movie.mp4', data);

    const saved = saveMediaflowDataMock.mock.calls[0]?.[1] as { videoOcr?: VideoOcrPersistenceData };
    expect(saved.videoOcr?.activeOcrVersionId).toBe('ocr-v-1');
    expect(saved.videoOcr?.ocrVersions[0].selectionSnapshot).toEqual(selectionSnapshot);
  });

  it('rejects OCR versions without selection snapshots', async () => {
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

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });

  it('rejects invalid persisted OCR active version ids on load', async () => {
    const ocrSelection = createDefaultVideoOcrSelection(60_000);
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        activeOcrVersionId: 'missing-version',
        ocrSelection,
        ocrVersions: [
          {
            id: 'ocr-v-1',
            name: 'Version 1',
            createdAt: '2026-05-14T00:00:00.000Z',
            mode: 'full_pipeline',
            configSnapshot: { ...DEFAULT_OCR_CONFIG, frameRate: 12 },
            selectionSnapshot: ocrSelection,
            rawOcr: [],
            finalSubtitles: [],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });

  it('saves OCR draft state when a draft is active', async () => {
    saveMediaflowDataMock.mockResolvedValueOnce(true);
    loadMediaflowDataMock.mockResolvedValueOnce(null);
    const ocrSelection = createDefaultVideoOcrSelection(60_000);
    const draftSelection = createDefaultVideoOcrSelection(45_000);
    draftSelection.segments[0].zones[0].region.y = 0.33;
    const data: VideoOcrPersistenceData = {
      version: 2,
      videoPath: '/movie.mp4',
      activeOcrVersionId: null,
      draft: {
        baseVersionId: 'ocr-v-1',
        selection: draftSelection,
        dirty: true,
        updatedAt: '2026-05-26T12:00:00.000Z',
      },
      ocrSelection: draftSelection,
      ocrVersions: [
        {
          id: 'ocr-v-1',
          name: 'Version 1',
          createdAt: '2026-05-14T00:00:00.000Z',
          mode: 'full_pipeline',
          configSnapshot: DEFAULT_OCR_CONFIG,
          selectionSnapshot: ocrSelection,
          rawOcr: [],
          finalSubtitles: [],
        },
      ],
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    };

    await saveOcrData('/movie.mp4', data);

    const saved = saveMediaflowDataMock.mock.calls[0]?.[1] as { videoOcr?: VideoOcrPersistenceData };
    expect(saved.videoOcr?.activeOcrVersionId).toBeNull();
    expect(saved.videoOcr?.draft?.selection).toEqual(draftSelection);
  });

  it('does not overwrite unsupported existing OCR data when saving', async () => {
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
            configSnapshot: DEFAULT_OCR_CONFIG,
            rawOcr: [],
            finalSubtitles: [],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(saveOcrData('/movie.mp4', {
      version: 2,
      videoPath: '/movie.mp4',
      ocrSelection,
      ocrVersions: [],
      createdAt: '2026-05-26T12:00:00.000Z',
      updatedAt: '2026-05-26T12:00:00.000Z',
    })).rejects.toThrow('This Video OCR data is not compatible with this MediaFlow version.');

    expect(saveMediaflowDataMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'invalid active OCR version id',
      activeOcrVersionId: 'missing-version' as const,
      draft: undefined,
    },
    {
      name: 'active draft without draft data',
      activeOcrVersionId: null,
      draft: undefined,
    },
  ])('does not overwrite unsupported existing OCR data with $name when saving', async ({ activeOcrVersionId, draft }) => {
    const ocrSelection = createDefaultVideoOcrSelection(60_000);
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        activeOcrVersionId,
        draft,
        ocrSelection,
        ocrVersions: [
          {
            id: 'ocr-v-1',
            name: 'Version 1',
            createdAt: '2026-05-14T00:00:00.000Z',
            mode: 'full_pipeline',
            configSnapshot: DEFAULT_OCR_CONFIG,
            selectionSnapshot: ocrSelection,
            rawOcr: [],
            finalSubtitles: [],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(saveOcrData('/movie.mp4', {
      version: 2,
      videoPath: '/movie.mp4',
      ocrSelection,
      ocrVersions: [],
      createdAt: '2026-05-26T12:00:00.000Z',
      updatedAt: '2026-05-26T12:00:00.000Z',
    })).rejects.toThrow('This Video OCR data is not compatible with this MediaFlow version.');

    expect(saveMediaflowDataMock).not.toHaveBeenCalled();
  });

  it('adds a selection snapshot when appending a version without one', async () => {
    saveMediaflowDataMock.mockResolvedValueOnce(true);
    loadMediaflowDataMock.mockResolvedValueOnce(null);
    const ocrSelection = createDefaultVideoOcrSelection(60_000);

    const data = await addOcrVersion('/movie.mp4', {
      id: 'ocr-v-1',
      name: 'Version 1',
      createdAt: '2026-05-14T00:00:00.000Z',
      mode: 'full_pipeline',
      configSnapshot: DEFAULT_OCR_CONFIG,
      rawOcr: [],
      finalSubtitles: [],
    }, { ocrSelection });

    expect(data?.ocrVersions[0].selectionSnapshot).toEqual(ocrSelection);
    const saved = saveMediaflowDataMock.mock.calls[0]?.[1] as { videoOcr?: VideoOcrPersistenceData };
    expect(saved.videoOcr?.ocrVersions[0].selectionSnapshot).toEqual(ocrSelection);
  });

  it('rejects active draft persistence without a draft object', async () => {
    const ocrSelection = createDefaultVideoOcrSelection(60_000);
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        activeOcrVersionId: null,
        ocrSelection,
        ocrVersions: [
          {
            id: 'ocr-v-1',
            name: 'Version 1',
            createdAt: '2026-05-14T00:00:00.000Z',
            mode: 'full_pipeline',
            configSnapshot: { ...DEFAULT_OCR_CONFIG, frameRate: 12 },
            selectionSnapshot: ocrSelection,
            rawOcr: [],
            finalSubtitles: [],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });

  it('rejects malformed preview metadata on load', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        previewPath: 12,
        previewVersion: 'ocr-preview-v3',
        previewSourceIdentity: {
          path: '/movie.mp4',
          size: -1,
          modifiedMs: 1_778_000_000_000,
        },
        ocrSelection: createDefaultVideoOcrSelection(60_000),
        ocrVersions: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });

  it('rejects invalid OCR version modes on load', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection: createDefaultVideoOcrSelection(60_000),
        ocrVersions: [
          {
            id: 'ocr-v-1',
            name: 'Version 1',
            createdAt: '2026-05-14T00:00:00.000Z',
            mode: 'legacy_mode',
            configSnapshot: { ...DEFAULT_OCR_CONFIG, frameRate: 12 },
            rawOcr: [],
            finalSubtitles: [],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });

  it('rejects malformed raw OCR frame entries on load', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection: createDefaultVideoOcrSelection(60_000),
        ocrVersions: [
          {
            id: 'ocr-v-1',
            name: 'Version 1',
            createdAt: '2026-05-14T00:00:00.000Z',
            mode: 'full_pipeline',
            configSnapshot: { ...DEFAULT_OCR_CONFIG, frameRate: 12 },
            rawOcr: [{ frameIndex: 0, timeMs: '0', text: 'Hello', confidence: 0.9 }],
            finalSubtitles: [],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });

  it('rejects malformed OCR subtitle entries on load', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection: createDefaultVideoOcrSelection(60_000),
        ocrVersions: [
          {
            id: 'ocr-v-1',
            name: 'Version 1',
            createdAt: '2026-05-14T00:00:00.000Z',
            mode: 'full_pipeline',
            configSnapshot: { ...DEFAULT_OCR_CONFIG, frameRate: 12 },
            rawOcr: [],
            finalSubtitles: [
              { id: 'sub-1', text: 'Hello', startTime: 0, endTime: Number.NaN, confidence: 0.9 },
            ],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });

  it('rejects invalid OCR subtitle timing and confidence on load', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection: createDefaultVideoOcrSelection(60_000),
        ocrVersions: [
          {
            id: 'ocr-v-1',
            name: 'Version 1',
            createdAt: '2026-05-14T00:00:00.000Z',
            mode: 'full_pipeline',
            configSnapshot: { ...DEFAULT_OCR_CONFIG, frameRate: 12 },
            rawOcr: [],
            finalSubtitles: [
              { id: 'sub-1', text: 'Hello', startTime: 2_000, endTime: 1_000, confidence: 1.1 },
            ],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });

  it('rejects OCR version result metadata with invalid roles', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection: createDefaultVideoOcrSelection(60_000),
        ocrVersions: [
          {
            id: 'ocr-v-1',
            name: 'Version 1',
            createdAt: '2026-05-14T00:00:00.000Z',
            mode: 'full_pipeline',
            configSnapshot: { ...DEFAULT_OCR_CONFIG, frameRate: 12 },
            rawOcr: [
              {
                frameIndex: 0,
                timeMs: 1_000,
                text: 'Detected',
                confidence: 0.91,
                ...OCR_RESULT_METADATA,
                role: 'unsupported_role',
              },
            ],
            finalSubtitles: [],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });

  it('rejects OCR version result metadata with malformed regions', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection: createDefaultVideoOcrSelection(60_000),
        ocrVersions: [
          {
            id: 'ocr-v-1',
            name: 'Version 1',
            createdAt: '2026-05-14T00:00:00.000Z',
            mode: 'full_pipeline',
            configSnapshot: { ...DEFAULT_OCR_CONFIG, frameRate: 12 },
            rawOcr: [],
            finalSubtitles: [
              {
                id: 'sub-1',
                text: 'Detected',
                startTime: 1_000,
                endTime: 2_000,
                confidence: 0.91,
                ...OCR_RESULT_METADATA,
                region: {
                  x: 0.25,
                  y: Number.NaN,
                  width: 0.4,
                  height: 0.2,
                },
              },
            ],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });

  it('rejects OCR version result metadata with non-string ids', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 2,
        videoPath: '/movie.mp4',
        ocrSelection: createDefaultVideoOcrSelection(60_000),
        ocrVersions: [
          {
            id: 'ocr-v-1',
            name: 'Version 1',
            createdAt: '2026-05-14T00:00:00.000Z',
            mode: 'full_pipeline',
            configSnapshot: { ...DEFAULT_OCR_CONFIG, frameRate: 12 },
            rawOcr: [
              {
                frameIndex: 0,
                timeMs: 1_000,
                text: 'Detected',
                confidence: 0.91,
                ...OCR_RESULT_METADATA,
                zoneId: 12,
              },
            ],
            finalSubtitles: [],
          },
        ],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
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
      'This Video OCR data is not compatible with this MediaFlow version.',
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
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });

  it.each([
    {
      name: 'invalid role',
      zone: {
        id: 'ocr-zone-1',
        role: 'commentary',
        region: { x: 0, y: 0.75, width: 1, height: 0.25 },
      },
    },
    {
      name: 'invalid geometry',
      zone: {
        id: 'ocr-zone-1',
        role: 'main_subtitle',
        region: { x: 0, y: 0.75, width: 1, height: Number.NaN },
      },
    },
  ])('rejects malformed v2 OCR selection zones: $name', async ({ zone }) => {
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
              zones: [zone],
            },
          ],
        },
        ocrVersions: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data is not compatible with this MediaFlow version.',
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
      'This Video OCR data is not compatible with this MediaFlow version.',
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
      'This Video OCR data is not compatible with this MediaFlow version.',
    );
  });
});
