<script lang="ts">
  import { ArrowRight, Trash2, CheckCircle, XCircle, AlertTriangle, Loader2 } from '@lucide/svelte';
  import { getBaseName, getExtension, getFileNameFromPath } from '$lib/services/rename';
  import { cn } from '$lib/utils';
  import { formatTransferRate } from '$lib/utils/format';
  import type { RenameFile } from '$lib/types/rename';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Button } from '$lib/components/ui/button';
  import * as Empty from '$lib/components/ui/empty';
  import { Progress } from '$lib/components/ui/progress';
  import * as Tooltip from '$lib/components/ui/tooltip';

  interface RenameTableProps {
    files: RenameFile[];
    allSelected?: boolean;
    someSelected?: boolean;
    currentProcessingFileId?: string;
    currentProcessingProgress?: number;
    currentProcessingSpeedBytesPerSec?: number;
    onToggleSelection?: (id: string) => void;
    onToggleAll?: () => void;
    onRemove?: (id: string) => void;
    getTargetPath?: (file: RenameFile) => string;
    class?: string;
  }

  let { 
    files, 
    allSelected = false,
    someSelected = false,
    currentProcessingFileId,
    currentProcessingProgress = 0,
    currentProcessingSpeedBytesPerSec,
    onToggleSelection, 
    onToggleAll,
    onRemove,
    getTargetPath,
    class: className = '' 
  }: RenameTableProps = $props();

  function hasChanged(file: RenameFile): boolean {
    if (getTargetPath) {
      return getTargetPath(file) !== file.originalPath;
    }

    return file.originalName !== file.newName;
  }

  function getTargetDetails(file: RenameFile): { path: string; name: string; extension: string } {
    if (!getTargetPath) {
      return {
        path: `${file.newName}${file.extension}`,
        name: file.newName,
        extension: file.extension,
      };
    }

    const path = getTargetPath(file);
    const filename = getFileNameFromPath(path);

    return {
      path,
      name: getBaseName(filename),
      extension: getExtension(filename),
    };
  }

  function getStatusInfo(file: RenameFile) {
    switch (file.status) {
      case 'success':
        return { icon: CheckCircle, class: 'text-green-500', tooltip: 'Renamed successfully' };
      case 'error':
        return { icon: XCircle, class: 'text-destructive', tooltip: file.error || 'Error' };
      case 'cancelled':
        return { icon: XCircle, class: 'text-orange-500', tooltip: file.error || 'Cancelled' };
      case 'conflict':
        return { icon: AlertTriangle, class: 'text-yellow-500', tooltip: 'Name conflict' };
      case 'processing':
        return { icon: Loader2, class: 'text-primary animate-spin', tooltip: 'Processing...' };
      default:
        return null;
    }
  }
</script>

<div class={cn('flex flex-col h-full overflow-hidden', className)}>
  <!-- Table header -->
  <div class="flex items-center gap-3 px-3 py-2 border-b bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">
    <div class="w-5 flex justify-center">
      <Checkbox
        checked={allSelected}
        indeterminate={someSelected && !allSelected}
        onCheckedChange={() => onToggleAll?.()}
        aria-label="Select all"
      />
    </div>
    <div class="flex-1 min-w-0">Original</div>
    <div class="w-6 flex justify-center">
      <ArrowRight class="size-3.5" />
    </div>
    <div class="flex-1 min-w-0">New Name</div>
    <div class="w-14"></div>
  </div>

  <!-- Table body -->
  <div class="flex-1 overflow-y-auto overflow-x-hidden">
    {#each files as file (file.id)}
      {@const changed = hasChanged(file)}
      {@const target = getTargetDetails(file)}
      {@const status = getStatusInfo(file)}
      {@const isCurrentProcessingRow = file.id === currentProcessingFileId && file.status === 'processing'}
      {@const processingProgressValue = Math.min(100, Math.max(0, currentProcessingProgress))}
      <div
        class={cn(
          'border-b border-border/50 transition-colors',
          !file.selected && 'opacity-50',
          file.status === 'conflict' && 'bg-yellow-500/5',
          file.status === 'error' && 'bg-destructive/5',
          file.status === 'cancelled' && 'bg-orange-500/5',
          file.status === 'success' && 'bg-green-500/5',
        )}
      >
        <div class="flex items-center gap-3 px-3 py-2 hover:bg-muted/30">
          <!-- Checkbox -->
          <div class="w-5 flex justify-center shrink-0">
            <Checkbox
              checked={file.selected}
              onCheckedChange={() => onToggleSelection?.(file.id)}
              aria-label={`Select ${file.originalName}${file.extension}`}
            />
          </div>

          <!-- Original name -->
          <div class="flex-1 min-w-0">
            <Tooltip.Root>
              <Tooltip.Trigger class="block w-full text-left">
                <p class={cn(
                  'text-sm truncate font-mono',
                  !file.selected && 'text-muted-foreground'
                )}>
                  {file.originalName}<span class="text-muted-foreground/70">{file.extension}</span>
                </p>
              </Tooltip.Trigger>
              <Tooltip.Content side="top" class="max-w-md">
                <p class="break-all font-mono text-xs">{file.originalPath}</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>

          <!-- Arrow -->
          <div class="w-6 flex justify-center shrink-0">
            <ArrowRight class={cn(
              'size-3.5',
              changed && file.selected ? 'text-primary' : 'text-muted-foreground/30'
            )} />
          </div>

          <!-- New name -->
          <div class="flex-1 min-w-0">
            <Tooltip.Root>
              <Tooltip.Trigger class="block w-full text-left">
                <p class={cn(
                  'text-sm truncate font-mono',
                  !file.selected && 'text-muted-foreground',
                  changed && file.selected && 'text-primary font-medium'
                )}>
                  {target.name}<span class="text-muted-foreground/70">{target.extension}</span>
                </p>
              </Tooltip.Trigger>
              <Tooltip.Content side="top" class="max-w-md">
                <p class="break-all font-mono text-xs">{target.path}</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>

          <!-- Status + Delete -->
          <div class="w-14 flex items-center justify-end gap-1 shrink-0">
            {#if status}
              {@const Icon = status.icon}
              <Tooltip.Root>
                <Tooltip.Trigger>
                  <Icon class={cn('size-4', status.class)} />
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <p class="text-xs">{status.tooltip}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            {/if}
            
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
              onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove?.(file.id); }}
            >
              <Trash2 class="size-3.5" />
              <span class="sr-only">Remove</span>
            </Button>
          </div>
        </div>

        {#if isCurrentProcessingRow}
          <div class="px-10 pb-2 pr-3">
            <Progress value={processingProgressValue} class="h-1.5" />
            <p class="mt-1 text-[11px] text-muted-foreground">
              Copying: {Math.round(processingProgressValue)}%
              {#if currentProcessingSpeedBytesPerSec && currentProcessingSpeedBytesPerSec > 0}
                · {formatTransferRate(currentProcessingSpeedBytesPerSec)}
              {/if}
            </p>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Empty state -->
  {#if files.length === 0}
    <Empty.Root class="flex-1 border-0 py-8">
      <Empty.Description>No files to display</Empty.Description>
    </Empty.Root>
  {/if}
</div>
