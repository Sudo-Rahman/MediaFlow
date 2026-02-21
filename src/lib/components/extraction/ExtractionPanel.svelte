<script lang="ts">
  import { Folder, Play, FolderOpen, Loader2, CheckCircle, X, CircleAlert } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Progress } from '$lib/components/ui/progress';
  import * as Card from '$lib/components/ui/card';
  import * as Alert from '$lib/components/ui/alert';
  import { formatTransferRate } from '$lib/utils';
  import type { ExtractionProgress } from '$lib/types';

  interface ExtractionPanelProps {
    outputDir: string;
    selectedCount: number;
    progress: ExtractionProgress;
    onSelectOutputDir?: () => void;
    onExtract?: () => void;
    onExtractAgain?: () => void;
    onOpenFolder?: () => void;
    onCancel?: () => void;
    isCancelling?: boolean;
    class?: string;
  }

  let {
    outputDir,
    selectedCount,
    progress,
    onSelectOutputDir,
    onExtract,
    onExtractAgain,
    onOpenFolder,
    onCancel,
    isCancelling = false,
    class: className = ''
  }: ExtractionPanelProps = $props();

  const isExtracting = $derived(progress.status === 'extracting');
  const isCompleted = $derived(progress.status === 'completed');
  const isCancelled = $derived(progress.status === 'cancelled');
  const canExtract = $derived(selectedCount > 0 && outputDir && !isExtracting);
</script>

<Card.Root class={className}>
  <Card.Header class="pb-3">
    <Card.Title class="text-base">Extraction</Card.Title>
    <Card.Description>Configure and run extraction</Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <!-- Output directory -->
    <div class="space-y-2">
      <span class="text-sm font-medium">Output folder</span>
      <div class="flex gap-2">
        <div class="flex-1 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm min-w-0">
          <Folder class="size-4 text-muted-foreground shrink-0" />
          <span class="truncate text-muted-foreground">
            {outputDir || 'No folder selected'}
          </span>
        </div>
        <Button variant="outline" size="icon" onclick={onSelectOutputDir}>
          <FolderOpen class="size-4" />
          <span class="sr-only">Browse</span>
        </Button>
      </div>
    </div>

    <!-- Selection summary -->
    <div class="rounded-md bg-muted/50 p-3 text-sm flex items-center justify-between">
      <span>Selected tracks</span>
      <Badge variant={selectedCount > 0 ? 'default' : 'secondary'}>
        {selectedCount}
      </Badge>
    </div>

    <!-- Progress -->
    {#if isExtracting || isCompleted || isCancelled}
      <div class="space-y-3">
        {#if isCompleted}
          <Alert.Root class="border-green-500/50 bg-green-500/10">
            <CheckCircle class="size-4 text-green-500" />
            <Alert.Title>Extraction complete!</Alert.Title>
            <Alert.Description>
              All tracks have been successfully extracted.
            </Alert.Description>
          </Alert.Root>
        {:else if isCancelled}
          <Alert.Root class="border-orange-500/50 bg-orange-500/10">
            <CircleAlert class="size-4 text-orange-500" />
            <Alert.Title>Extraction cancelled</Alert.Title>
            <Alert.Description>
              Active extraction was cancelled before completion.
            </Alert.Description>
          </Alert.Root>
        {:else}
          <div class="space-y-2 rounded-md border bg-muted/30 px-3 py-2">
            <p class="text-sm font-medium">Extracting...</p>
            {#if progress.currentFile}
              <p class="text-xs text-muted-foreground truncate">
                File {progress.currentFileIndex}/{progress.totalFiles}: {progress.currentFile}
              </p>
            {/if}
            <div class="space-y-1.5">
              <div class="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Track {Math.min(progress.completedTracks + 1, progress.totalTracks)}/{progress.totalTracks}</span>
                <span>{Math.round(progress.currentTrackProgress)}%</span>
              </div>
              <Progress value={progress.currentFileProgress} class="h-1.5" />
              <p class="text-[11px] text-muted-foreground">
                File progress: {Math.round(progress.currentFileProgress)}%
                {#if progress.currentSpeedBytesPerSec && progress.currentSpeedBytesPerSec > 0}
                  {' '}· {formatTransferRate(progress.currentSpeedBytesPerSec)}
                {/if}
              </p>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </Card.Content>
  <Card.Footer class="flex-col gap-2">
    {#if isCompleted}
      <Button class="w-full" variant="outline" onclick={onOpenFolder}>
        <FolderOpen class="size-4 mr-2" />
        Open folder
      </Button>
      <Button
        class="w-full"
        onclick={onExtractAgain}
        disabled={!canExtract}
      >
        <Play class="size-4 mr-2" />
        Extract again
      </Button>
    {:else if isExtracting}
      <Button
        class="w-full"
        variant="destructive"
        onclick={onCancel}
        disabled={!onCancel || isCancelling}
      >
        {#if isCancelling}
          <Loader2 class="size-4 mr-2 animate-spin" />
          Cancelling...
        {:else}
          <X class="size-4 mr-2" />
          Cancel extraction
        {/if}
      </Button>
    {:else}
      <Button
        class="w-full"
        onclick={onExtract}
        disabled={!canExtract}
      >
        <Play class="size-4 mr-2" />
        Extract ({selectedCount} track{selectedCount > 1 ? 's' : ''})
      </Button>
    {/if}
  </Card.Footer>
</Card.Root>
