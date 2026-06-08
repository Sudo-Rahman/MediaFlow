<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount, tick } from 'svelte';

  import { waitForStartupPaint } from '$lib/services/startup';

  const MIN_SPLASH_VISIBLE_MS = 1000;

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  onMount(() => {
    let cancelled = false;

    void (async () => {
      await tick();
      await waitForStartupPaint();
      await delay(MIN_SPLASH_VISIBLE_MS);

      if (cancelled) {
        return;
      }

      try {
        await goto(resolve('/app'), {
          replaceState: true,
          noScroll: true,
          keepFocus: true,
        });
      } catch {
        // Stay on the visual splash if the SPA handoff fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  });
</script>

<svelte:head>
  <title>MediaFlow</title>
</svelte:head>

<main class="grid h-screen place-items-center overflow-hidden bg-transparent">
  <img
    src="/mediaflow-logo.svg"
    alt="MediaFlow"
    class="size-28 animate-[pulse_1.35s_ease-in-out_infinite] drop-shadow-2xl"
    draggable="false"
  />
</main>
