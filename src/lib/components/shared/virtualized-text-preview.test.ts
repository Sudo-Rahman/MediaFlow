import { describe, expect, it } from 'vitest';

import { splitTextPreviewLines } from './virtualized-text-preview';

describe('splitTextPreviewLines', () => {
  it('preserves empty lines between subtitle blocks', () => {
    expect(splitTextPreviewLines('1\n\n2')).toEqual(['1', '', '2']);
  });

  it('preserves a trailing newline as a final empty line', () => {
    expect(splitTextPreviewLines('line\n')).toEqual(['line', '']);
  });

  it('normalizes CRLF without leaving carriage returns in lines', () => {
    expect(splitTextPreviewLines('one\r\ntwo\r\n')).toEqual(['one', 'two', '']);
  });

  it('handles large subtitle content without dropping lines', () => {
    const block = '1\n00:00:01,000 --> 00:00:02,000\nTranslated line\n\n';
    const content = block.repeat(10_000);

    const lines = splitTextPreviewLines(content);

    expect(lines).toHaveLength(40_001);
    expect(lines[0]).toBe('1');
    expect(lines.at(-1)).toBe('');
  });
});
