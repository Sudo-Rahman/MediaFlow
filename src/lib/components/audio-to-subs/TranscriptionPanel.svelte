<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import type { TranscriptionConfig, WhisperModel } from '$lib/types';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select';
  import { Badge } from '$lib/components/ui/badge';
  import { Separator } from '$lib/components/ui/separator';
  import { Progress } from '$lib/components/ui/progress';
  import * as Alert from '$lib/components/ui/alert';
  import ModelSelector from './ModelSelector.svelte';
  import LanguageSelector from './LanguageSelector.svelte';
  import Play from 'lucide-svelte/icons/play';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import FolderOpen from 'lucide-svelte/icons/folder-open';
  import Download from 'lucide-svelte/icons/download';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import CheckCircle from 'lucide-svelte/icons/check-circle';
  import Languages from 'lucide-svelte/icons/languages';
  import FileText from 'lucide-svelte/icons/file-text';
  import Captions from 'lucide-svelte/icons/captions';

  interface TranscriptionPanelProps {
    config: TranscriptionConfig;
    outputDir: string;
    downloadedModels: Set<WhisperModel>;
    whisperInstalled: boolean | null;
    isTranscribing: boolean;
    isDownloadingModel: boolean;
    downloadProgress: number;
    readyFilesCount: number;
    completedFilesCount: number;
    totalFilesCount: number;
    onConfigChange: (updates: Partial<TranscriptionConfig>) => void;
    onOutputDirChange: (dir: string) => void;
    onTranscribe: () => void;
    onTranscribeAll: () => void;
    onDownloadModel: (model: WhisperModel) => void;
    onNavigateToSettings?: () => void;
    class?: string;
  }

  let {
    config,
    outputDir,
    downloadedModels,
    whisperInstalled,
    isTranscribing,
    isDownloadingModel,
    downloadProgress,
    readyFilesCount,
    completedFilesCount,
    totalFilesCount,
    onConfigChange,
    onOutputDirChange,
    onTranscribe,
    onTranscribeAll,
    onDownloadModel,
    onNavigateToSettings,
    class: className = ''
  }: TranscriptionPanelProps = $props();

  const isModelDownloaded = $derived(downloadedModels.has(config.model));
  
  const canTranscribe = $derived(
    readyFilesCount > 0 && 
    !isTranscribing && 
    outputDir.length > 0 &&
    whisperInstalled === true &&
    isModelDownloaded
  );

  const outputFormats = [
    { value: 'srt', label: 'SRT', description: 'SubRip subtitle format' },
    { value: 'vtt', label: 'VTT', description: 'WebVTT format' },
    { value: 'json', label: 'JSON', description: 'Word-level timestamps' },
  ] as const;

  async function handleBrowseOutput() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select output directory'
    });
    if (selected && typeof selected === 'string') {
      onOutputDirChange(selected);
    }
  }
</script>

