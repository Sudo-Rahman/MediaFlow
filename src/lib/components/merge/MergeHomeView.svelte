<script lang="ts">
  import { ChevronDown, Layers, Plus, Sparkles, Trash2, Video, Wand2 } from '@lucide/svelte';

  import { mergeStore } from '$lib/stores';
  import type { ImportSourceId } from '$lib/types/tool-import';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import { MergeFileList, MergeImportTracksPanel, MergeOutputPanel, MergeSourceTracksPanel } from '$lib/components/merge';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import * as ButtonGroup from '$lib/components/ui/button-group';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { ToolImportButton } from '$lib/components/shared';

  interface Props {
    autoMatchMode: 'classic' | 'ai';
    videoFormats: string[];
    selectedMergeSourcePaths: string[];
    selectedTracksToMergeCount: number;
    selectedVideosToMergeCount: number;
    currentFileName: string;
    currentFileProgress: number;
    currentSpeedBytesPerSec?: number | null;
    completedFiles: number;
    status: 'idle' | 'processing' | 'completed' | 'error';
    isProcessing: boolean;
    isCancelling: boolean;
    currentProcessingPath: string | null;
    onAddVideoFiles: () => void | Promise<void>;
    onAddVideoFolders: () => void | Promise<void>;
    onRequestClearAll: () => void;
    onSelectVideo: (fileId: string) => void;
    onCancelFile: (fileId: string) => void | Promise<void>;
    onRequestRemoveFile: (fileId: string) => void;
    onAutoMatch: () => void;
    onAutoMatchModeChange: (mode: 'classic' | 'ai') => void;
    onEditSourceTrack: (trackId: string) => void;
    onAddTrackFiles: () => void | Promise<void>;
    onAddTrackFolders: () => void | Promise<void>;
    onEditImportedTrack: (trackId: string) => void;
    onImportFromSource: (sourceId: ImportSourceId) => void | Promise<void>;
    onSelectOutputDir: () => void | Promise<void>;
    onClearOutputDir: () => void;
    onEditOutputNames: () => void;
    onMerge: () => void | Promise<void>;
    onOpenFolder: () => void | Promise<void>;
    onCancelAll: () => void | Promise<void>;
  }

  let {
    autoMatchMode,
    videoFormats,
    selectedMergeSourcePaths,
    selectedTracksToMergeCount,
    selectedVideosToMergeCount,
    currentFileName,
    currentFileProgress,
    currentSpeedBytesPerSec,
    completedFiles,
    status,
    isProcessing,
    isCancelling,
    currentProcessingPath,
    onAddVideoFiles,
    onAddVideoFolders,
    onRequestClearAll,
    onSelectVideo,
    onCancelFile,
    onRequestRemoveFile,
    onAutoMatch,
    onAutoMatchModeChange,
    onEditSourceTrack,
    onAddTrackFiles,
    onAddTrackFolders,
    onEditImportedTrack,
    onImportFromSource,
    onSelectOutputDir,
    onClearOutputDir,
    onEditOutputNames,
    onMerge,
    onOpenFolder,
    onCancelAll,
  }: Props = $props();
</script>

