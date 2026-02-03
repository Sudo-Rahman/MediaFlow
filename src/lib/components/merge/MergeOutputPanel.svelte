<script lang="ts">
  import { Folder, FolderOpen, Play, Loader2, CheckCircle } from '@lucide/svelte';
  import type { MergeOutputConfig } from '$lib/types';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Progress } from '$lib/components/ui/progress';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Card from '$lib/components/ui/card';
  import * as Alert from '$lib/components/ui/alert';
  ;
  ;
  ;
  ;
  ;

  interface MergeOutputPanelProps {
    outputConfig: MergeOutputConfig;
    enabledTracksCount: number;
    videosCount?: number;
    status: 'idle' | 'processing' | 'completed' | 'error';
    progress: number;
    onSelectOutputDir?: () => void;
    onOutputNameChange?: (name: string) => void;
    onMerge?: () => void;
    onOpenFolder?: () => void;
    class?: string;
  }

  let {
    outputConfig,
    enabledTracksCount,
    videosCount = 0,
    status,
    progress,
    onSelectOutputDir,
    onOutputNameChange,
    onMerge,
    onOpenFolder,
    class: className = ''
  }: MergeOutputPanelProps = $props();

  const isProcessing = $derived(status === 'processing');
  const isCompleted = $derived(status === 'completed');
  // Can merge if we have videos and an output path (attached tracks are optional - user may just want to modify metadata or remove tracks)
  const canMerge = $derived(
    videosCount > 0 &&
    outputConfig.outputPath &&
    !isProcessing
  );
</script>

<Card.Root class={className}>
  <Card.Header class="pb-3">
    <Card.Title class="text-base">Output</Card.Title>
    <Card.Description>Configure batch merge output</Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <!-- Output directory -->
    <div class="space-y-2">
      <Label>Output folder</Label>
      <div class="flex gap-2">
        <div class="flex-1 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm min-w-0">
          <Folder class="size-4 text-muted-foreground shrink-0" />
          <span class="truncate text-muted-foreground">
            {outputConfig.outputPath || 'No folder selected'}
          </span>
        </div>
        <Button variant="outline" size="icon" onclick={onSelectOutputDir}>
          <FolderOpen class="size-4" />
          <span class="sr-only">Browse</span>
        </Button>
      </div>
    </div>

    <!-- Use source filename -->
    <div class="flex items-center gap-3">
      <Checkbox
        id="use-source"
        checked={outputConfig.useSourceFilename}
        disabled
      />
      <Label for="use-source" class="font-normal text-sm">
        Keep original filename
      </Label>
    </div>

    <!-- Summary -->
    <div class="rounded-md bg-muted/50 p-3 space-y-2">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted-foreground">Videos to merge</span>
        <Badge variant={videosCount > 0 ? 'default' : 'secondary'}>
          {videosCount}
        </Badge>
      </div>
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted-foreground">Total tracks attached</span>
        <Badge variant={enabledTracksCount > 0 ? 'default' : 'secondary'}>
          {enabledTracksCount}
        </Badge>
      </div>
    </div>

    <!-- Progress -->
    {#if isProcessing || isCompleted}
      <div class="space-y-3">
        {#if isCompleted}
          <Alert.Root class="border-green-500/50 bg-green-500/10">
            <CheckCircle class="size-4 text-green-500" />
            <Alert.Title>Merge complete!</Alert.Title>
            <Alert.Description>
              All files have been merged successfully.
            </Alert.Description>
          </Alert.Root>
        {:else}
          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span class="text-muted-foreground">Merging...</span>
              <span class="font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} />
          </div>
        {/if}
      </div>
    {/if}
  </Card.Content>
  <Card.Footer class="flex flex-col gap-2">
    {#if isCompleted}
      <Button class="w-full" variant="outline" onclick={onOpenFolder}>
        <FolderOpen class="size-4 mr-2" />
        Open folder
      </Button>
      <Button
        class="w-full"
        onclick={onMerge}
        disabled={!canMerge}
      >
        <Play class="size-4 mr-2" />
        Merge again
      </Button>
    {:else}
      <Button
        class="w-full"
        onclick={onMerge}
        disabled={!canMerge}
      >
        {#if isProcessing}
          <Loader2 class="size-4 mr-2 animate-spin" />
          Merging...
        {:else}
          <Play class="size-4 mr-2" />
          Merge {videosCount} file{videosCount !== 1 ? 's' : ''}
        {/if}
      </Button>
    {/if}
  </Card.Footer>
</Card.Root>

