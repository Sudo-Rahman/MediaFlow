export interface FloatingPalettePosition {
  x: number;
  y: number;
}

interface FloatingPaletteSize {
  width: number;
  height: number;
}

interface FloatingPaletteAnchor {
  right: number;
  top: number;
}

export function getViewportFloatingPaletteRect(): FloatingPaletteSize {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

export function clampFloatingPalettePosition(
  position: FloatingPalettePosition,
  boundsRect: FloatingPaletteSize,
  paletteRect: FloatingPaletteSize,
  padding: number,
): FloatingPalettePosition {
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const maxX = Math.max(safePadding, boundsRect.width - paletteRect.width - safePadding);
  const maxY = Math.max(safePadding, boundsRect.height - paletteRect.height - safePadding);

  return {
    x: clampNumber(position.x, safePadding, maxX),
    y: clampNumber(position.y, safePadding, maxY),
  };
}

export function getTopRightFloatingPalettePosition(
  anchorRect: FloatingPaletteAnchor,
  boundsRect: FloatingPaletteSize,
  paletteRect: FloatingPaletteSize,
  padding: number,
): FloatingPalettePosition {
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;

  return clampFloatingPalettePosition(
    {
      x: anchorRect.right - paletteRect.width - safePadding,
      y: anchorRect.top + safePadding,
    },
    boundsRect,
    paletteRect,
    safePadding,
  );
}
