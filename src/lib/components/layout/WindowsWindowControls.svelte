<script lang="ts">
  import { onMount } from 'svelte';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { Copy, Minus, Square, X } from '@lucide/svelte';

  let isMaximized = $state(false);
  let unlistenResize: UnlistenFn | undefined;

  const appWindow = getCurrentWindow();

  function warnWindowControlFailure(action: string, error: unknown): void {
    console.warn(`Failed to ${action}`, error);
  }

  async function refreshMaximizedState(): Promise<void> {
    try {
      isMaximized = await appWindow.isMaximized();
    } catch (error) {
      warnWindowControlFailure('refresh Windows maximized state', error);
    }
  }

  async function handleMinimize(): Promise<void> {
    try {
      await appWindow.minimize();
    } catch (error) {
      warnWindowControlFailure('minimize window', error);
    }
  }

  async function handleToggleMaximize(): Promise<void> {
    try {
      await appWindow.toggleMaximize();
      await refreshMaximizedState();
    } catch (error) {
      warnWindowControlFailure('toggle window maximized state', error);
    }
  }

  async function handleClose(): Promise<void> {
    try {
      await appWindow.close();
    } catch (error) {
      warnWindowControlFailure('close window', error);
    }
  }

  onMount(() => {
    let disposed = false;

    void refreshMaximizedState();

    void appWindow.onResized(() => {
      void refreshMaximizedState();
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenResize = unlisten;
    }).catch((error) => {
      warnWindowControlFailure('register Windows resize listener', error);
    });

    return () => {
      disposed = true;
      unlistenResize?.();
    };
  });
</script>

<div class="windows-window-controls" role="group" aria-label="Window controls">
  <button class="windows-window-control" type="button" aria-label="Minimize" onclick={handleMinimize}>
    <Minus class="size-4" strokeWidth={1.5} />
  </button>

  <button
    class="windows-window-control"
    type="button"
    aria-label={isMaximized ? 'Restore' : 'Maximize'}
    title={isMaximized ? 'Restore' : 'Maximize'}
    onclick={handleToggleMaximize}
  >
    {#if isMaximized}
      <Copy class="size-3.5" strokeWidth={1.5} />
    {:else}
      <Square class="size-3.5" strokeWidth={1.5} />
    {/if}
  </button>

  <button class="windows-window-control windows-window-control-close" type="button" aria-label="Close" onclick={handleClose}>
    <X class="size-4" strokeWidth={1.5} />
  </button>
</div>

<style>
  .windows-window-controls {
    display: flex;
    height: 40px;
    min-height: 0;
    align-self: flex-start;
    -webkit-app-region: no-drag;
  }

  .windows-window-control {
    display: grid;
    width: 46px;
    min-width: 46px;
    height: 40px;
    min-height: 0;
    place-items: center;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--foreground);
    outline: none;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .windows-window-control:hover {
    background: color-mix(in oklch, var(--foreground) 8%, transparent);
  }

  .windows-window-control:focus-visible {
    box-shadow: inset 0 0 0 2px color-mix(in oklch, var(--ring) 55%, transparent);
  }

  .windows-window-control-close:hover {
    background: #c42b1c;
    color: white;
  }
</style>
