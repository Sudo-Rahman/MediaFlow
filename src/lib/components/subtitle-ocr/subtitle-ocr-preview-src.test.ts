import { describe, expect, it } from 'vitest';

import {
  isResolvedSubtitleOcrBitmapUrl,
  resolveSubtitleOcrBitmapSrc,
} from './subtitle-ocr-preview-src';

const convertLocalFileSrc = (path: string): string => `asset://localhost/${encodeURIComponent(path)}`;

describe('subtitle OCR preview src resolution', () => {
  it('converts Windows absolute paths instead of treating the drive letter as a URL scheme', () => {
    const path = String.raw`C:\Users\sr-71\AppData\Local\Temp\MediaFlow\subtitle-ocr\cue.png`;

    expect(isResolvedSubtitleOcrBitmapUrl(path)).toBe(false);
    expect(resolveSubtitleOcrBitmapSrc(path, convertLocalFileSrc)).toBe(
      `asset://localhost/${encodeURIComponent(path)}`,
    );
  });

  it('converts slash-normalized Windows paths', () => {
    const path = 'C:/Users/sr-71/AppData/Local/Temp/MediaFlow/subtitle-ocr/cue.png';

    expect(isResolvedSubtitleOcrBitmapUrl(path)).toBe(false);
    expect(resolveSubtitleOcrBitmapSrc(path, convertLocalFileSrc)).toBe(
      `asset://localhost/${encodeURIComponent(path)}`,
    );
  });

  it('converts Unix absolute paths', () => {
    const path = '/tmp/MediaFlow/subtitle-ocr/cue.png';

    expect(isResolvedSubtitleOcrBitmapUrl(path)).toBe(false);
    expect(resolveSubtitleOcrBitmapSrc(path, convertLocalFileSrc)).toBe(
      `asset://localhost/${encodeURIComponent(path)}`,
    );
  });

  it('keeps already resolved browser and Tauri asset URLs', () => {
    const urls = [
      'https://example.test/cue.png',
      'data:image/png;base64,AAAA',
      'blob:https://example.test/id',
      'file:///tmp/MediaFlow/subtitle-ocr/cue.png',
      'asset://localhost/tmp/MediaFlow/subtitle-ocr/cue.png',
      '//asset.localhost/tmp/MediaFlow/subtitle-ocr/cue.png',
    ];

    for (const url of urls) {
      expect(resolveSubtitleOcrBitmapSrc(url, convertLocalFileSrc)).toBe(url);
    }
  });
});
