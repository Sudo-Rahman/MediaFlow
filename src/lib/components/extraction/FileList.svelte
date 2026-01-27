<script lang="ts">
  import { cn } from '$lib/utils';
  import type { VideoFile } from '$lib/types';
  import { formatFileSize, formatDuration } from '$lib/utils/format';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import FileVideo from 'lucide-svelte/icons/file-video';
  import Film from 'lucide-svelte/icons/film';
  import Volume2 from 'lucide-svelte/icons/volume-2';
  import Subtitles from 'lucide-svelte/icons/subtitles';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import XCircle from 'lucide-svelte/icons/x-circle';
  import Trash2 from 'lucide-svelte/icons/trash-2';

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
    <button
      class={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent w-full',
        selectedPath === file.path && 'border-primary bg-primary/5'
      )}
      onclick={() => onSelect?.(file.path)}
    >
      <!-- Icon -->
      <div class="flex-shrink-0 mt-0.5">
        {#if file.status === 'scanning'}
          <Loader2 class="size-5 text-muted-foreground animate-spin" />
        {:else if file.status === 'ready'}
          <FileVideo class="size-5 text-primary" />
        {:else if file.status === 'error'}
          <XCircle class="size-5 text-destructive" />
        {:else}
          <FileVideo class="size-5 text-muted-foreground" />
        {/if}
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        <p class="font-medium truncate">{file.name}</p>

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
      </div>

      <!-- Remove button -->
      <Button
        variant="ghost"
        size="icon-sm"
        class="flex-shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove?.(file.path); }}
      >
        <Trash2 class="size-4" />
        <span class="sr-only">Remove</span>
      </Button>
    </button>
  {:else}
    <p class="text-center text-muted-foreground py-8">
      Aucun fichier importé
    </p>
  {/each}
</div>

