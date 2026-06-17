import { describe, expect, it } from 'vitest';

import layoutSource from '../src/routes/app/+layout.svelte?raw';

describe('MediaFlow layout startup', () => {
  it('registers the MediaFlow account listener before the initial catalog load', () => {
    const listenerIndex = layoutSource.indexOf('settingsStore.onMediaFlowUserChange');
    const initialLoadIndex = layoutSource.indexOf('mediaflowModelCatalogStore.loadOnce');

    expect(listenerIndex).toBeGreaterThanOrEqual(0);
    expect(initialLoadIndex).toBeGreaterThanOrEqual(0);
    expect(listenerIndex).toBeLessThan(initialLoadIndex);
  });
});
