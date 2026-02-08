<script lang="ts">
  import { CheckCircle, AlertCircle, AlertTriangle, Info, ExternalLink, Circle } from '@lucide/svelte';
  import type { LogEntry } from '$lib/stores/logs.svelte';
  import { getSourceColor, getLevelColor, getLevelBgColor } from '$lib/stores/logs.svelte';
  import { Badge } from '$lib/components/ui/badge';


  interface LogListProps {
    logs: LogEntry[];
    selectedLogId?: string | null;
    onSelectLog?: (log: LogEntry) => void;
    class?: string;
  }

  let {
    logs,
    selectedLogId = null,
    onSelectLog,
    class: className = ''
  }: LogListProps = $props();

  function getLevelIcon(level: LogEntry['level']) {
    switch (level) {
      case 'error': return AlertCircle;
      case 'warning': return AlertTriangle;
      case 'success': return CheckCircle;
      case 'info': return Info;
      default: return Info;
    }
  }

  function formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function formatDate(date: Date): string {
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    
    if (isToday) {
      return formatTime(date);
    }
    
    return date.toLocaleDateString('en-US', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
</script>

<div class="flex flex-col h-full {className}">
  {#if logs.length === 0}
    <div class="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground py-12">
      <Info class="size-12 mb-4 opacity-30" />
      <p class="font-medium">No logs yet</p>
      <p class="text-sm">Logs will appear here as operations are performed</p>
    </div>
  {:else}
    <div class="flex-1 overflow-scroll">
      <div class="space-y-1 p-2">
        {#each logs as log (log.id)}
          {@const Icon = getLevelIcon(log.level)}
          {@const isSelected = selectedLogId === log.id}
          <button
            class="w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all hover:bg-accent/50 {getLevelBgColor(log.level)} {isSelected ? 'ring-2 ring-primary' : ''} {!log.read && log.level === 'error' ? 'border-l-4 border-l-destructive' : ''}"
            onclick={() => onSelectLog?.(log)}
          >
            <!-- Level icon -->
            <div class="shrink-0 mt-0.5">
              <Icon class="size-4 {getLevelColor(log.level)}" />
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0 space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-sm line-clamp-1">{log.title}</span>
                {#if !log.read && log.level === 'error'}
                  <Circle class="size-2 fill-destructive text-destructive" />
                {/if}
              </div>

              <div class="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" class="text-xs capitalize {getSourceColor(log.source)}">
                  {log.source}
                </Badge>
                <span class="text-xs text-muted-foreground">
                  {formatDate(log.timestamp)}
                </span>
                {#if log.context?.filePath}
                  <span class="text-xs text-muted-foreground truncate max-w-32" title={log.context.filePath}>
                    {log.context.filePath.split('/').pop() || log.context.filePath.split('\\').pop()}
                  </span>
                {/if}
              </div>
            </div>

            <!-- View button -->
            <div class="shrink-0">
              <ExternalLink class="size-4 text-muted-foreground" />
            </div>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
