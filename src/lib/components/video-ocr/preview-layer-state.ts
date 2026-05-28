export interface PreviewLayerStateInput {
  isDrawingZone: boolean;
  isEditingZone: boolean;
}

export interface PreviewLayerState {
  showPassiveZones: boolean;
  showRegionSelector: boolean;
  showToolbarActions: boolean;
}

export function getPreviewLayerState(input: PreviewLayerStateInput): PreviewLayerState {
  const isSelectingRegion = input.isDrawingZone || input.isEditingZone;

  return {
    showPassiveZones: !isSelectingRegion,
    showRegionSelector: isSelectingRegion,
    showToolbarActions: isSelectingRegion,
  };
}
