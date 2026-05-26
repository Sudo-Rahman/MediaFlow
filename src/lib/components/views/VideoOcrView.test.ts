import { describe, expect, it } from 'vitest';

import { getVideoOcrLayoutState } from './VideoOcrView.svelte';

describe('VideoOcrView layout', () => {
  it('lets expanded preview take the full tool content width', () => {
    const layout = getVideoOcrLayoutState('20rem', true);

    expect(layout.rootClass).toContain('grid-cols-[minmax(0,1fr)]');
    expect(layout.optionsWidth).toBe('0rem');
    expect(layout.showFileSidebar).toBe(false);
    expect(layout.showOptionsPanel).toBe(false);
  });

  it('keeps the file sidebar and options panel in the normal layout', () => {
    const layout = getVideoOcrLayoutState('20rem', false);

    expect(layout.rootClass).toContain('grid-cols-[auto_minmax(0,1fr)_var(--ocr-options-width)]');
    expect(layout.optionsWidth).toBe('20rem');
    expect(layout.showFileSidebar).toBe(true);
    expect(layout.showOptionsPanel).toBe(true);
  });
});
