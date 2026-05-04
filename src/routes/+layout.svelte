<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from '$lib/components/ui/sonner';
  import { settingsStore } from '$lib/stores';
  import { restoreMediaFlowSession } from '$lib/services/mediaflow-auth';

  let { children } = $props();

  // Load settings on app startup
  onMount(() => {
    void (async () => {
      await settingsStore.load();
      await restoreMediaFlowSession();
    })();
  });
</script>

<ModeWatcher />
<Toaster richColors closeButton />

{@render children()}
