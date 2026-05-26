import { describe, expect, it } from 'vitest';

import { DEFAULT_OCR_CONFIG, type OcrVideoFile, type OcrVersion, type VideoOcrSelection } from '$lib/types';
import {
  appendOcrVersionFromRenderedSelection,
  branchOcrDraftFromRenderedSelection,
  getActiveOcrTarget,
  getRenderedOcrSelection,
  getRenderedOcrSubtitles,
  getRetryRawSource,
  hasOcrDraft,
  replaceOcrDraftSelection,
  selectOcrVersion,
} from './ocr-version-state';

describe('ocr-version-state', () => {
  it('resolves explicit version, draft, and latest active targets', () => {
    const file = videoFile({
      ocrVersions: [
        version('version-1', selection('segment-1', 0.7), 'First'),
        version('version-2', selection('segment-2', 0.4), 'Second'),
      ],
    });

    expect(getActiveOcrTarget(file)).toEqual({ kind: 'latest' });
    expect(getActiveOcrTarget({ ...file, activeOcrVersionId: 'version-1' })).toEqual({
      kind: 'version',
      versionId: 'version-1',
    });
    expect(getActiveOcrTarget({
      ...file,
      activeOcrVersionId: null,
      draft: {
        baseVersionId: 'version-1',
        selection: selection('draft-segment', 0.2),
        dirty: true,
        updatedAt: '2026-05-26T12:00:00.000Z',
      },
    })).toEqual({ kind: 'draft', baseVersionId: 'version-1' });
  });

  it('keeps draft state explicit when a completed version is selected', () => {
    const file = videoFile({
      activeOcrVersionId: 'version-1',
      ocrVersions: [
        version('version-1', selection('segment-1', 0.7), 'First'),
        version('version-2', selection('segment-2', 0.4), 'Second'),
      ],
    });

    const draftFile = replaceOcrDraftSelection(file, selection('draft-segment', 0.2));
    const completedSelection = selectOcrVersion(draftFile, 'version-2');

    expect(hasOcrDraft(completedSelection)).toBe(true);
    expect(getRenderedOcrSelection(completedSelection).segments[0].id).toBe('segment-2');
    expect(getRenderedOcrSubtitles(completedSelection)[0].text).toBe('Second');

    const selectedDraft = selectOcrVersion(completedSelection, null);
    expect(getActiveOcrTarget(selectedDraft).kind).toBe('draft');
    expect(getRenderedOcrSelection(selectedDraft).segments[0].id).toBe('draft-segment');
  });

  it('branches edits from the rendered version snapshot', () => {
    const file = videoFile({
      activeOcrVersionId: 'version-1',
      ocrVersions: [
        version('version-1', selection('segment-1', 0.7), 'First'),
        version('version-2', selection('segment-2', 0.4), 'Second'),
      ],
    });

    const draftFile = branchOcrDraftFromRenderedSelection(file);

    expect(draftFile.activeOcrVersionId).toBeNull();
    expect(draftFile.draft?.baseVersionId).toBe('version-1');
    expect(draftFile.draft?.selection.segments[0].id).toBe('segment-1');
  });

  it('appends a version from the rendered draft selection and clears the draft', () => {
    const file = replaceOcrDraftSelection(
      videoFile({
        activeOcrVersionId: 'version-1',
        ocrVersions: [version('version-1', selection('segment-1', 0.7), 'First')],
      }),
      selection('draft-segment', 0.2),
    );

    const next = appendOcrVersionFromRenderedSelection(
      file,
      version('version-2', undefined, 'Second'),
    );

    expect(next.activeOcrVersionId).toBe('version-2');
    expect(next.draft).toBeUndefined();
    expect(next.ocrVersions[1].selectionSnapshot?.segments[0].id).toBe('draft-segment');
  });

  it('preserves a parked draft when appending from a selected completed version', () => {
    const fileWithDraft = replaceOcrDraftSelection(
      videoFile({
        activeOcrVersionId: 'version-1',
        ocrVersions: [
          version('version-1', selection('segment-1', 0.7), 'First'),
          version('version-2', selection('segment-2', 0.4), 'Second'),
        ],
      }),
      selection('draft-segment', 0.2),
    );
    const selectedVersion = selectOcrVersion(fileWithDraft, 'version-2');

    const next = appendOcrVersionFromRenderedSelection(
      selectedVersion,
      version('version-3', undefined, 'Third'),
    );

    expect(next.activeOcrVersionId).toBe('version-3');
    expect(next.draft?.selection.segments[0].id).toBe('draft-segment');
    expect(next.ocrVersions[2].selectionSnapshot?.segments[0].id).toBe('segment-2');
  });

  it('uses no partial retry raw source while a draft is active', () => {
    const file = replaceOcrDraftSelection(
      videoFile({
        activeOcrVersionId: 'version-1',
        ocrVersions: [version('version-1', selection('segment-1', 0.7), 'First')],
      }),
      selection('draft-segment', 0.2),
    );

    expect(getRetryRawSource(file)).toBeNull();
    expect(getRetryRawSource(selectOcrVersion(file, 'version-1'))?.id).toBe('version-1');
  });
});

function videoFile(overrides: Partial<OcrVideoFile> = {}): OcrVideoFile {
  return {
    id: 'video-1',
    path: '/video.mp4',
    name: 'video.mp4',
    size: 100,
    status: 'completed',
    ocrSelection: selection('base-segment', 0.75),
    ocrVersions: [],
    ...overrides,
  };
}

function version(
  id: string,
  selectionSnapshot: VideoOcrSelection | undefined,
  text: string,
): OcrVersion {
  return {
    id,
    name: id,
    createdAt: `2026-05-26T12:00:0${id.endsWith('1') ? '1' : '2'}.000Z`,
    mode: 'full_pipeline',
    configSnapshot: DEFAULT_OCR_CONFIG,
    ...(selectionSnapshot ? { selectionSnapshot } : {}),
    rawOcr: [
      {
        frameIndex: 0,
        timeMs: 1_000,
        text,
        confidence: 0.9,
      },
    ],
    finalSubtitles: [
      {
        id: `subtitle-${id}`,
        text,
        startTime: 1_000,
        endTime: 2_000,
        confidence: 0.9,
      },
    ],
  };
}

function selection(segmentId: string, y: number): VideoOcrSelection {
  return {
    segments: [
      {
        id: segmentId,
        startTimeMs: 0,
        endTimeMs: 60_000,
        zones: [
          {
            id: `${segmentId}-zone`,
            role: 'main_subtitle',
            label: 'Zone 1',
            region: { x: 0.1, y, width: 0.8, height: 0.15 },
          },
        ],
      },
    ],
  };
}
