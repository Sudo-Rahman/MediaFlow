<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { PlatformChrome } from './platform-chrome';
  import WindowsWindowControls from './WindowsWindowControls.svelte';

  interface AppHeaderProps {
    title: string;
    description?: string;
    platformChrome: PlatformChrome;
    showTitle?: boolean;
    leading?: Snippet;
    titleSuffix?: Snippet;
    status?: Snippet;
    actions?: Snippet;
    trailing?: Snippet;
  }

  let {
    title,
    description,
    platformChrome,
    showTitle = true,
    leading,
    titleSuffix,
    status,
    actions,
    trailing,
  }: AppHeaderProps = $props();

  const usesHeaderDragRegion = $derived(
    platformChrome === 'macos-overlay' || platformChrome === 'windows-custom',
  );
  const usesWindowsControls = $derived(platformChrome === 'windows-custom');
</script>

<header
  class="flex min-h-14 shrink-0 items-center gap-2 border-b {usesWindowsControls ? 'py-0 pr-0 pl-4' : 'px-4 py-2'}"
  data-tauri-drag-region={usesHeaderDragRegion ? true : undefined}
>
  {#if leading}
    {@render leading()}
  {/if}

  <div class="flex min-w-0 flex-1 items-center gap-2" data-tauri-drag-region={usesHeaderDragRegion ? true : undefined}>
    {#if showTitle}
      <div class="min-w-0" data-tauri-drag-region={usesHeaderDragRegion ? true : undefined}>
        <h1 data-tauri-drag-region={usesHeaderDragRegion ? true : undefined} class="truncate text-lg font-semibold">{title}</h1>
        {#if description}
          <p data-tauri-drag-region={usesHeaderDragRegion ? true : undefined} class="truncate text-sm text-muted-foreground">{description}</p>
        {/if}
      </div>
    {/if}

    {#if titleSuffix}
      <div class="shrink-0">{@render titleSuffix()}</div>
    {/if}
  </div>

  {#if status}
    {@render status()}
  {/if}

  {#if actions}
    {@render actions()}
  {/if}

  {#if trailing}
    {@render trailing()}
  {/if}

  {#if usesWindowsControls}
    <WindowsWindowControls />
  {/if}
</header>
