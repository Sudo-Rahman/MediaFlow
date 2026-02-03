<script lang="ts">
  import { Upload, Languages } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  ;
  ;

  interface SubtitleDropZoneProps {
    isDragging?: boolean;
    class?: string;
  }

  let { isDragging = false, class: className = '' }: SubtitleDropZoneProps = $props();
</script>

<div
  class={cn(
    'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors',
    isDragging
      ? 'border-primary bg-primary/5'
      : 'border-muted-foreground/25 hover:border-muted-foreground/50',
    className
  )}
>
  <div class={cn(
    'rounded-full p-4 mb-4',
    isDragging ? 'bg-primary/10' : 'bg-muted'
  )}>
    {#if isDragging}
      <Upload class="size-8 text-primary" />
    {:else}
      <Languages class="size-8 text-muted-foreground" />
    {/if}
  </div>

  <p class="text-lg font-medium mb-2">
    {#if isDragging}
      Drop your subtitle file here
    {:else}
      Drag & drop your subtitle file
    {/if}
  </p>

  <p class="text-sm text-muted-foreground text-center">
    Supported formats: SRT, ASS, VTT<br />
    or click "Import" to select a file
  </p>
</div>

