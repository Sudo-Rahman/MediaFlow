<script lang="ts">
  import { cn } from '$lib/utils';
  import type { MergeSourceFile } from '$lib/types';
  import { formatFileSize, formatDuration } from '$lib/utils/format';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import FileVideo from 'lucide-svelte/icons/file-video';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import XCircle from 'lucide-svelte/icons/x-circle';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Plus from 'lucide-svelte/icons/plus';
  import GripVertical from 'lucide-svelte/icons/grip-vertical';

  interface MergeFileListProps {
    files: MergeSourceFile[];
    selectedId: string | null;
    onSelect?: (id: string) => void;
    onRemove?: (id: string) => void;
    onAddFiles?: () => void;
    class?: string;
  }

  let {
    files,
    selectedId,
    onSelect,
    onRemove,
    onAddFiles,
    class: className = ''
  }: MergeFileListProps = $props();

  function getTrackCounts(file: MergeSourceFile) {
    const counts = { video: 0, audio: 0, subtitle: 0 };
    for (const track of file.tracks) {
      if (track.type in counts) {
        counts[track.type as keyof typeof counts]++;
      }
    }
    return counts;
  }
</script>

<div class={cn('flex flex-col h-full', className)}>
  <!-- Header with add button -->
  <div class="flex items-center justify-between p-3 border-b">
    <span class="text-sm font-medium">Fichiers source</span>
    <Button variant="ghost" size="sm" onclick={onAddFiles}>
      <Plus class="size-4 mr-1" />
      Ajouter
    </Button>
  </div>

  <!-- File list -->
  <div class="flex-1 overflow-auto p-2 space-y-1">
    {#each files as file (file.id)}
      {@const counts = getTrackCounts(file)}
      <button
        class={cn(
          'flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors hover:bg-accent w-full',
          selectedId === file.id && 'border-primary bg-primary/5'
        )}
        onclick={() => onSelect?.(file.id)}
      >
        <!-- Drag handle -->
        <div class="flex-shrink-0 mt-0.5 cursor-grab text-muted-foreground/50 hover:text-muted-foreground">
          <GripVertical class="size-4" />
        </div>

        <!-- Icon -->
        <div class="flex-shrink-0 mt-0.5">
          {#if file.status === 'scanning'}
            <Loader2 class="size-4 text-muted-foreground animate-spin" />
          {:else if file.status === 'ready'}
            <FileVideo class="size-4 text-primary" />
          {:else if file.status === 'error'}
            <XCircle class="size-4 text-destructive" />
          {:else}
            <FileVideo class="size-4 text-muted-foreground" />
          {/if}
        </div>

        <!-- Content -->
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">{file.name}</p>

          {#if file.status === 'ready'}
            <div class="flex flex-wrap gap-1 mt-1">
              {#if counts.video > 0}
                <Badge variant="outline" class="text-xs py-0">V:{counts.video}</Badge>
              {/if}
              {#if counts.audio > 0}
                <Badge variant="outline" class="text-xs py-0">A:{counts.audio}</Badge>
              {/if}
              {#if counts.subtitle > 0}
                <Badge variant="outline" class="text-xs py-0">S:{counts.subtitle}</Badge>
              {/if}
            </div>
          {:else if file.status === 'scanning'}
            <p class="text-xs text-muted-foreground mt-1">Analyse...</p>
          {:else if file.status === 'error'}
            <p class="text-xs text-destructive mt-1 truncate">{file.error}</p>
          {/if}
        </div>

        <!-- Remove button -->
        <Button
          variant="ghost"
          size="icon-sm"
          class="flex-shrink-0 size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove?.(file.id); }}
        >
          <Trash2 class="size-3" />
          <span class="sr-only">Supprimer</span>
        </Button>
      </button>
    {:else}
      <div class="flex flex-col items-center justify-center py-8 text-center">
        <FileVideo class="size-10 text-muted-foreground/30 mb-2" />
        <p class="text-sm text-muted-foreground">Aucun fichier</p>
        <Button variant="outline" size="sm" class="mt-3" onclick={onAddFiles}>
          <Plus class="size-4 mr-1" />
          Ajouter des fichiers
        </Button>
      </div>
    {/each}
  </div>
</div>

