<script lang="ts">
  import { cn } from '$lib/utils';
  import Upload from 'lucide-svelte/icons/upload';
  import FileText from 'lucide-svelte/icons/file-text';

  interface RenameDropZoneProps {
    isDragging?: boolean;
    class?: string;
  }

  let { isDragging = false, class: className = '' }: RenameDropZoneProps = $props();
</script>

<div
  class={cn(
    'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all duration-200',
    isDragging
      ? 'border-primary bg-primary/5 scale-[1.02]'
      : 'border-muted-foreground/25 hover:border-muted-foreground/50',
    className
  )}
>
  <div
    class={cn(
      'flex size-16 items-center justify-center rounded-full mb-4 transition-colors',
      isDragging ? 'bg-primary/10' : 'bg-muted'
    )}
  >
    {#if isDragging}
      <Upload class="size-8 text-primary animate-bounce" />
    {:else}
      <FileText class="size-8 text-muted-foreground" />
    {/if}
  </div>

  <h3 class="text-lg font-semibold mb-1">
    {isDragging ? 'Drop files here' : 'Drop files to rename'}
  </h3>

  <p class="text-sm text-muted-foreground text-center max-w-xs">
    Drag and drop any files here, or click "Add" to browse.
    All file types are supported.
  </p>
</div>
