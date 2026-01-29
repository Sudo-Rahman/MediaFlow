<script lang="ts">
  import type { AudioFile } from '$lib/types';
  import { cn } from '$lib/utils';
  import { formatDuration, formatFileSize, formatChannels } from '$lib/utils/format';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import AudioLines from 'lucide-svelte/icons/audio-lines';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import CheckCircle from 'lucide-svelte/icons/check-circle';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import Clock from 'lucide-svelte/icons/clock';
  import FileAudio from 'lucide-svelte/icons/file-audio';
  import FileText from 'lucide-svelte/icons/file-text';
  import X from 'lucide-svelte/icons/x';

  interface AudioFileListProps {
    files: AudioFile[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onRemove: (id: string) => void;
    onCancel?: (id: string) => void;
    onViewResult?: (file: AudioFile) => void;
    disabled?: boolean;
  }

  let { 
    files, 
    selectedId, 
    onSelect, 
    onRemove,
    onCancel,
    onViewResult,
    disabled = false 
  }: AudioFileListProps = $props();

  function getStatusIcon(status: AudioFile['status']) {
    switch (status) {
      case 'transcribing':
        return { icon: Loader2, class: 'animate-spin text-primary' };
      case 'completed':
        return { icon: CheckCircle, class: 'text-green-500' };
      case 'error':
        return { icon: AlertCircle, class: 'text-destructive' };
      case 'scanning':
        return { icon: Loader2, class: 'animate-spin text-muted-foreground' };
      default:
        return null;
    }
  }
</script>

<div class="space-y-1">
  {#each files as file (file.id)}
    {@const isSelected = file.id === selectedId}
    {@const statusInfo = getStatusIcon(file.status)}
    {@const isTranscribing = file.status === 'transcribing'}
    <button
      class={cn(
        "w-full text-left p-3 rounded-lg border transition-colors",
        isSelected ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50"
      )}
      onclick={() => onSelect(file.id)}
    >
      <div class="flex items-start gap-3">
        <!-- Icon -->
        <div class="shrink-0 mt-0.5">
          {#if file.status === 'completed'}
            <CheckCircle class="size-5 text-green-500" />
          {:else if file.status === 'transcribing'}
            <Loader2 class="size-5 animate-spin text-primary" />
          {:else if file.status === 'error'}
            <AlertCircle class="size-5 text-destructive" />
          {:else}
            <FileAudio class="size-5 text-muted-foreground" />
          {/if}
        </div>
        
        <!-- Content -->
        <div class="flex-1 min-w-0">
          <p class="font-medium truncate text-sm">{file.name}</p>
          
          <div class="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
            {#if file.duration}
              <span class="flex items-center gap-1">
                <Clock class="size-3" />
                {formatDuration(file.duration)}
              </span>
            {/if}
            
            {#if file.format}
              <Badge variant="outline" class="text-[10px] px-1.5 py-0">
                {file.format.toUpperCase()}
              </Badge>
            {/if}
            
            {#if file.channels}
              <span>{formatChannels(file.channels)}</span>
            {/if}
            
            {#if file.size && file.size > 0}
              <span>{formatFileSize(file.size)}</span>
            {/if}
          </div>
          
          <!-- Progress bar during transcription -->
          {#if file.status === 'transcribing' && file.progress !== undefined}
            <div class="mt-2">
              <Progress value={file.progress} class="h-1.5" />
              <p class="text-xs text-muted-foreground mt-1">{file.progress}%</p>
            </div>
          {/if}
          
          <!-- Error message -->
          {#if file.status === 'error' && file.error}
            <p class="text-xs text-destructive mt-1 truncate" title={file.error}>
              {file.error}
            </p>
          {/if}
          
          <!-- Output path on completion -->
          {#if file.status === 'completed' && file.outputPath}
            <p class="text-xs text-green-600 mt-1 truncate" title={file.outputPath}>
              Output: {file.outputPath.split('/').pop()}
            </p>
          {/if}
        </div>
        
        <!-- Actions -->
        <div class="shrink-0 flex items-center gap-1">
          {#if file.status === 'completed' && file.outputPath && onViewResult}
            <Button 
              variant="ghost" 
              size="icon" 
              class="size-7 text-primary hover:text-primary"
              onclick={(e) => { 
                e.stopPropagation(); 
                onViewResult(file); 
              }}
              title="View result"
            >
              <FileText class="size-3.5" />
            </Button>
          {/if}
          
          {#if isTranscribing && onCancel}
            <Button 
              variant="ghost" 
              size="icon" 
              class="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
              onclick={(e) => { 
                e.stopPropagation(); 
                onCancel(file.id); 
              }}
              title="Cancel transcription"
            >
              <X class="size-3.5" />
            </Button>
          {:else}
            <Button 
              variant="ghost" 
              size="icon" 
              class="size-7"
              onclick={(e) => { 
                e.stopPropagation(); 
                onRemove(file.id); 
              }}
              disabled={disabled && !isTranscribing}
            >
              <Trash2 class="size-3.5" />
            </Button>
          {/if}
        </div>
      </div>
    </button>
  {/each}
  
  {#if files.length === 0}
    <div class="text-center py-8 text-muted-foreground">
      <AudioLines class="size-8 mx-auto mb-2 opacity-50" />
      <p class="text-sm">No audio files</p>
    </div>
  {/if}
</div>
