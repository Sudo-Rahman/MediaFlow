<script lang="ts">
  import { FileText, Trash2, CheckCircle, Loader2, AlertCircle, Languages, RotateCw, X, Square } from '@lucide/svelte';
  import type { TranslationJob } from '$lib/types';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import { FileItemCard } from '$lib/components/shared';

  interface TranslationFileListProps {
    jobs: TranslationJob[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onRemove: (id: string) => void;
    onCancel?: (id: string) => void;
    onViewResult?: (job: TranslationJob) => void;
    onRetry?: (job: TranslationJob) => void;
    disabled?: boolean;
  }

  let {
    jobs,
    selectedId,
    onSelect,
    onRemove,
    onCancel,
    onViewResult,
    onRetry,
    disabled = false,
  }: TranslationFileListProps = $props();

  function isProcessing(status: TranslationJob['status']): boolean {
    return status === 'translating';
  }
</script>

<div class="space-y-2">
  {#each jobs as job (job.id)}
    {@const isSelected = job.id === selectedId}
    {@const processing = isProcessing(job.status)}
    {@const versionCount = job.translationVersions?.length ?? 0}
    {@const hasModelJobs = !!job.modelJobs && job.modelJobs.length > 0}
    {@const completedModels = hasModelJobs ? job.modelJobs!.filter(mj => mj.status === 'completed').length : 0}
    {@const totalModels = hasModelJobs ? job.modelJobs!.length : 0}
    <FileItemCard selected={isSelected} onclick={() => onSelect(job.id)}>
      {#snippet icon()}
        {#if job.status === 'completed'}
          <CheckCircle class="size-5 text-green-500" />
        {:else if processing}
          <Loader2 class="size-5 animate-spin text-primary" />
        {:else if job.status === 'error'}
          <AlertCircle class="size-5 text-destructive" />
        {:else}
          <FileText class="size-5 text-muted-foreground" />
        {/if}
      {/snippet}

      {#snippet content()}
        <p class="font-medium text-sm truncate">{job.file.name}</p>

        <div class="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
          <Badge variant="outline" class="text-[10px] px-1.5 py-0 uppercase">
            {job.file.format}
          </Badge>
          {#if processing && hasModelJobs}
            <span>{completedModels}/{totalModels} models complete</span>
          {:else if processing}
            <span>{job.progress}%</span>
            {#if job.totalBatches > 1}
              <span class="text-muted-foreground">
                (Batch {job.currentBatch}/{job.totalBatches})
              </span>
            {/if}
          {/if}
        </div>

        {#if processing}
          <div class="mt-2">
            <Progress value={job.progress} class="h-1.5" />
          </div>
        {/if}

        {#if job.status === 'error' && job.error}
          <p class="text-xs text-destructive mt-1 truncate" title={job.error}>
            {job.error}
          </p>
        {/if}
      {/snippet}

      {#snippet actions()}
        <div class="flex flex-col items-end gap-1">
          <div class="flex items-center gap-1">
            {#if versionCount > 0 && onViewResult}
              <Button
                variant="ghost"
                size="icon"
                class="size-7 text-primary hover:text-primary"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onViewResult(job);
                }}
                title="View results"
              >
                <FileText class="size-3.5" />
              </Button>
            {/if}

            {#if (job.status === 'error' || job.status === 'completed' || job.status === 'cancelled') && onRetry && !processing}
              <Button
                variant="ghost"
                size="icon"
                class="size-7 text-orange-500 hover:text-orange-600 hover:bg-orange-500/10"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onRetry(job);
                }}
                disabled={disabled}
                title="Retry"
              >
                <RotateCw class="size-3.5" />
              </Button>
            {/if}

            {#if processing && onCancel}
              <Button
                variant="ghost"
                size="icon"
                class="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onCancel(job.id);
                }}
                title="Cancel"
              >
                <X class="size-3.5" />
              </Button>
            {:else}
              <Button
                variant="ghost"
                size="icon"
                class="size-7"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onRemove(job.id);
                }}
                disabled={disabled}
                title="Remove"
              >
                <Trash2 class="size-3.5" />
              </Button>
            {/if}
          </div>

          {#if versionCount > 0}
            <Badge variant="secondary" class="text-[10px] px-1.5 py-0">
              {versionCount} version{versionCount > 1 ? 's' : ''}
            </Badge>
          {/if}
        </div>
      {/snippet}
    </FileItemCard>
  {/each}

  {#if jobs.length === 0}
    <div class="text-center py-8 text-muted-foreground">
      <Languages class="size-8 mx-auto mb-2 opacity-50" />
      <p class="text-sm">No subtitle files</p>
    </div>
  {/if}
</div>
