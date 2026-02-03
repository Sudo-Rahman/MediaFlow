<script lang="ts">
  import { FileVideo, FileAudio, Subtitles, Loader2, XCircle, Trash2, Plus } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import type { MergeVideoFile } from '$lib/types';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  ;
  ;
  ;
  ;
  ;
  ;
  ;

  interface MergeFileListProps {
    files: MergeVideoFile[];
    selectedId: string | null;
    onSelect?: (id: string) => void;
    onRemove?: (id: string) => void;
    onAddFiles?: () => void;
    showAddButton?: boolean;
    compact?: boolean;
    class?: string;
  }

  let {
    files,
    selectedId,
    onSelect,
    onRemove,
    onAddFiles,
    showAddButton = true,
    compact = false,
    class: className = ''
  }: MergeFileListProps = $props();

  function getTrackCounts(file: MergeVideoFile) {
    const counts = { video: 0, audio: 0, subtitle: 0 };
    for (const track of file.tracks) {
      if (track.type in counts) {
        counts[track.type as keyof typeof counts]++;
      }
    }
    return counts;
  }

  function getFileIcon(file: MergeVideoFile) {
    const ext = file.path.toLowerCase().substring(file.path.lastIndexOf('.'));
    if (['.ass', '.ssa', '.srt', '.sub', '.vtt'].includes(ext)) return Subtitles;
    if (['.aac', '.ac3', '.dts', '.flac', '.mp3', '.ogg', '.wav', '.eac3', '.opus', '.mka'].includes(ext)) return FileAudio;
    return FileVideo;
  }
</script>

<div class={cn('flex flex-col', className)}>
  <!-- File list -->
  <div class="space-y-1">
    {#each files as file (file.id)}
      {@const counts = getTrackCounts(file)}
      {@const FileIcon = getFileIcon(file)}
      <button
        class={cn(
          'flex items-start gap-2 rounded-lg border text-left transition-colors hover:bg-accent w-full',
          compact ? 'p-2' : 'p-2.5',
          selectedId === file.id && 'border-primary bg-primary/5'
        )}
        onclick={() => onSelect?.(file.id)}
      >
        <!-- Icon -->
        <div class="flex-shrink-0 mt-0.5">
          {#if file.status === 'scanning'}
            <Loader2 class="size-4 text-muted-foreground animate-spin" />
          {:else if file.status === 'ready'}
            <FileIcon class="size-4 text-primary" />
          {:else if file.status === 'error'}
            <XCircle class="size-4 text-destructive" />
          {:else}
            <FileIcon class="size-4 text-muted-foreground" />
          {/if}
        </div>

        <!-- Content -->
        <div class="flex-1 min-w-0">
          <p class={cn('font-medium truncate', compact ? 'text-xs' : 'text-sm')}>{file.name}</p>

          {#if file.status === 'ready' && !compact}
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
            <p class="text-xs text-muted-foreground mt-1">Scanning...</p>
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
          <span class="sr-only">Remove</span>
        </Button>
      </button>
    {:else}
      {#if showAddButton}
        <div class="flex flex-col items-center justify-center py-8 text-center">
          <FileVideo class="size-10 text-muted-foreground/30 mb-2" />
          <p class="text-sm text-muted-foreground">No files</p>
          <Button variant="outline" size="sm" class="mt-3" onclick={onAddFiles}>
            <Plus class="size-4 mr-1" />
            Add files
          </Button>
        </div>
      {/if}
    {/each}
  </div>
</div>

