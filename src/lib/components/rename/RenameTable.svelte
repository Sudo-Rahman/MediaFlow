<script lang="ts">
  import { ArrowRight, Trash2, CheckCircle, XCircle, AlertTriangle, Loader2 } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import type { RenameFile } from '$lib/types/rename';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  ;
  ;
  ;
  ;
  ;
  ;

  interface RenameTableProps {
    files: RenameFile[];
    allSelected?: boolean;
    someSelected?: boolean;
    onToggleSelection?: (id: string) => void;
    onToggleAll?: () => void;
    onRemove?: (id: string) => void;
    class?: string;
  }

  let { 
    files, 
    allSelected = false,
    someSelected = false,
    onToggleSelection, 
    onToggleAll,
    onRemove,
    class: className = '' 
  }: RenameTableProps = $props();

  function hasChanged(file: RenameFile): boolean {
    return file.originalName !== file.newName;
  }

  function getStatusInfo(file: RenameFile) {
    switch (file.status) {
      case 'success':
        return { icon: CheckCircle, class: 'text-green-500', tooltip: 'Renamed successfully' };
      case 'error':
        return { icon: XCircle, class: 'text-destructive', tooltip: file.error || 'Error' };
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
      {@const status = getStatusInfo(file)}
      <div
        class={cn(
          'flex items-center gap-3 px-3 py-2 border-b border-border/50 transition-colors',
          'hover:bg-muted/30',
          !file.selected && 'opacity-50',
          file.status === 'conflict' && 'bg-yellow-500/5',
          file.status === 'error' && 'bg-destructive/5',
          file.status === 'success' && 'bg-green-500/5',
        )}
      >
        <!-- Checkbox -->
        <div class="w-5 flex justify-center shrink-0">
          <Checkbox
            checked={file.selected}
            onCheckedChange={() => onToggleSelection?.(file.id)}
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
                {file.newName}<span class="text-muted-foreground/70">{file.extension}</span>
              </p>
            </Tooltip.Trigger>
            <Tooltip.Content side="top" class="max-w-md">
              <p class="break-all font-mono text-xs">{file.newName}{file.extension}</p>
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
    {/each}
  </div>

  <!-- Empty state -->
  {#if files.length === 0}
    <div class="flex-1 flex items-center justify-center text-muted-foreground">
      <p class="text-sm">No files to display</p>
    </div>
  {/if}
</div>
