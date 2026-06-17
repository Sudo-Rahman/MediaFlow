<script lang="ts">
  import { onMount } from 'svelte';
  import { ModeWatcher, setMode } from 'mode-watcher';

  import { Toaster } from '$lib/components/ui/sonner';
  import { restoreMediaFlowSession } from '$lib/services/mediaflow-auth';
  import { mediaflowModelCatalogStore, settingsStore, translationStore } from '$lib/stores';

  let { children } = $props();

  onMount(() => {
    let isMounted = true;
    let unsubscribeMediaFlowUserChange: (() => void) | null = null;

    void (async () => {
      await settingsStore.load();
      if (!isMounted) return;
      setMode(settingsStore.settings.theme);
      unsubscribeMediaFlowUserChange = settingsStore.onMediaFlowUserChange(() => {
        void (async () => {
          const didReloadCatalog = await mediaflowModelCatalogStore.reload();
          if (!isMounted || !didReloadCatalog) return;
          translationStore.reconcileAvailableModels();
        })();
      });

      try {
        await restoreMediaFlowSession();
      } catch (error) {
        console.warn('MediaFlow session restore failed during startup:', error);
      }
      const didLoadCatalog = await mediaflowModelCatalogStore.loadOnce();

      if (!isMounted || !didLoadCatalog) return;
      translationStore.reconcileAvailableModels();
    })();

    return () => {
      isMounted = false;
      unsubscribeMediaFlowUserChange?.();
    };
  });
</script>

<ModeWatcher />
<Toaster richColors closeButton />

{@render children()}
