<script lang="ts">
  import { AlertTriangle, Key, Loader2, Play, Settings2, Users } from '@lucide/svelte';
  import { DEEPGRAM_MODELS, type TranscriptionConfig, type DeepgramConfig, type TranscriptionProvider } from '$lib/types';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
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
    invalidAutoLanguageFiles: string[];
    onProviderChange: (provider: TranscriptionProvider) => void;
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
    invalidAutoLanguageFiles,
    onProviderChange,
    onDeepgramConfigChange,
    onMaxConcurrentChange,
    onTranscribeAll,
    onNavigateToSettings,
    class: className = ''
  }: TranscriptionPanelProps = $props();

  // Files that can be transcribed (ready or completed for re-transcription)
  const transcribableFilesCount = $derived(readyFilesCount + completedFilesCount);
  const hasInvalidAutoLanguageFiles = $derived(
    config.deepgramConfig.language === 'multi' && invalidAutoLanguageFiles.length > 0
  );
  const isMediaFlow = $derived(config.provider === 'mediaflow');
  
  const canTranscribe = $derived(
    transcribableFilesCount > 0 && 
    !isTranscribing && 
    !isTranscoding &&
    apiKeyConfigured &&
    !hasInvalidAutoLanguageFiles
  );
  
  // Determine if all files are already completed (for button text)
  const allFilesHaveVersions = $derived(
    totalFilesCount > 0 && 
    completedFilesCount === totalFilesCount &&
    readyFilesCount === 0
  );

  const invalidFileCountLabel = $derived(
    `${invalidAutoLanguageFiles.length} affected file${invalidAutoLanguageFiles.length === 1 ? '' : 's'}`
  );
  const mediaFlowModels = [DEEPGRAM_MODELS[0]] as const;
  const modelOptions = $derived(isMediaFlow ? mediaFlowModels : DEEPGRAM_MODELS);
  const showProviderSelector = import.meta.env.DEV;
</script>

<div class={cn("h-full flex flex-col overflow-auto", className)}>
  <!-- API Key Status -->
  {#if !apiKeyConfigured}
    <div class="p-4">
      <Alert.Root variant="destructive" class="shrink-0">
        <Key class="size-4" />
        <Alert.Title>{isMediaFlow ? 'MediaFlow Sign-in Required' : 'Deepgram API Key Required'}</Alert.Title>
        <Alert.Description>
          {isMediaFlow
            ? 'Sign in to MediaFlow to use managed transcription.'
            : 'Please configure your Deepgram API key to use this feature.'}
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
      <Card.Content class="space-y-4">
        {#if showProviderSelector}
          <div class="space-y-2">
            <Label class="text-sm font-medium">Provider</Label>
            <Select.Root
              type="single"
              value={config.provider}
              onValueChange={(value) => onProviderChange(value as TranscriptionProvider)}
              disabled={isTranscribing}
            >
              <Select.Trigger class="w-full">
                {config.provider === 'mediaflow' ? 'MediaFlow' : 'Deepgram'}
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  <Select.Item value="deepgram">Deepgram</Select.Item>
                  <Select.Item value="mediaflow">MediaFlow</Select.Item>
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </div>

          <Separator />
        {/if}

        <ModelSelector
          value={config.deepgramConfig.model}
          models={modelOptions}
          onValueChange={(model) => onDeepgramConfigChange({ model })}
          disabled={isTranscribing || isMediaFlow}
        />
      </Card.Content>
    </Card.Root>

    <!-- Language -->
    <Card.Root>
      <Card.Content>
        <LanguageSelector
          value={config.deepgramConfig.language}
          onValueChange={(language) => onDeepgramConfigChange({ language })}
          disabled={isTranscribing}
        />

        {#if hasInvalidAutoLanguageFiles}
          <Alert.Root class="mt-3 rounded-xl border-amber-200/70 bg-amber-50/45 px-3 py-2 text-amber-950 shadow-none *:[svg]:text-amber-600 [&>[data-slot=alert-title]]:min-w-0 [&>[data-slot=alert-description]]:min-w-0">
            <AlertTriangle class="size-3.5" />
            <Alert.Title class="min-w-0 text-sm leading-snug break-words">Select a source language</Alert.Title>
            <Alert.Description class="min-w-0 text-xs leading-snug text-amber-900/80">
              Auto-detection is unavailable.

              <div class="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-amber-900/75">
                <span class="rounded-full border border-amber-300/70 bg-white/70 px-2 py-0.5 font-medium text-amber-800">
                  {invalidFileCountLabel}
                </span>
              </div>
            </Alert.Description>
          </Alert.Root>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Deepgram Options -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-sm flex items-center gap-2">
          <Settings2 class="size-4" />
          Transcription Configuration
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
          {isMediaFlow ? 'Sign in to MediaFlow' : 'Configure your Deepgram API key'}
        {:else if hasInvalidAutoLanguageFiles}
          Choose a source language manually above before transcribing
        {:else if transcribableFilesCount === 0}
          Add audio files to transcribe
        {/if}
      </p>
    {/if}
  </div>
</div>
