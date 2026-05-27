import { describe, expect, it } from 'vitest';

import { getPreviewLayerState } from './preview-layer-state';

describe('getPreviewLayerState', () => {
  it('shows only passive zones in the default preview state', () => {
    expect(getPreviewLayerState({ isDrawingZone: false, isEditingZone: false })).toEqual({
      showPassiveZones: true,
      showRegionSelector: false,
      showToolbarActions: false,
    });
  });

  it('shows selector and toolbar actions while drawing a zone', () => {
    expect(getPreviewLayerState({ isDrawingZone: true, isEditingZone: false })).toEqual({
      showPassiveZones: false,
      showRegionSelector: true,
      showToolbarActions: true,
    });
  });

  it('shows selector and toolbar actions while editing a zone', () => {
    expect(getPreviewLayerState({ isDrawingZone: false, isEditingZone: true })).toEqual({
      showPassiveZones: false,
      showRegionSelector: true,
      showToolbarActions: true,
    });
  });
});
