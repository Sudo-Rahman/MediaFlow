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

  it('reconciles models after account changes only when the catalog reload succeeds', () => {
    const listenerIndex = layoutSource.indexOf('settingsStore.onMediaFlowUserChange');
    const restoreIndex = layoutSource.indexOf('await restoreMediaFlowSession');
    const listenerBlock = layoutSource.slice(listenerIndex, restoreIndex);
    const reloadResultMatch = listenerBlock.match(
      /const\s+(\w+)\s*=\s*await\s+mediaflowModelCatalogStore\.reload\(\);/
    );

    expect(reloadResultMatch).not.toBeNull();
    expect(listenerBlock).toContain(`if (!isMounted || !${reloadResultMatch?.[1]}) return;`);
    expect(listenerBlock).toContain('translationStore.reconcileAvailableModels();');
  });
});
