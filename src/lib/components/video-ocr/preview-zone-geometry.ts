import type { OcrRegion } from '$lib/types';

export interface PreviewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PreviewSize {
  width: number;
  height: number;
}

export interface PreviewVideoBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewPoint {
  x: number;
  y: number;
}

export interface PreviewZoneEntry {
  region: OcrRegion;
}

export function calculateVideoBounds(container: PreviewSize, video: PreviewSize): PreviewVideoBounds {
  if (
    container.width <= 0
    || container.height <= 0
    || video.width <= 0
    || video.height <= 0
  ) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const videoRatio = video.width / video.height;
  const containerRatio = container.width / container.height;

  if (videoRatio > containerRatio) {
    const displayHeight = container.width / videoRatio;
    return {
      x: 0,
      y: (container.height - displayHeight) / 2 / container.height,
      width: 1,
      height: displayHeight / container.height,
    };
  }

  const displayWidth = container.height * videoRatio;
  return {
    x: (container.width - displayWidth) / 2 / container.width,
    y: 0,
    width: displayWidth / container.width,
    height: 1,
  };
}

export function getVideoPoint(
  pointer: { clientX: number; clientY: number },
  container: PreviewRect,
  bounds: PreviewVideoBounds,
): PreviewPoint | null {
  if (container.width <= 0 || container.height <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const containerX = (pointer.clientX - container.left) / container.width;
  const containerY = (pointer.clientY - container.top) / container.height;
  if (
    containerX < bounds.x
    || containerX > bounds.x + bounds.width
    || containerY < bounds.y
    || containerY > bounds.y + bounds.height
  ) {
    return null;
  }

  return {
    x: (containerX - bounds.x) / bounds.width,
    y: (containerY - bounds.y) / bounds.height,
  };
}

export function findTopmostZoneAtPoint<T extends PreviewZoneEntry>(
  point: PreviewPoint | null,
  entries: readonly T[],
): T | undefined {
  if (!point) {
    return undefined;
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      point.x >= entry.region.x
      && point.x <= entry.region.x + entry.region.width
      && point.y >= entry.region.y
      && point.y <= entry.region.y + entry.region.height
    ) {
      return entry;
    }
  }

  return undefined;
}

export function regionToContainerStyle(region: OcrRegion, bounds: PreviewVideoBounds): string {
  const left = bounds.x * 100 + region.x * bounds.width * 100;
  const top = bounds.y * 100 + region.y * bounds.height * 100;
  const width = region.width * bounds.width * 100;
  const height = region.height * bounds.height * 100;

  return `left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%;`;
}
