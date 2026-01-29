<script lang="ts">
  import { cn } from '$lib/utils';
  import AudioLines from 'lucide-svelte/icons/audio-lines';

  interface AudioDropZoneProps {
    onFilesSelected?: (paths: string[]) => void;
    class?: string;
    disabled?: boolean;
  }

  let { 
    onFilesSelected, 
    class: className = '',
    disabled = false 
  }: AudioDropZoneProps = $props();
  
  let isDragging = $state(false);
</script>

<div
  class={cn(
    "flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 transition-colors",
    isDragging && !disabled ? "border-primary bg-primary/5" : "border-muted-foreground/25",
    disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-muted-foreground/50",
    className
  )}
  role="button"
  tabindex={disabled ? -1 : 0}
  ondragover={(e) => { 
    e.preventDefault(); 
    if (!disabled) isDragging = true; 
  }}
  ondragleave={() => isDragging = false}
  ondrop={(e) => {
    e.preventDefault();
    isDragging = false;
  }}
>
  <div class="flex flex-col items-center text-center">
    <div class="relative mb-4">
      <AudioLines class="size-12 text-muted-foreground" />
    </div>
    
    <p class="text-lg font-medium text-muted-foreground">
      Drop audio files here
    </p>
    <p class="text-sm text-muted-foreground/70 mt-1">
      or click to browse
    </p>
    
    <div class="mt-4 px-4 py-2 bg-muted/50 rounded-md">
      <p class="text-xs text-muted-foreground/70">
        Supported formats: MP3, WAV, FLAC, AAC, OGG, M4A, OPUS
      </p>
    </div>
  </div>
</div>
