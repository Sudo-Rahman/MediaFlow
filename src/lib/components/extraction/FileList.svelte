<script lang="ts">
  import { FileVideo, Film, Volume2, Subtitles, Loader2, XCircle, Trash2 } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { FileItemCard } from '$lib/components/shared';
  import type { VideoFile } from '$lib/types';
  import { formatFileSize, formatDuration } from '$lib/utils/format';

  interface FileListProps {
    files: VideoFile[];
    selectedPath: string | null;
    onSelect?: (path: string) => void;
    onRemove?: (path: string) => void;
    class?: string;
  }

  let { files, selectedPath, onSelect, onRemove, class: className = '' }: FileListProps = $props();

  function getTrackCounts(file: VideoFile) {
    const counts = { video: 0, audio: 0, subtitle: 0 };
    for (const track of file.tracks) {
      if (track.type in counts) {
        counts[track.type as keyof typeof counts]++;
      }
    }
    return counts;
  }
</script>

<div class={cn('flex flex-col gap-2', className)}>
  {#each files as file (file.path)}
    {@const counts = getTrackCounts(file)}
    <FileItemCard selected={selectedPath === file.path} onclick={() => onSelect?.(file.path)}>
      {#snippet icon()}
        {#if file.status === 'scanning'}
          <Loader2 class="size-5 text-muted-foreground animate-spin" />
        {:else if file.status === 'ready'}
          <FileVideo class="size-5 text-primary" />
        {:else if file.status === 'error'}
          <XCircle class="size-5 text-destructive" />
        {:else}
          <FileVideo class="size-5 text-muted-foreground" />
        {/if}
      {/snippet}

      {#snippet content()}
        <p class="font-medium text-sm truncate">{file.name}</p>

        {#if file.status === 'ready'}
          <div class="flex flex-wrap gap-1.5 mt-1.5">
            {#if counts.video > 0}
              <Badge variant="secondary" class="text-xs gap-1">
                <Film class="size-3" />
                {counts.video}
              </Badge>
            {/if}
            {#if counts.audio > 0}
              <Badge variant="secondary" class="text-xs gap-1">
                <Volume2 class="size-3" />
                {counts.audio}
              </Badge>
            {/if}
            {#if counts.subtitle > 0}
              <Badge variant="secondary" class="text-xs gap-1">
                <Subtitles class="size-3" />
                {counts.subtitle}
              </Badge>
            {/if}
          </div>
          <div class="flex gap-2 mt-1 text-xs text-muted-foreground">
            <span>{formatFileSize(file.size)}</span>
            {#if file.duration}
              <span>{formatDuration(file.duration)}</span>
            {/if}
          </div>
        {:else if file.status === 'scanning'}
          <p class="text-xs text-muted-foreground mt-1">Scanning...</p>
        {:else if file.status === 'error'}
          <p class="text-xs text-destructive mt-1">{file.error}</p>
        {/if}
      {/snippet}

      {#snippet actions()}
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove?.(file.path); }}
        >
          <Trash2 class="size-4" />
          <span class="sr-only">Remove</span>
        </Button>
      {/snippet}
    </FileItemCard>
  {:else}
    <p class="text-center text-muted-foreground py-8">No files imported</p>
  {/each}
</div>
