import { describe, expect, it } from 'vitest';

import {
  clampFloatingPalettePosition,
  getTopRightFloatingPalettePosition,
} from './floating-palette-position';

const workspaceRect = { width: 800, height: 500 };
const paletteRect = { width: 320, height: 220 };

describe('floating palette position helpers', () => {
  it('clamps negative positions to padding', () => {
    expect(clampFloatingPalettePosition(
      { x: -48, y: -12 },
      workspaceRect,
      paletteRect,
      16,
    )).toEqual({ x: 16, y: 16 });
  });

  it('clamps right and bottom overflow to workspace bounds', () => {
    expect(clampFloatingPalettePosition(
      { x: 720, y: 480 },
      workspaceRect,
      paletteRect,
      16,
    )).toEqual({ x: 464, y: 264 });
  });

  it('leaves valid positions unchanged', () => {
    expect(clampFloatingPalettePosition(
      { x: 120, y: 80 },
      workspaceRect,
      paletteRect,
      16,
    )).toEqual({ x: 120, y: 80 });
  });

  it('returns the padding origin when the workspace is smaller than the palette', () => {
    expect(clampFloatingPalettePosition(
      { x: 120, y: 80 },
      { width: 240, height: 160 },
      paletteRect,
      16,
    )).toEqual({ x: 16, y: 16 });
  });

  it('positions a palette at the top-right of an anchor within bounds', () => {
    expect(getTopRightFloatingPalettePosition(
      { right: 700, top: 40 },
      workspaceRect,
      paletteRect,
      16,
    )).toEqual({ x: 364, y: 56 });
  });

  it('clamps top-right anchored positions into the viewport bounds', () => {
    expect(getTopRightFloatingPalettePosition(
      { right: 240, top: -40 },
      workspaceRect,
      paletteRect,
      16,
    )).toEqual({ x: 16, y: 16 });
  });
});
