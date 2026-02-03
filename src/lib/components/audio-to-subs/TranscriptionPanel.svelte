<script lang="ts">
  import { Play, Loader2, Settings2, Users, Key, Download, FolderOpen, CheckCircle } from '@lucide/svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { writeTextFile } from '@tauri-apps/plugin-fs';
  import { join } from '@tauri-apps/api/path';
  import type { TranscriptionConfig, DeepgramConfig, AudioFile, TranscriptionOutputFormat } from '$lib/types';
  import { formatToSRT, formatToVTT, formatToJSON } from '$lib/services/deepgram';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import { Slider } from '$lib/components/ui/slider';
  import { Separator } from '$lib/components/ui/separator';
  import * as Alert from '$lib/components/ui/alert';
  import * as Select from '$lib/components/ui/select';
  import { Input } from '$lib/components/ui/input';
  import { toast } from 'svelte-sonner';
  import ModelSelector from './ModelSelector.svelte';
  import LanguageSelector from './LanguageSelector.svelte';
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;

  interface TranscriptionPanelProps {
    config: TranscriptionConfig;
    apiKeyConfigured: boolean;
    isTranscribing: boolean;
    isTranscoding: boolean;
    readyFilesCount: number;
    completedFilesCount: number;
    totalFilesCount: number;
    transcodingCount: number;
    completedFiles: AudioFile[];
    allFilesCompleted: boolean;
    onDeepgramConfigChange: (updates: Partial<DeepgramConfig>) => void;
    onTranscribeAll: () => void;
    onNavigateToSettings?: () => void;
    class?: string;
  }

  let {
    config,
    apiKeyConfigured,
    isTranscribing,
    isTranscoding,
    readyFilesCount,
    completedFilesCount,
    totalFilesCount,
    transcodingCount,
    completedFiles,
    allFilesCompleted,
    onDeepgramConfigChange,
    onTranscribeAll,
    onNavigateToSettings,
    class: className = ''
  }: TranscriptionPanelProps = $props();

  const canTranscribe = $derived(
    readyFilesCount > 0 && 
    !isTranscribing && 
    !isTranscoding &&
    apiKeyConfigured
  );

  // Export All state
  let exportFormat = $state<TranscriptionOutputFormat>('srt');
  let outputDir = $state('');
  let isExporting = $state(false);

  const filesWithVersions = $derived(
    completedFiles.filter(f => f.transcriptionVersions.length > 0)
  );

  const canExport = $derived(filesWithVersions.length > 0 && outputDir.length > 0 && !isExporting);

  const totalVersions = $derived(
    filesWithVersions.reduce((sum, f) => sum + f.transcriptionVersions.length, 0)
  );

  async function handleBrowseOutput() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select output folder'
    });
    if (selected && typeof selected === 'string') {
      outputDir = selected;
    }
  }

  function sanitizeVersionName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }

  async function handleExportAll() {
    if (!canExport) return;

    isExporting = true;
    let successCount = 0;
    let failCount = 0;

    const extensions: Record<TranscriptionOutputFormat, string> = {
      srt: 'srt',
      vtt: 'vtt',
      json: 'json'
    };
    const ext = extensions[exportFormat];

    try {
      for (const file of filesWithVersions) {
        const baseName = file.name.replace(/\.[^/.]+$/, '');

        for (const version of file.transcriptionVersions) {
          try {
            let content: string;
            switch (exportFormat) {
              case 'srt':
                content = formatToSRT(version.result);
                break;
              case 'vtt':
                content = formatToVTT(version.result);
                break;
              case 'json':
                content = JSON.stringify(formatToJSON(version.result), null, 2);
                break;
            }

            const versionSuffix = sanitizeVersionName(version.name);
            const fileName = `${baseName}_${versionSuffix}.${ext}`;
            const filePath = await join(outputDir, fileName);

            await writeTextFile(filePath, content);
            successCount++;
          } catch (error) {
            console.error(`Failed to export ${file.name} - ${version.name}:`, error);
            failCount++;
          }
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} file(s) exported`);
      }
      if (failCount > 0) {
        toast.error(`${failCount} file(s) failed`);
      }
    } finally {
      isExporting = false;
    }
  }
</script>

<div class={cn("h-full flex flex-col overflow-auto", className)}>
  <!-- API Key Status -->
  {#if !apiKeyConfigured}
    <div class="p-4">
      <Alert.Root variant="destructive" class="shrink-0">
        <Key class="size-4" />
        <Alert.Title>Deepgram API Key Required</Alert.Title>
        <Alert.Description>
          Please configure your Deepgram API key to use this feature.
          <Button variant="link" class="p-0 h-auto" onclick={onNavigateToSettings}>
            Go to Settings
          </Button>
        </Alert.Description>
      </Alert.Root>
    </div>
  {/if}

  <div class="p-4 space-y-6 flex-1">
    <!-- Model Selection -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-sm">Model</Card.Title>
      </Card.Header>
      <Card.Content>
        <ModelSelector
          value={config.deepgramConfig.model}
          onValueChange={(model) => onDeepgramConfigChange({ model })}
          disabled={isTranscribing}
        />
      </Card.Content>
    </Card.Root>

    <!-- Language -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-sm">Language</Card.Title>
      </Card.Header>
      <Card.Content>
        <LanguageSelector
          value={config.deepgramConfig.language}
          onValueChange={(language) => onDeepgramConfigChange({ language })}
          disabled={isTranscribing}
        />
      </Card.Content>
    </Card.Root>

    <!-- Deepgram Options -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-sm flex items-center gap-2">
          <Settings2 class="size-4" />
          Deepgram Options
        </Card.Title>
      </Card.Header>
      <Card.Content class="space-y-4">
        <!-- Punctuation -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label class="text-sm">Auto Punctuation</Label>
            <p class="text-xs text-muted-foreground">
              Add punctuation to text
            </p>
          </div>
          <Switch
            checked={config.deepgramConfig.punctuate}
            onCheckedChange={(checked) => onDeepgramConfigChange({ punctuate: checked })}
            disabled={isTranscribing}
          />
        </div>

        <!-- Smart Format -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label class="text-sm">Smart Format</Label>
            <p class="text-xs text-muted-foreground">
              Format numbers, dates, currencies
            </p>
          </div>
          <Switch
            checked={config.deepgramConfig.smartFormat}
            onCheckedChange={(checked) => onDeepgramConfigChange({ smartFormat: checked })}
            disabled={isTranscribing}
          />
        </div>

        <!-- Paragraphs -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label class="text-sm">Paragraphs</Label>
            <p class="text-xs text-muted-foreground">
              Detect paragraph changes
            </p>
          </div>
          <Switch
            checked={config.deepgramConfig.paragraphs}
            onCheckedChange={(checked) => onDeepgramConfigChange({ paragraphs: checked })}
            disabled={isTranscribing}
          />
        </div>

        <Separator />

        <!-- Diarization -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label class="text-sm flex items-center gap-2">
              <Users class="size-4" />
              Diarization
            </Label>
            <p class="text-xs text-muted-foreground">
              Identify different speakers
            </p>
          </div>
          <Switch
            checked={config.deepgramConfig.diarize}
            onCheckedChange={(checked) => onDeepgramConfigChange({ diarize: checked })}
            disabled={isTranscribing}
          />
        </div>

        <Separator />

        <!-- Utterance Split -->
        <div class="space-y-3">
          <div class="space-y-0.5">
            <Label class="text-sm">Pause Threshold</Label>
            <p class="text-xs text-muted-foreground">
              Silence duration to split phrases ({config.deepgramConfig.uttSplit.toFixed(1)}s)
            </p>
          </div>
          <Slider
            type="multiple"
            value={[config.deepgramConfig.uttSplit]}
            onValueChange={(values: number[]) => onDeepgramConfigChange({ uttSplit: values[0] })}
            min={0.1}
            max={2.0}
            step={0.1}
            disabled={isTranscribing}
          />
          <div class="flex justify-between text-xs text-muted-foreground">
            <span>0.1s (short phrases)</span>
            <span>2.0s (long phrases)</span>
          </div>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Export All Section - only when all files are completed -->
    {#if allFilesCompleted && filesWithVersions.length > 0}
      <Card.Root>
        <Card.Header class="pb-3">
          <Card.Title class="text-sm flex items-center gap-2">
            <CheckCircle class="size-4 text-green-500" />
            Export All
          </Card.Title>
          <Card.Description class="text-xs">
            {filesWithVersions.length} file(s), {totalVersions} version(s)
          </Card.Description>
        </Card.Header>
        <Card.Content class="space-y-4">
          <!-- Format -->
          <div class="space-y-2">
            <Label class="text-sm">Format</Label>
            <Select.Root
              type="single"
              value={exportFormat}
              onValueChange={(v) => v && (exportFormat = v as TranscriptionOutputFormat)}
              disabled={isExporting}
            >
              <Select.Trigger class="w-full">
                <span>{exportFormat.toUpperCase()}</span>
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="srt" label="SRT">SRT - SubRip</Select.Item>
                <Select.Item value="vtt" label="VTT">VTT - WebVTT</Select.Item>
                <Select.Item value="json" label="JSON">JSON - Structured data</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>

          <!-- Output directory -->
          <div class="space-y-2">
            <Label class="text-sm">Output folder</Label>
            <div class="flex gap-2">
              <Input
                value={outputDir}
                placeholder="Select..."
                readonly
                class="flex-1 text-xs"
              />
              <Button 
                variant="outline" 
                size="icon"
                onclick={handleBrowseOutput}
                disabled={isExporting}
              >
                <FolderOpen class="size-4" />
              </Button>
            </div>
          </div>

          <!-- Export button -->
          <Button
            class="w-full"
            disabled={!canExport}
            onclick={handleExportAll}
          >
            {#if isExporting}
              <Loader2 class="size-4 mr-2 animate-spin" />
              Exporting...
            {:else}
              <Download class="size-4 mr-2" />
              Export ({totalVersions})
            {/if}
          </Button>
        </Card.Content>
      </Card.Root>
    {/if}
  </div>

  <!-- Actions -->
  <div class="p-4 border-t shrink-0 space-y-3">
    <!-- Status summary -->
    {#if totalFilesCount > 0}
      <div class="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {#if transcodingCount > 0}
            {transcodingCount} converting...
          {:else}
            {readyFilesCount} ready
          {/if}
        </span>
        {#if completedFilesCount > 0}
          <span class="text-green-500">{completedFilesCount} completed</span>
        {/if}
      </div>
    {/if}

    <!-- Transcribe button -->
    <Button
      class="w-full"
      disabled={!canTranscribe}
      onclick={onTranscribeAll}
    >
      {#if isTranscribing}
        <Loader2 class="size-4 mr-2 animate-spin" />
        Transcribing...
      {:else if isTranscoding}
        <Loader2 class="size-4 mr-2 animate-spin" />
        Converting...
      {:else}
        <Play class="size-4 mr-2" />
        Transcribe All ({readyFilesCount})
      {/if}
    </Button>

    {#if !canTranscribe && !isTranscribing && !isTranscoding}
      <p class="text-xs text-muted-foreground text-center">
        {#if !apiKeyConfigured}
          Configure your Deepgram API key
        {:else if readyFilesCount === 0}
          Add audio files to transcribe
        {/if}
      </p>
    {/if}
  </div>
</div>
