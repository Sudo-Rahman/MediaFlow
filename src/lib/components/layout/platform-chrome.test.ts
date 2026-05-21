import { describe, expect, it } from 'vitest';

import { getPlatformChrome } from './platform-chrome';

describe('getPlatformChrome', () => {
  it('uses macOS overlay chrome for macOS', () => {
    expect(getPlatformChrome('MacOS')).toBe('macos-overlay');
  });

  it('uses custom chrome for Windows', () => {
    expect(getPlatformChrome('Windows')).toBe('windows-custom');
  });

  it('uses native chrome for Linux and unknown platforms', () => {
    expect(getPlatformChrome('Linux')).toBe('native');
    expect(getPlatformChrome('Unknown')).toBe('native');
  });
});
