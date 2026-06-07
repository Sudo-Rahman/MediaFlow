<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount, tick } from 'svelte';

  import { markStartupSplashReady, waitForStartupPaint } from '$lib/services/startup';

  const MIN_SPLASH_VISIBLE_MS = 450;

  let navigationFailed = $state(false);

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
      await markStartupSplashReady();
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
        if (!cancelled) {
          navigationFailed = true;
        }
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

<main class="grid h-screen place-items-center overflow-hidden bg-background/82 text-foreground backdrop-blur-xl">
  <section class="flex flex-col items-center gap-5 px-6 text-center">
    <img src="/mediaflow-logo.svg" alt="MediaFlow" class="startup-logo size-24" draggable="false" />

    <div class="space-y-1">
      <h1 class="text-base font-medium">MediaFlow</h1>
      <p class="text-sm text-muted-foreground">
        {navigationFailed ? 'Startup failed. Restart MediaFlow to try again.' : 'Loading workspace'}
      </p>
    </div>
  </section>
</main>

<style>
  .startup-logo {
    animation: mediaflow-startup-pulse 1.35s ease-in-out infinite;
    filter: drop-shadow(0 18px 30px color-mix(in oklch, var(--primary), transparent 72%));
  }

  @keyframes mediaflow-startup-pulse {
    0%,
    100% {
      opacity: 0.72;
      transform: scale(0.98);
    }

    50% {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
