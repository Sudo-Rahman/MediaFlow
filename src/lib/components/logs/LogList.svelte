<script lang="ts">
  import { CheckCircle, AlertCircle, AlertTriangle, Info, ExternalLink, Circle } from '@lucide/svelte';
  import type { LogEntry } from '$lib/stores/logs.svelte';
  import { getSourceColor, getLevelColor, getLevelBgColor } from '$lib/stores/logs.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import * as Empty from '$lib/components/ui/empty';
  import * as Item from '$lib/components/ui/item';
  import { cn } from '$lib/utils';
  import { getFileName } from '$lib/utils/format';


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
    <Empty.Root class="flex-1 border-0 text-muted-foreground">
      <Empty.Header>
        <Empty.Media class="opacity-30">
          <Info class="size-12" />
        </Empty.Media>
        <Empty.Title class="text-base">No logs yet</Empty.Title>
        <Empty.Description>Logs will appear here as operations are performed</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {:else}
    <div class="flex-1 overflow-scroll">
      <div class="flex flex-col gap-1 p-2">
        {#each logs as log (log.id)}
          {@const Icon = getLevelIcon(log.level)}
          {@const isSelected = selectedLogId === log.id}
          <Item.Root
            size="sm"
            variant="outline"
            class={cn(
              'items-start text-left hover:bg-muted/70',
              getLevelBgColor(log.level),
              isSelected && 'ring-2 ring-primary',
              !log.read && log.level === 'error' && 'border-l-4 border-l-destructive'
            )}
          >
            {#snippet child({ props })}
              <button {...props} type="button" onclick={() => onSelectLog?.(log)}>
                <Item.Media class="mt-0.5">
                  <Icon class="size-4 {getLevelColor(log.level)}" />
                </Item.Media>

                <Item.Content class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-medium text-sm line-clamp-1">{log.title}</span>
                    {#if !log.read && log.level === 'error'}
                      <Circle class="size-2 fill-destructive text-destructive" />
                    {/if}
                  </div>

                  {#if log.details}
                    <p class="text-xs text-muted-foreground line-clamp-2 break-words">
                      {log.details}
                    </p>
                  {/if}

                  <div class="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" class="text-xs capitalize {getSourceColor(log.source)}">
                      {log.source}
                    </Badge>
                    <span class="text-xs text-muted-foreground">
                      {formatDate(log.timestamp)}
                    </span>
                    {#if log.context?.filePath}
                      <span class="text-xs text-muted-foreground truncate max-w-32" title={log.context.filePath}>
                        {getFileName(log.context.filePath)}
                      </span>
                    {/if}
                  </div>
                </Item.Content>

                <Item.Actions class="shrink-0">
                  <ExternalLink class="size-4 text-muted-foreground" />
                </Item.Actions>
              </button>
            {/snippet}
          </Item.Root>
        {/each}
      </div>
    </div>
  {/if}
</div>
