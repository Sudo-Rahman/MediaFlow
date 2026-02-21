<script lang="ts">
  import { Play, Loader2, Settings2, Users, Key } from '@lucide/svelte';
  import type { TranscriptionConfig, DeepgramConfig } from '$lib/types';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import { Slider } from '$lib/components/ui/slider';
  import { Separator } from '$lib/components/ui/separator';
  import * as Alert from '$lib/components/ui/alert';
  import { Input } from '$lib/components/ui/input';
  import ModelSelector from './ModelSelector.svelte';
  import LanguageSelector from './LanguageSelector.svelte';

  interface TranscriptionPanelProps {
    config: TranscriptionConfig;
    apiKeyConfigured: boolean;
    isTranscribing: boolean;
    isTranscoding: boolean;
    readyFilesCount: number;
    completedFilesCount: number;
    totalFilesCount: number;
    transcodingCount: number;
    onDeepgramConfigChange: (updates: Partial<DeepgramConfig>) => void;
    onMaxConcurrentChange: (value: number) => void;
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
    onDeepgramConfigChange,
    onMaxConcurrentChange,
    onTranscribeAll,
    onNavigateToSettings,
    class: className = ''
  }: TranscriptionPanelProps = $props();

  // Files that can be transcribed (ready or completed for re-transcription)
  const transcribableFilesCount = $derived(readyFilesCount + completedFilesCount);
  
  const canTranscribe = $derived(
    transcribableFilesCount > 0 && 
    !isTranscribing && 
    !isTranscoding &&
    apiKeyConfigured
  );
  
  // Determine if all files are already completed (for button text)
  const allFilesHaveVersions = $derived(
    totalFilesCount > 0 && 
    completedFilesCount === totalFilesCount &&
    readyFilesCount === 0
  );
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

        <Separator />

        <!-- Concurrent Transcriptions -->
        <div class="space-y-3">
          <div class="space-y-0.5">
            <Label class="text-sm">Concurrent Transcriptions</Label>
            <p class="text-xs text-muted-foreground">
              Number of files to transcribe simultaneously ({config.maxConcurrentTranscriptions})
            </p>
          </div>
          <div class="flex items-center gap-3">
            <Input
              type="number"
              value={config.maxConcurrentTranscriptions}
              onchange={(e) => onMaxConcurrentChange(parseInt(e.currentTarget.value, 10))}
              min={1}
              max={10}
              step={1}
              disabled={isTranscribing}
              class="w-24"
            />
            <span class="text-xs text-muted-foreground">files at once (max 10)</span>
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
      {:else if allFilesHaveVersions}
        <Play class="size-4 mr-2" />
        Transcribe All Again ({transcribableFilesCount})
      {:else}
        <Play class="size-4 mr-2" />
        Transcribe All ({transcribableFilesCount})
      {/if}
    </Button>

    {#if !canTranscribe && !isTranscribing && !isTranscoding}
      <p class="text-xs text-muted-foreground text-center">
        {#if !apiKeyConfigured}
          Configure your Deepgram API key
        {:else if transcribableFilesCount === 0}
          Add audio files to transcribe
        {/if}
      </p>
    {/if}
  </div>
</div>