<div class="h-full flex overflow-hidden">
  <div class="w-[max(20rem,25vw)] max-w-lg border-r flex flex-col overflow-hidden">
    <div class="p-3 border-b shrink-0 flex items-center justify-between">
      <h2 class="font-semibold">Videos ({mergeStore.videoFiles.length})</h2>
      <div class="flex gap-1">
        {#if mergeStore.videoFiles.length > 0}
          <Button
            variant="ghost"
            size="icon-sm"
            onclick={onRequestClearAll}
            class="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 class="size-4" />
            <span class="sr-only">Clear all videos</span>
          </Button>
        {/if}
        <ToolImportButton
          targetTool="merge"
          sourceFilter={[]}
          onBrowse={onAddVideoFiles}
          onBrowseFolders={onAddVideoFolders}
          disabled={isProcessing}
        />
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-auto p-2">
      {#if mergeStore.videoFiles.length === 0}
        <ImportDropZone
          icon={Video}
          title="Drop video files here"
          formats={videoFormats}
          onBrowse={onAddVideoFiles}
        />
      {:else}
        <MergeFileList
          files={mergeStore.videoFiles}
          selectedId={mergeStore.selectedVideoId}
          fileRunStates={mergeStore.fileRunStates}
          {isProcessing}
          {currentProcessingPath}
          onSelect={onSelectVideo}
          onCancelFile={onCancelFile}
          onRemove={onRequestRemoveFile}
          showAddButton={false}
        />
      {/if}
    </div>
  </div>

  <div class="flex-1 flex flex-col overflow-hidden">
    <Tabs.Root value="source" class="flex-1 flex flex-col overflow-hidden">
      <ScrollArea orientation="horizontal" class="border-b bg-background">
        <div class="flex w-max min-w-full items-center justify-between gap-4 p-2.5">
          <Tabs.List class="shrink-0">
            <Tabs.Trigger value="source" class="flex items-center gap-1.5">
              <Layers class="size-4" />
              Source
            </Tabs.Trigger>
            <Tabs.Trigger value="import" class="flex items-center gap-1.5">
              <Plus class="size-4" />
              Import
              {#if mergeStore.unassignedTracks.length > 0}
                <Badge variant="secondary" class="text-xs ml-1">{mergeStore.unassignedTracks.length}</Badge>
              {/if}
            </Tabs.Trigger>
          </Tabs.List>

          <div class="flex shrink-0 gap-2">
            {#if mergeStore.importedTracks.length > 0 && mergeStore.videoFiles.length > 0}
              <ButtonGroup.Root class="shrink-0" aria-label="Auto-match controls">
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="outline"
                        size="sm"
                        class="h-8 min-w-0 px-2.5"
                        onclick={onAutoMatch}
                      >
                        {#if autoMatchMode === 'classic'}
                          <Wand2 class="size-4 shrink-0 min-[1120px]:mr-1.5" />
                          <span class="hidden min-[1120px]:inline">Auto-match</span>
                          <span class="min-[1120px]:hidden">Auto</span>
                        {:else}
                          <Sparkles class="size-4 shrink-0 min-[1120px]:mr-1.5" />
                          <span class="hidden min-[1120px]:inline">AI match</span>
                          <span class="min-[1120px]:hidden">AI</span>
                        {/if}
                      </Button>
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    {autoMatchMode === 'classic'
                      ? 'Match tracks to videos by episode number'
                      : 'Open the AI match workspace'}
                  </Tooltip.Content>
                </Tooltip.Root>
                <ButtonGroup.Separator />
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="outline"
                        size="icon-sm"
                        class="h-8 w-8"
                        title="Choose auto-match mode"
                      >
                        <ChevronDown class="size-4" />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" class="w-44">
                    <DropdownMenu.Label>Auto-match mode</DropdownMenu.Label>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onclick={() => onAutoMatchModeChange('classic')}>
                      <div class="flex items-center gap-2">
                        <Wand2 class="size-4" />
                        Classic
                      </div>
                      {#if autoMatchMode === 'classic'}
                        <Badge variant="secondary" class="ml-auto text-[10px]">Active</Badge>
                      {/if}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => onAutoMatchModeChange('ai')}>
                      <div class="flex items-center gap-2">
                        <Sparkles class="size-4" />
                        AI
                      </div>
                      {#if autoMatchMode === 'ai'}
                        <Badge variant="secondary" class="ml-auto text-[10px]">Active</Badge>
                      {/if}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </ButtonGroup.Root>
            {/if}
          </div>
        </div>
      </ScrollArea>

      <Tabs.Content value="source" class="flex-1 min-h-0 overflow-auto p-4 mt-0">
        <MergeSourceTracksPanel onEditTrack={onEditSourceTrack} />
      </Tabs.Content>

      <Tabs.Content value="import" class="flex-1 min-h-0 overflow-auto p-4 mt-0">
        <MergeImportTracksPanel
          onAddTrackFiles={onAddTrackFiles}
          onAddTrackFolders={onAddTrackFolders}
          onEditImportedTrack={onEditImportedTrack}
          onImportFromSource={onImportFromSource}
        />
      </Tabs.Content>
    </Tabs.Root>
  </div>

  <div class="w-80 border-l p-4 overflow-auto">
    <MergeOutputPanel
      outputConfig={mergeStore.outputConfig}
      sourcePaths={selectedMergeSourcePaths}
      enabledTracksCount={selectedTracksToMergeCount}
      videosCount={selectedVideosToMergeCount}
      {completedFiles}
      {status}
      onSelectOutputDir={onSelectOutputDir}
      onClearOutputDir={onClearOutputDir}
      onEditOutputNames={onEditOutputNames}
      onMerge={onMerge}
      onOpenFolder={onOpenFolder}
      onCancel={onCancelAll}
      {isCancelling}
      {currentFileName}
      {currentFileProgress}
      currentSpeedBytesPerSec={currentSpeedBytesPerSec ?? undefined}
    />
  </div>
</div>
