<script lang="ts">
  import { onMount } from 'svelte';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from '$lib/components/ui/sonner';
  import { appUpdateStore, settingsStore } from '$lib/stores';
  import '../app.css';

  let { children } = $props();

  // Load settings on app startup
  onMount(() => {
    void settingsStore.load();
    void appUpdateStore.initialize();
  });
</script>

<ModeWatcher />
<Toaster richColors closeButton />

{@render children()}
