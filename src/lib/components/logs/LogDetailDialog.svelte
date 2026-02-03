<script lang="ts">
  import { CheckCircle, AlertCircle, AlertTriangle, Info, Copy, Check, FileText, Terminal } from '@lucide/svelte';
  import type { LogEntry } from '$lib/stores/logs.svelte';
  import { getSourceColor, getLevelColor } from '$lib/stores/logs.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  import { toast } from 'svelte-sonner';

  interface LogDetailDialogProps {
    log: LogEntry | null | undefined;
    open: boolean;
    onClose?: () => void;
  }

  let { log, open, onClose }: LogDetailDialogProps = $props();

  let copiedField = $state<string | null>(null);

  function getLevelIcon(level: LogEntry['level']) {
    switch (level) {
      case 'error': return AlertCircle;
      case 'warning': return AlertTriangle;
      case 'success': return CheckCircle;
      case 'info': return Info;
      default: return Info;
    }
  }

  function formatDateTime(date: Date): string {
    return date.toLocaleString('en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  async function copyToClipboard(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedField = field;
      setTimeout(() => {
        copiedField = null;
      }, 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }

  function copyAll() {
    if (!log) return;
    
    const parts = [
      `Level: ${log.level.toUpperCase()}`,
      `Source: ${log.source}`,
      `Time: ${formatDateTime(log.timestamp)}`,
      `Title: ${log.title}`,
      '',
      'Details:',
      log.details
    ];

    if (log.context?.filePath) {
      parts.push('', `File: ${log.context.filePath}`);
    }
    if (log.context?.command) {
      parts.push('', 'Command:', log.context.command);
    }
    if (log.context?.provider) {
      parts.push('', `Provider: ${log.context.provider}`);
    }
    if (log.context?.apiError) {
      parts.push('', 'API Error:', log.context.apiError);
    }

    copyToClipboard(parts.join('\n'), 'all');
  }
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => { if (!isOpen) onClose?.(); }}>
  <Dialog.Content class="max-w-2xl max-h-[85vh] overflow-scroll flex flex-col">
    {#if log}
      {@const Icon = getLevelIcon(log.level)}
      
      <Dialog.Header>
        <div class="flex items-center gap-3">
          <div class="shrink-0 p-2 rounded-lg {getLevelColor(log.level)} bg-current/10">
            <Icon class="size-5 {getLevelColor(log.level)}" />
          </div>
          <div class="flex-1 min-w-0">
            <Dialog.Title class="text-lg">{log.title}</Dialog.Title>
            <div class="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline" class="text-xs capitalize {getSourceColor(log.source)}">
                {log.source}
              </Badge>
              <span class="text-xs text-muted-foreground">
                {formatDateTime(log.timestamp)}
              </span>
            </div>
          </div>
        </div>
      </Dialog.Header>

      <ScrollArea class="flex-1 -mx-6 px-6">
        <div class="space-y-4 py-4">
          <!-- Details -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">Details</span>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 text-xs"
                onclick={() => copyToClipboard(log.details, 'details')}
              >
                {#if copiedField === 'details'}
                  <Check class="size-3 mr-1" />
                  Copied
                {:else}
                  <Copy class="size-3 mr-1" />
                  Copy
                {/if}
              </Button>
            </div>
            <div class="rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap break-all max-h-48 overflow-auto">
              {log.details}
            </div>
          </div>

          <!-- Context: File Path -->
          {#if log.context?.filePath}
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <FileText class="size-4 text-muted-foreground" />
                <span class="text-sm font-medium">File</span>
              </div>
              <div class="rounded-lg bg-muted p-3 font-mono text-sm break-all">
                {log.context.filePath}
              </div>
            </div>
          {/if}

          <!-- Context: Command -->
          {#if log.context?.command}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <Terminal class="size-4 text-muted-foreground" />
                  <span class="text-sm font-medium">Command</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 text-xs"
                  onclick={() => copyToClipboard(log.context!.command!, 'command')}
                >
                  {#if copiedField === 'command'}
                    <Check class="size-3 mr-1" />
                    Copied
                  {:else}
                    <Copy class="size-3 mr-1" />
                    Copy
                  {/if}
                </Button>
              </div>
              <div class="rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all max-h-32 overflow-auto">
                {log.context.command}
              </div>
            </div>
          {/if}

          <!-- Context: Provider -->
          {#if log.context?.provider}
            <div class="space-y-2">
              <span class="text-sm font-medium">Provider</span>
              <div class="rounded-lg bg-muted p-3 font-mono text-sm">
                {log.context.provider}
              </div>
            </div>
          {/if}

          <!-- Context: API Error -->
          {#if log.context?.apiError}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-destructive">API Error</span>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 text-xs"
                  onclick={() => copyToClipboard(log.context!.apiError!, 'apiError')}
                >
                  {#if copiedField === 'apiError'}
                    <Check class="size-3 mr-1" />
                    Copied
                  {:else}
                    <Copy class="size-3 mr-1" />
                    Copy
                  {/if}
                </Button>
              </div>
              <div class="rounded-lg bg-destructive/10 border border-destructive/30 p-3 font-mono text-sm whitespace-pre-wrap break-all max-h-48 overflow-auto">
                {log.context.apiError}
              </div>
            </div>
          {/if}

          <!-- Context: Output Path -->
          {#if log.context?.outputPath}
            <div class="space-y-2">
              <span class="text-sm font-medium">Output Path</span>
              <div class="rounded-lg bg-muted p-3 font-mono text-sm break-all">
                {log.context.outputPath}
              </div>
            </div>
          {/if}

          <!-- Context: Track Index -->
          {#if log.context?.trackIndex !== undefined}
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">Track Index:</span>
              <Badge variant="outline">{log.context.trackIndex}</Badge>
            </div>
          {/if}
        </div>
      </ScrollArea>

      <Dialog.Footer class="gap-2">
        <Button variant="outline" onclick={copyAll}>
          {#if copiedField === 'all'}
            <Check class="size-4 mr-2" />
            Copied All
          {:else}
            <Copy class="size-4 mr-2" />
            Copy All
          {/if}
        </Button>
        <Button onclick={() => onClose?.()}>
          Close
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
