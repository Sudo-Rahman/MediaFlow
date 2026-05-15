import { describe, expect, it } from 'vitest';

import { getAllowedExportFormatOptions, type VersionedExportFormatOption } from './versioned-export';

const FORMAT_OPTIONS: VersionedExportFormatOption[] = [
  { value: 'srt', label: 'SubRip (.srt)' },
  { value: 'vtt', label: 'WebVTT (.vtt)' },
  { value: 'ass', label: 'Advanced SubStation Alpha (.ass)' },
];

describe('getAllowedExportFormatOptions', () => {
  it('returns every format when selected targets do not declare constraints', () => {
    expect(getAllowedExportFormatOptions(FORMAT_OPTIONS, [{}, { allowedFormats: [] }])).toEqual(FORMAT_OPTIONS);
  });

  it('keeps only formats supported by every constrained target', () => {
    const allowedOptions = getAllowedExportFormatOptions(FORMAT_OPTIONS, [
      { allowedFormats: ['srt', 'vtt'] },
      { allowedFormats: ['ass'] },
    ]);

    expect(allowedOptions).toEqual([]);
  });

  it('allows ASS only when an OCR target requires positioned subtitles', () => {
    const allowedOptions = getAllowedExportFormatOptions(FORMAT_OPTIONS, [
      { allowedFormats: ['srt', 'vtt', 'ass'] },
      { allowedFormats: ['ass'] },
    ]);

    expect(allowedOptions).toEqual([{ value: 'ass', label: 'Advanced SubStation Alpha (.ass)' }]);
  });
});
