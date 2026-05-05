<script lang="ts">
  import type { Snippet } from 'svelte';

  interface AppHeaderProps {
    title: string;
    description?: string;
    isMacOS: boolean;
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
    isMacOS,
    showTitle = true,
    leading,
    titleSuffix,
    status,
    actions,
    trailing,
  }: AppHeaderProps = $props();
</script>

<header
  class="flex min-h-14 shrink-0 items-center gap-2 border-b px-4 py-2"
  data-tauri-drag-region={isMacOS}
>
  {#if leading}
    {@render leading()}
  {/if}

  <div class="flex-1 min-w-0 flex items-center gap-2" data-tauri-drag-region={isMacOS}>
    {#if showTitle}
      <div class="min-w-0" data-tauri-drag-region={isMacOS}>
        <h1 data-tauri-drag-region={isMacOS} class="text-lg font-semibold truncate">{title}</h1>
        {#if description}
          <p data-tauri-drag-region={isMacOS} class="text-sm text-muted-foreground truncate">
            {description}
          </p>
        {/if}
      </div>
    {/if}

    {#if titleSuffix}
      <div class="shrink-0">
        {@render titleSuffix()}
      </div>
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
</header>
