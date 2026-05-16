import { describe, expect, it } from 'vitest';

import { DEFAULT_OCR_CONFIG, type OcrVideoFile, type OcrVersion } from '$lib/types/video-ocr';
import { createDefaultVideoOcrSelection } from '$lib/utils';

import {
  createOcrVersionedImportItems,
  getOcrResultVersionAllowedFormats,
} from './ocr-versioned-export';

function createVersion(id: string, role?: 'main_subtitle' | 'on_screen_text'): OcrVersion {
  return {
    id,
    name: `Version ${id}`,
    createdAt: '2026-05-16T13:00:00.000Z',
    mode: 'full_pipeline',
    configSnapshot: DEFAULT_OCR_CONFIG,
    rawOcr: [],
    finalSubtitles: [
      {
        id: `subtitle-${id}`,
        text: 'Detected text',
        startTime: 1000,
        endTime: 2000,
        confidence: 0.95,
        ...(role ? { role } : {}),
      },
    ],
  };
}

function createFile(versions: OcrVersion[]): OcrVideoFile {
  return {
    id: 'video-1',
    path: '/Users/sr-71/Movies/sample.mp4',
    name: 'sample.mp4',
    size: 123,
    status: 'completed',
    ocrSelection: createDefaultVideoOcrSelection(60_000),
    ocrVersions: versions,
  };
}

describe('OCR versioned export helpers', () => {
  it('derives result dialog formats from the selected OCR version', () => {
    expect(getOcrResultVersionAllowedFormats(createVersion('main', 'main_subtitle'))).toEqual([
      'srt',
      'vtt',
      'ass',
    ]);
    expect(getOcrResultVersionAllowedFormats(createVersion('legacy'))).toEqual([
      'srt',
      'vtt',
      'ass',
    ]);
    expect(getOcrResultVersionAllowedFormats(createVersion('sign', 'on_screen_text'))).toEqual([
      'ass',
    ]);
  });

  it('publishes allowed formats from each OCR version instead of the live selection', () => {
    const mainVersion = createVersion('main', 'main_subtitle');
    const signVersion = createVersion('sign', 'on_screen_text');
    const [mainItem, signItem] = createOcrVersionedImportItems(
      [createFile([mainVersion, signVersion])],
      new Set([`/Users/sr-71/Movies/sample.mp4::${mainVersion.id}`]),
    );

    expect(mainItem.allowedFormats).toEqual(['srt', 'vtt', 'ass']);
    expect(mainItem.persisted).toBe('mediaflow');
    expect(signItem.allowedFormats).toEqual(['ass']);
    expect(signItem.persisted).toBe('memory');
  });
});
