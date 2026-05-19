<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Trash2, Search, AlertTriangle, X, ArrowUpDown, ArrowUp, ArrowDown, FileText } from '@lucide/svelte';

  import type { RenameWorkspaceStore } from '$lib/stores/rename.svelte';
  import type { SortField } from '$lib/types/rename';
  import type { ImportSourceId, ToolId } from '$lib/types/tool-import';

  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import * as Empty from '$lib/components/ui/empty';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import { ToolImportButton } from '$lib/components/shared';
  import RenameTable from './RenameTable.svelte';
  import RenameRuleEditor from './RenameRuleEditor.svelte';

  interface RenameWorkspaceProps {
    workspace: RenameWorkspaceStore;
    showImportButton?: boolean;
    importTargetTool?: ToolId;
    onBrowseImport?: () => void | Promise<void>;
    onSelectImportSource?: (sourceId: ImportSourceId) => void | Promise<void>;
    onClearAll?: () => void;
    onRemoveFile?: (id: string) => void;
    emptyStateTitle?: string;
    emptyStateFormats?: string;
    emptyStateSubtitle?: string;
    actionPanel?: Snippet;
    class?: string;
  }

  let {
    workspace,
    showImportButton = true,
    importTargetTool,
    onBrowseImport,
    onSelectImportSource,
    onClearAll,
    onRemoveFile,
    emptyStateTitle = 'Drop files here',
    emptyStateFormats = 'All files',
    emptyStateSubtitle = 'or click to browse',
    actionPanel,
    class: className = '',
  }: RenameWorkspaceProps = $props();

  function handleSearchChange(event: Event) {
    const target = event.target as HTMLInputElement;
    workspace.setSearchQuery(target.value);
  }

  function handleAddRule(type: import('$lib/types/rename').RuleType) {
    workspace.addRule(type);
  }

  function handleRemoveRule(id: string) {
    workspace.removeRule(id);
  }

  function handleToggleRule(id: string) {
    workspace.toggleRule(id);
  }

  function handleDuplicateRule(id: string) {
    workspace.duplicateRule(id);
  }

  function handleUpdateRuleConfig(id: string, config: import('$lib/types/rename').RuleConfig) {
    workspace.updateRuleConfig(id, config);
  }

  function handleClearRules() {
    workspace.clearRules();
  }

  function handleReorderRules(newRules: import('$lib/types/rename').RenameRule[]) {
    workspace.reorderRules(newRules);
  }

  function handleToggleAll() {
    if (allSelected) {
      workspace.deselectAll();
    } else {
      workspace.selectAll();
    }
  }

  function handleSort(field: SortField) {
    if (currentSort.field === field) {
      workspace.toggleSortDirection();
    } else {
      workspace.setSort(field, 'asc');
    }
  }

  function handleClearAllClick() {
    if (onClearAll) {
      onClearAll();
      return;
    }

    workspace.clear();
  }

  function handleRemoveFileClick(id: string) {
    if (onRemoveFile) {
      onRemoveFile(id);
      return;
    }

    workspace.removeFile(id);
  }

  const files = $derived(workspace.filteredFiles);
  const rules = $derived(workspace.rules);
  const progress = $derived(workspace.progress);
  const selectedCount = $derived(workspace.selectedCount);
  const totalCount = $derived(workspace.files.length);
  const hasConflicts = $derived(workspace.hasConflicts);
  const conflictCount = $derived(workspace.conflictCount);
  const currentSort = $derived(workspace.sortConfig);
  const allSelected = $derived(totalCount > 0 && selectedCount === totalCount);
  const someSelected = $derived(selectedCount > 0 && selectedCount < totalCount);

  const SORT_LABELS: Record<SortField, string> = {
    name: 'Name',
    size: 'Size',
    date: 'Date',
  };
</script>

