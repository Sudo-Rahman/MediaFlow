import { describe, expect, it } from 'vitest';

import { shouldRenderVolumePopoverInline } from './PreviewPlayerControls.svelte';

describe('PreviewPlayerControls', () => {
  it('renders the volume popover inline while fullscreen is active', () => {
    expect(shouldRenderVolumePopoverInline(true)).toBe(true);
  });

  it('keeps the default popover portal outside fullscreen', () => {
    expect(shouldRenderVolumePopoverInline(false)).toBe(false);
  });
});
