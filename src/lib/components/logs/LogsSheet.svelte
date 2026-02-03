<script lang="ts">
  import { ScrollText, Trash2, Search, X, Filter, CheckCheck } from '@lucide/svelte';
  import { logStore, type LogLevel, type LogSource } from '$lib/stores/logs.svelte';
  import * as Sheet from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import * as Select from '$lib/components/ui/select';
  import LogList from './LogList.svelte';
  import LogDetailDialog from './LogDetailDialog.svelte';

  ;
  ;
  ;
  ;
  ;
  ;

  // Dialog for detail view
  let detailDialogOpen = $state(false);

  const sourceOptions: { value: LogSource | 'all'; label: string }[] = [
    { value: 'all', label: 'All Sources' },
    { value: 'ffmpeg', label: 'FFmpeg' },
    { value: 'ffprobe', label: 'FFprobe' },
    { value: 'translation', label: 'Translation' },
    { value: 'merge', label: 'Merge' },
    { value: 'extraction', label: 'Extraction' },
    { value: 'rename', label: 'Rename' },
    { value: 'system', label: 'System' }
  ];

  const levelOptions: { value: LogLevel | 'all'; label: string }[] = [
    { value: 'all', label: 'All Levels' },
    { value: 'error', label: 'Errors' },
    { value: 'warning', label: 'Warnings' },
    { value: 'success', label: 'Success' },
    { value: 'info', label: 'Info' }
  ];

  function handleSourceChange(value: string | undefined) {
    logStore.setSourceFilter(value === 'all' || !value ? null : value as LogSource);
  }

  function handleLevelChange(value: string | undefined) {
    logStore.setLevelFilter(value === 'all' || !value ? null : value as LogLevel);
  }

  function handleSelectLog(log: { id: string }) {
    logStore.selectLog(log.id);
    detailDialogOpen = true;
  }

  function handleCloseDetail() {
    detailDialogOpen = false;
    logStore.clearSelection();
  }

  function handleClearLogs() {
    logStore.clearLogs();
  }

  function handleMarkAllRead() {
    logStore.markAllAsRead();
  }

  const hasFilters = $derived(
    logStore.sourceFilter !== null ||
    logStore.levelFilter !== null ||
    logStore.searchQuery.trim() !== ''
  );

  const errorCount = $derived(logStore.logs.filter(l => l.level === 'error').length);
  const warningCount = $derived(logStore.logs.filter(l => l.level === 'warning').length);
</script>

<Sheet.Root open={logStore.isOpen} onOpenChange={(isOpen) => { if (isOpen) logStore.open(); else logStore.close(); }}>
  <Sheet.Content side="right" class="w-full sm:max-w-xl flex flex-col">
    <Sheet.Header class="shrink-0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <ScrollText class="size-5 text-primary" />
          <Sheet.Title>Logs</Sheet.Title>
          <Badge variant="secondary">{logStore.logs.length}</Badge>
          {#if errorCount > 0}
            <Badge variant="destructive">{errorCount} error{errorCount > 1 ? 's' : ''}</Badge>
          {/if}
        </div>
        <div class="flex items-center gap-1">
          {#if logStore.unreadErrorCount > 0}
            <Button
              variant="ghost"
              size="sm"
              onclick={handleMarkAllRead}
              title="Mark all as read"
            >
              <CheckCheck class="size-4" />
            </Button>
          {/if}
          {#if logStore.logs.length > 0}
            <Button
              variant="ghost"
              size="sm"
              onclick={handleClearLogs}
              class="text-muted-foreground hover:text-destructive"
              title="Clear all logs"
            >
              <Trash2 class="size-4" />
            </Button>
          {/if}
        </div>
      </div>
      <Sheet.Description>
        View all application logs and errors
      </Sheet.Description>
    </Sheet.Header>

    <!-- Filters -->
    <div class="shrink-0 space-y-3 p-4 border-b">
      <!-- Search -->
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search logs..."
          value={logStore.searchQuery}
          oninput={(e) => logStore.setSearchQuery(e.currentTarget.value)}
          class="pl-9 pr-9"
        />
        {#if logStore.searchQuery}
          <Button
            variant="ghost"
            size="icon"
            class="absolute right-1 top-1/2 -translate-y-1/2 size-7"
            onclick={() => logStore.setSearchQuery('')}
          >
            <X class="size-3" />
          </Button>
        {/if}
      </div>

      <!-- Dropdowns -->
      <div class="flex gap-2">
        <Select.Root
          type="single"
          value={logStore.sourceFilter || 'all'}
          onValueChange={handleSourceChange}
        >
          <Select.Trigger class="flex-1">
            <Filter class="size-4 mr-2 text-muted-foreground" />
            {sourceOptions.find(o => o.value === (logStore.sourceFilter || 'all'))?.label || 'All Sources'}
          </Select.Trigger>
          <Select.Content>
            {#each sourceOptions as option}
              <Select.Item value={option.value}>{option.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>

        <Select.Root
          type="single"
          value={logStore.levelFilter || 'all'}
          onValueChange={handleLevelChange}
        >
          <Select.Trigger class="flex-1">
            {levelOptions.find(o => o.value === (logStore.levelFilter || 'all'))?.label || 'All Levels'}
          </Select.Trigger>
          <Select.Content>
            {#each levelOptions as option}
              <Select.Item value={option.value}>{option.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>

        {#if hasFilters}
          <Button variant="ghost" size="icon" onclick={() => logStore.clearFilters()}>
            <X class="size-4" />
          </Button>
        {/if}
      </div>

      {#if hasFilters}
        <p class="text-xs text-muted-foreground">
          Showing {logStore.filteredLogs.length} of {logStore.logs.length} logs
        </p>
      {/if}
    </div>

    <!-- Log List -->
    <div class="flex-1 min-h-0">
      <LogList
        logs={logStore.filteredLogs}
        selectedLogId={logStore.selectedLogId}
        onSelectLog={handleSelectLog}
        class="h-full px-4"
      />
    </div>
  </Sheet.Content>
</Sheet.Root>

<!-- Detail Dialog -->
<LogDetailDialog
  log={logStore.selectedLog}
  open={detailDialogOpen}
  onClose={handleCloseDetail}
/>