<div class={cn("h-full flex flex-col overflow-auto", className)}>
  <!-- Whisper Status -->
  {#if whisperInstalled === false}
    <div class="p-4">
      <Alert.Root variant="destructive" class="shrink-0">
        <AlertCircle class="size-4" />
        <Alert.Title>Whisper not installed</Alert.Title>
        <Alert.Description>
          Please install whisper.cpp to use this feature.
          <Button variant="link" class="p-0 h-auto" onclick={onNavigateToSettings}>
            See Settings
          </Button>
        </Alert.Description>
      </Alert.Root>
    </div>
  {:else if whisperInstalled === null}
    <div class="p-4 flex items-center gap-2 text-muted-foreground">
      <Loader2 class="size-4 animate-spin" />
      <span class="text-sm">Checking whisper installation...</span>
    </div>
  {/if}

  <div class="p-4 space-y-6 flex-1">
    <!-- Model Selection -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-sm">Whisper Model</Card.Title>
      </Card.Header>
      <Card.Content class="space-y-4">
        <ModelSelector
          value={config.model}
          {downloadedModels}
          onValueChange={(model) => onConfigChange({ model })}
          disabled={isTranscribing}
        />

        {#if !isModelDownloaded}
          <div class="space-y-2">
            {#if isDownloadingModel}
              <div class="space-y-2">
                <Progress value={downloadProgress} class="h-2" />
                <p class="text-xs text-muted-foreground text-center">
                  Downloading... {downloadProgress}%
                </p>
              </div>
            {:else}
              <Button
                variant="outline"
                size="sm"
                class="w-full"
                onclick={() => onDownloadModel(config.model)}
                disabled={isTranscribing}
              >
                <Download class="size-4 mr-2" />
                Download {config.model} model
              </Button>
            {/if}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Language -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-sm">Language</Card.Title>
      </Card.Header>
      <Card.Content class="space-y-4">
        <LanguageSelector
          value={config.language}
          onValueChange={(language) => onConfigChange({ language })}
          disabled={isTranscribing}
        />

        <!-- Translate to English -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label class="text-sm">Translate to English</Label>
            <p class="text-xs text-muted-foreground">
              Translate non-English audio to English
            </p>
          </div>
          <Switch
            checked={config.translate}
            onCheckedChange={(checked) => onConfigChange({ translate: checked })}
            disabled={isTranscribing || config.language === 'en'}
          />
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Output Format -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-sm">Output</Card.Title>
      </Card.Header>
      <Card.Content class="space-y-4">
        <!-- Format -->
        <div class="space-y-2">
          <Label class="text-sm">Format</Label>
          <Select.Root
            type="single"
            value={config.outputFormat}
            onValueChange={(v) => v && onConfigChange({ outputFormat: v as TranscriptionConfig['outputFormat'] })}
            disabled={isTranscribing}
          >
            <Select.Trigger class="w-full">
              <div class="flex items-center gap-2">
                <Captions class="size-4 text-muted-foreground" />
                <span>{config.outputFormat.toUpperCase()}</span>
              </div>
            </Select.Trigger>
            <Select.Content>
              {#each outputFormats as format (format.value)}
                <Select.Item value={format.value} label={format.label}>
                  <div class="flex items-center justify-between w-full">
                    <span>{format.label}</span>
                    <span class="text-xs text-muted-foreground">{format.description}</span>
                  </div>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <!-- Word timestamps -->
        {#if config.outputFormat === 'json'}
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label class="text-sm">Word-level timestamps</Label>
              <p class="text-xs text-muted-foreground">
                Get timing for each word
              </p>
            </div>
            <Switch
              checked={config.wordTimestamps}
              onCheckedChange={(checked) => onConfigChange({ wordTimestamps: checked })}
              disabled={isTranscribing}
            />
          </div>
        {/if}

        <Separator />

        <!-- Output directory -->
        <div class="space-y-2">
          <Label class="text-sm">Output Directory</Label>
          <div class="flex gap-2">
            <Input
              value={outputDir}
              placeholder="Select output directory"
              readonly
              class="flex-1"
            />
            <Button 
              variant="outline" 
              size="icon"
              onclick={handleBrowseOutput}
              disabled={isTranscribing}
            >
              <FolderOpen class="size-4" />
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card.Root>
  </div>

  <!-- Actions -->
  <div class="p-4 border-t shrink-0 space-y-3">
    <!-- Status summary -->
    {#if totalFilesCount > 0}
      <div class="flex items-center justify-between text-sm text-muted-foreground">
        <span>{readyFilesCount} ready</span>
        {#if completedFilesCount > 0}
          <span class="text-green-500">{completedFilesCount} completed</span>
        {/if}
      </div>
    {/if}

    <!-- Transcribe buttons -->
    <Button
      class="w-full"
      disabled={!canTranscribe}
      onclick={onTranscribeAll}
    >
      {#if isTranscribing}
        <Loader2 class="size-4 mr-2 animate-spin" />
        Transcribing...
      {:else}
        <Play class="size-4 mr-2" />
        Transcribe All ({readyFilesCount})
      {/if}
    </Button>

    {#if !canTranscribe && !isTranscribing}
      <p class="text-xs text-muted-foreground text-center">
        {#if !whisperInstalled}
          Install whisper.cpp to continue
        {:else if !isModelDownloaded}
          Download the model first
        {:else if readyFilesCount === 0}
          Add audio files to transcribe
        {:else if !outputDir}
          Select an output directory
        {/if}
      </p>
    {/if}
  </div>
</div>
