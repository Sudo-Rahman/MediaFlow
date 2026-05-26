import { describe, expect, it } from 'vitest';

import type { OcrRegion } from '$lib/types';
import {
  calculateVideoBounds,
  findTopmostZoneAtPoint,
  getVideoPoint,
  regionToContainerStyle,
} from './preview-zone-geometry';

describe('preview zone geometry', () => {
  it('calculates bounds for a wide video letterboxed vertically', () => {
    expect(calculateVideoBounds({ width: 400, height: 300 }, { width: 1920, height: 1080 })).toEqual({
      x: 0,
      y: 0.125,
      width: 1,
      height: 0.75,
    });
  });

  it('calculates bounds for a tall video letterboxed horizontally', () => {
    expect(calculateVideoBounds({ width: 400, height: 300 }, { width: 1080, height: 1920 })).toEqual({
      x: 0.2890625,
      y: 0,
      width: 0.421875,
      height: 1,
    });
  });

  it('calculates full bounds when the container and video have equal aspect ratios', () => {
    expect(calculateVideoBounds({ width: 400, height: 300 }, { width: 1600, height: 1200 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('returns null for pointer locations outside the video image', () => {
    const bounds = calculateVideoBounds({ width: 400, height: 300 }, { width: 1920, height: 1080 });

    expect(getVideoPoint({ clientX: 200, clientY: 30 }, { left: 0, top: 0, width: 400, height: 300 }, bounds))
      .toBeNull();
  });

  it('maps pointer locations inside the video image to video coordinates', () => {
    const bounds = calculateVideoBounds({ width: 400, height: 300 }, { width: 1920, height: 1080 });

    expect(getVideoPoint({ clientX: 200, clientY: 150 }, { left: 0, top: 0, width: 400, height: 300 }, bounds))
      .toEqual({
        x: 0.5,
        y: 0.5,
      });
  });

  it('returns the topmost matching zone by hit testing entries in reverse order', () => {
    const bottom = { id: 'bottom', region: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } };
    const top = { id: 'top', region: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 } };

    expect(findTopmostZoneAtPoint({ x: 0.25, y: 0.25 }, [bottom, top])).toBe(top);
  });

  it('returns undefined when hit testing a null point', () => {
    const region: OcrRegion = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };

    expect(findTopmostZoneAtPoint(null, [{ region }])).toBeUndefined();
  });

  it('converts video-relative regions to container-relative styles', () => {
    expect(
      regionToContainerStyle(
        { x: 0.2, y: 0.4, width: 0.3, height: 0.5 },
        { x: 0.1, y: 0.2, width: 0.5, height: 0.25 },
      ),
    ).toBe('left: 20%; top: 30%; width: 15%; height: 12.5%;');
  });
});