<div class={`h-full flex overflow-hidden ${className}`.trim()}>
  <div class="flex-1 flex flex-col overflow-hidden">
    <div class="p-3 border-b shrink-0 flex items-center gap-3">
      {#if showImportButton && importTargetTool && onBrowseImport}
        <ToolImportButton
          targetTool={importTargetTool}
          label="Add Files"
          onBrowse={onBrowseImport}
          onSelectSource={onSelectImportSource}
        />
      {/if}

      <div class="relative flex-1 max-w-xs">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={workspace.searchQuery}
          oninput={handleSearchChange}
          aria-label="Search files"
          class="pl-8 h-8"
        />
        {#if workspace.searchQuery}
          <button
            type="button"
            aria-label="Clear search"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onclick={() => workspace.setSearchQuery('')}
          >
            <X class="size-4" />
          </button>
        {/if}
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button variant="outline" size="sm" {...props} class="gap-1.5">
              <ArrowUpDown class="size-3.5" />
              {SORT_LABELS[currentSort.field]}
              {#if currentSort.direction === 'asc'}
                <ArrowUp class="size-3" />
              {:else}
                <ArrowDown class="size-3" />
              {/if}
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="w-40">
          <DropdownMenu.Label>Sort by</DropdownMenu.Label>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onclick={() => handleSort('name')}>
            Name
            {#if currentSort.field === 'name'}
              {#if currentSort.direction === 'asc'}
                <ArrowUp class="size-3 ml-auto" />
              {:else}
                <ArrowDown class="size-3 ml-auto" />
              {/if}
            {/if}
          </DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => handleSort('size')}>
            Size
            {#if currentSort.field === 'size'}
              {#if currentSort.direction === 'asc'}
                <ArrowUp class="size-3 ml-auto" />
              {:else}
                <ArrowDown class="size-3 ml-auto" />
              {/if}
            {/if}
          </DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => handleSort('date')}>
            Date
            {#if currentSort.field === 'date'}
              {#if currentSort.direction === 'asc'}
                <ArrowUp class="size-3 ml-auto" />
              {:else}
                <ArrowDown class="size-3 ml-auto" />
              {/if}
            {/if}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <div class="flex-1"></div>

      <div class="flex items-center gap-2">
        {#if hasConflicts}
          <Badge variant="destructive" class="gap-1">
            <AlertTriangle class="size-3" />
            {conflictCount} conflict{conflictCount > 1 ? 's' : ''}
          </Badge>
        {/if}

        <span class="text-sm text-muted-foreground">
          {selectedCount} / {totalCount} selected
        </span>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onclick={handleClearAllClick}
        class="text-muted-foreground hover:text-destructive"
        disabled={totalCount === 0}
      >
        <Trash2 class="size-4 mr-1.5" />
        Clear
      </Button>
    </div>

    <div class="flex-1 min-h-0 overflow-hidden">
      {#if totalCount === 0}
        <div class="h-full p-2">
          {#if onBrowseImport}
            <ImportDropZone
              icon={FileText}
              title={emptyStateTitle}
              formats={emptyStateFormats}
              subtitle={emptyStateSubtitle}
              onBrowse={onBrowseImport}
              class="h-full"
            />
          {:else}
            <Empty.Root class="h-full border border-muted-foreground/25">
              <Empty.Header>
                <Empty.Media variant="icon" class="size-16 rounded-full">
                  <FileText class="size-8 text-muted-foreground" />
                </Empty.Media>
                <Empty.Title class="text-lg text-muted-foreground">{emptyStateTitle}</Empty.Title>
                <Empty.Description>{emptyStateSubtitle}</Empty.Description>
              </Empty.Header>
            </Empty.Root>
          {/if}
        </div>
      {:else}
        <RenameTable
          {files}
          {allSelected}
          {someSelected}
          currentProcessingFileId={progress.currentFileId}
          currentProcessingProgress={workspace.mode === 'copy' ? progress.currentFileProgress : undefined}
          currentProcessingSpeedBytesPerSec={workspace.mode === 'copy' ? progress.currentSpeedBytesPerSec : undefined}
          onToggleSelection={(id) => workspace.toggleFileSelection(id)}
          onToggleAll={handleToggleAll}
          onRemove={handleRemoveFileClick}
          getTargetPath={(file) => workspace.getTargetPath(file)}
          class="h-full"
        />
      {/if}
    </div>
  </div>

  <div class="w-96 border-l flex flex-col overflow-hidden shrink-0">
    <RenameRuleEditor
      {workspace}
      {rules}
      onAddRule={handleAddRule}
      onRemoveRule={handleRemoveRule}
      onToggleRule={handleToggleRule}
      onDuplicateRule={handleDuplicateRule}
      onUpdateRuleConfig={handleUpdateRuleConfig}
      onReorderRules={handleReorderRules}
      onClearRules={handleClearRules}
      class="flex-1 min-h-0 overflow-hidden"
    />

    {#if actionPanel}
      <div class="p-4 border-t shrink-0 space-y-4 bg-background">
        {@render actionPanel()}
      </div>
    {/if}
  </div>
</div>
