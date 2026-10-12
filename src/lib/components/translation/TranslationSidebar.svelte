<script lang="ts">
  import { FileText, Languages, Play, Square, Trash2 } from '@lucide/svelte';

  import { ToolImportButton } from '$lib/components/shared';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import type { TranslationJob } from '$lib/types';
  import { getToolImportPolicy } from '$lib/types/import-policy';
  import type { ImportSourceId } from '$lib/types/tool-import';

  import TranslationConfigPanel from './TranslationConfigPanel.svelte';
  import TranslationFileList from './TranslationFileList.svelte';

  interface TranslationSidebarProps {
    jobs: TranslationJob[];
    selectedJobId: string | null;
    hasFiles: boolean;
    isTranslating: boolean;
    canTranslate: boolean;
    translateAllTargetCount: number;
    batchCount: number;
    onSelectJob: (jobId: string) => void;
    onRequestRemoveJob: (jobId: string) => void;
    onRequestRemoveAll: () => void;
    onCancelJob: (jobId: string) => void;
    onOpenResult: (job: TranslationJob) => void;
    onRetryJob: (job: TranslationJob) => void;
    onImportClick: () => void | Promise<void>;
    onImportFolders: () => void | Promise<void>;
    onImportFromSource: (sourceId: ImportSourceId) => void | Promise<void>;
    onBatchCountChange: (value: number) => void;
    onTranslateAll: () => void | Promise<void>;
    onCancelAll: () => void;
    onNavigateToSettings?: () => void;
  }

  let {
    jobs,
    selectedJobId,
    hasFiles,
    isTranslating,
    canTranslate,
    translateAllTargetCount,
    batchCount,
    onSelectJob,
    onRequestRemoveJob,
    onRequestRemoveAll,
    onCancelJob,
    onOpenResult,
    onRetryJob,
    onImportClick,
    onImportFolders,
    onImportFromSource,
    onBatchCountChange,
    onTranslateAll,
    onCancelAll,
    onNavigateToSettings,
  }: TranslationSidebarProps = $props();

  const jobCount = $derived(jobs.length);
  const subtitleFormats = getToolImportPolicy('translate').formatLabel;

  function handleBatchInput(event: Event): void {
    const value = parseInt((event.currentTarget as HTMLInputElement).value, 10);
    onBatchCountChange(Number.isFinite(value) ? value : 1);
  }
</script>

<div class="flex-1 max-w-100 border-r flex flex-col min-h-0">
  <div class="flex-1 min-h-0 overflow-y-auto p-4">
    <div class="space-y-4 pb-4">
      <Card.Root class={hasFiles ? '' : 'pb-0'}>
        <Card.Header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <FileText class="size-5 text-primary" />
              <Card.Title>Subtitle Files</Card.Title>
              {#if jobCount > 0}
                <Badge variant="secondary">{jobCount}</Badge>
              {/if}
            </div>

            <div class="flex items-center gap-2">
              {#if jobCount > 0}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onclick={onRequestRemoveAll}
                  class="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 class="size-4" />
                  <span class="sr-only">Clear all</span>
                </Button>
              {/if}

              <ToolImportButton
                targetTool="translate"
                label="Import"
                variant="outline"
                onBrowse={onImportClick}
                onBrowseFolders={onImportFolders}
                onSelectSource={onImportFromSource}
                disabled={isTranslating}
              />
            </div>
          </div>
        </Card.Header>

        <Card.Content class="p-2">
          {#if hasFiles}
            <div class="px-3">
              <TranslationFileList
                jobs={jobs}
                selectedId={selectedJobId}
                onSelect={onSelectJob}
                onRemove={onRequestRemoveJob}
                onCancel={onCancelJob}
                onViewResult={onOpenResult}
                onRetry={onRetryJob}
                disabled={isTranslating}
              />
            </div>
          {:else}
            <ImportDropZone
              icon={Languages}
              title="Drop subtitle files here"
              formats={subtitleFormats}
              onBrowse={onImportClick}
              disabled={isTranslating}
            />
          {/if}
        </Card.Content>
      </Card.Root>

      <TranslationConfigPanel onNavigateToSettings={onNavigateToSettings} />

      <Card.Root>
        <Card.Header class="pb-3">
          <Card.Title class="text-sm">Batch Settings</Card.Title>
        </Card.Header>
        <Card.Content class="space-y-3">
          <div class="space-y-2">
            <Label for="batch-count" class="text-xs">Number of batches</Label>
            <Input
              id="batch-count"
              type="number"
              min="1"
              max="20"
              value={batchCount}
              oninput={handleBatchInput}
              class="h-8"
            />
            <p class="text-xs text-muted-foreground">
              Split file into N parts to avoid token limits (1 = no split)
            </p>
          </div>
        </Card.Content>
      </Card.Root>

      <div class="flex gap-2 pt-2">
        {#if isTranslating}
          <Button variant="destructive" class="flex-1" onclick={onCancelAll}>
            <Square class="size-4 mr-2" />
            Cancel All
          </Button>
        {:else}
          <Button
            size="lg"
            class="flex-1"
            onclick={onTranslateAll}
            disabled={!canTranslate}
          >
            <Play class="size-4 mr-2" />
            Translate ({translateAllTargetCount})
          </Button>
        {/if}
      </div>
    </div>
  </div>
</div>
