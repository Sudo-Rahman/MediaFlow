<script lang="ts">
  import type { OcrLogEntry } from '$lib/types/video-ocr';
  import { Button } from '$lib/components/ui/button';
  import { AlertCircle, Info, AlertTriangle, Trash2 } from '@lucide/svelte';
  import { cn } from '$lib/utils';

  interface OcrLogPanelProps {
    logs: OcrLogEntry[];
    onClear?: () => void;
    class?: string;
  }

  let {
    logs,
    onClear,
    class: className = '',
  }: OcrLogPanelProps = $props();

  function getIcon(level: OcrLogEntry['level']) {
    switch (level) {
      case 'error':
        return { icon: AlertCircle, class: 'text-destructive' };
      case 'warning':
        return { icon: AlertTriangle, class: 'text-yellow-500' };
      default:
        return { icon: Info, class: 'text-muted-foreground' };
    }
  }

  function formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  }

  const errorCount = $derived(logs.filter(l => l.level === 'error').length);
  const displayLogs = $derived(logs);
</script>

<div class={cn("border rounded-lg flex flex-col min-h-0", className)}>
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
    <div
      class="flex items-center gap-2 text-sm font-medium hover:text-foreground">
      <span>Activity Log</span>
      {#if errorCount > 0}
        <span class="text-xs bg-destructive text-white px-1.5 py-0.5 rounded-full">
          {errorCount} error{errorCount > 1 ? 's' : ''}
        </span>
      {/if}
    </div>
    
    {#if logs.length > 0 && onClear}
      <Button
        variant="ghost"
        size="icon"
        class="size-7"
        onclick={onClear}
        title="Clear logs"
      >
        <Trash2 class="size-3.5" />
      </Button>
    {/if}
  </div>
  
  <!-- Log entries -->
  <div class={cn(
    "overflow-y-auto flex-1 min-h-0 transition-all",
  )}>
      <div class="p-2 space-y-1">
        {#if displayLogs.length === 0}
          <p class="text-xs text-muted-foreground text-center py-4">
            No activity yet
          </p>
        {:else}
          {#each displayLogs as log (log.id)}
            {@const iconInfo = getIcon(log.level)}
            {@const Icon = iconInfo.icon}
            <div class="flex items-start gap-2 text-xs">
              <span class="text-muted-foreground shrink-0">
                {formatTime(log.timestamp)}
              </span>
              <Icon class={cn("size-3.5 shrink-0 mt-0.5", iconInfo.class)} />
              <span class={cn(
                "flex-1",
                log.level === 'error' && "text-destructive",
                log.level === 'warning' && "text-yellow-600"
              )}>
                {log.message}
              </span>
            </div>
          {/each}
        {/if}
      </div>
  </div>
</div>
