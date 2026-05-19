import { describe, expect, it } from 'vitest';

import { getFileName } from './format';

describe('getFileName', () => {
  it('extracts a filename from a POSIX path', () => {
    expect(getFileName('/Volumes/Media/Hero Return/video.mkv')).toBe('video.mkv');
  });

  it('extracts a filename from a Windows path', () => {
    expect(getFileName('D:\\Hero Return\\[AceAres] Hero Return - S01E01.mkv')).toBe('[AceAres] Hero Return - S01E01.mkv');
  });

  it('keeps a bare filename unchanged', () => {
    expect(getFileName('subtitle.ass')).toBe('subtitle.ass');
  });
});
