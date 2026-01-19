<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import * as Alert from '$lib/components/ui/alert';
  import type { ExtractionProgress } from '$lib/types';
  import Folder from 'lucide-svelte/icons/folder';
  import Play from 'lucide-svelte/icons/play';
  import FolderOpen from 'lucide-svelte/icons/folder-open';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import CheckCircle from 'lucide-svelte/icons/check-circle';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';

  interface ExtractionPanelProps {
    outputDir: string;
    selectedCount: number;
    progress: ExtractionProgress;
    onSelectOutputDir?: () => void;
    onExtract?: () => void;
    onExtractAgain?: () => void;
    onOpenFolder?: () => void;
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
    class: className = ''
  }: ExtractionPanelProps = $props();

  const isExtracting = $derived(progress.status === 'extracting');
  const isCompleted = $derived(progress.status === 'completed');
  const canExtract = $derived(selectedCount > 0 && outputDir && !isExtracting);

  const progressPercent = $derived(() => {
    if (progress.totalTracks === 0) return 0;
    const fileProgress = (progress.currentFileIndex - 1) / progress.totalFiles;
    const trackProgress = progress.currentTrack / progress.totalTracks / progress.totalFiles;
    return Math.round((fileProgress + trackProgress) * 100);
  });
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
    {#if isExtracting || isCompleted}
      <div class="space-y-3">
        {#if isCompleted}
          <Alert.Root class="border-green-500/50 bg-green-500/10">
            <CheckCircle class="size-4 text-green-500" />
            <Alert.Title>Extraction complete!</Alert.Title>
            <Alert.Description>
              All tracks have been successfully extracted.
            </Alert.Description>
          </Alert.Root>
        {:else}
          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span class="text-muted-foreground">Extracting...</span>
              <span class="font-medium">{progressPercent()}%</span>
            </div>
            <Progress value={progressPercent()} />
            {#if progress.currentFile}
              <p class="text-xs text-muted-foreground truncate">
                File {progress.currentFileIndex}/{progress.totalFiles}: {progress.currentFile}
              </p>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Error message -->
    {#if progress.error}
      <Alert.Root variant="destructive">
        <AlertCircle class="size-4" />
        <Alert.Title>Error</Alert.Title>
        <Alert.Description>{progress.error}</Alert.Description>
      </Alert.Root>
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
    {:else}
      <Button
        class="w-full"
        onclick={onExtract}
        disabled={!canExtract}
      >
        {#if isExtracting}
          <Loader2 class="size-4 mr-2 animate-spin" />
          Extracting...
        {:else}
          <Play class="size-4 mr-2" />
          Extract ({selectedCount} track{selectedCount > 1 ? 's' : ''})
        {/if}
      </Button>
    {/if}
  </Card.Footer>
</Card.Root>

