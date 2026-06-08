<script lang="ts">
  import { onMount } from 'svelte';
  import { ModeWatcher, setMode } from 'mode-watcher';

  import { Toaster } from '$lib/components/ui/sonner';
  import { restoreMediaFlowSession } from '$lib/services/mediaflow-auth';
  import { mediaflowModelCatalogStore, settingsStore } from '$lib/stores';

  let { children } = $props();

  onMount(() => {
    void (async () => {
      await settingsStore.load();
      setMode(settingsStore.settings.theme);
      void mediaflowModelCatalogStore.loadOnce();
      await restoreMediaFlowSession();
    })();
  });
</script>

<ModeWatcher />
<Toaster richColors closeButton />

{@render children()}
