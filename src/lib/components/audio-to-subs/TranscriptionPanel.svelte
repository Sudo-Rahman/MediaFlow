<script lang="ts">
  import { AlertTriangle, Key, Loader2, Play, Settings2, Users } from '@lucide/svelte';
  import { DEEPGRAM_MODELS, type TranscriptionConfig, type DeepgramConfig, type TranscriptionProvider } from '$lib/types';
  import { mediaflowModelCatalogStore } from '$lib/stores';
  import { cn } from '$lib/utils';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Select from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import { Slider } from '$lib/components/ui/slider';
  import { Separator } from '$lib/components/ui/separator';
  import * as Alert from '$lib/components/ui/alert';
  import { Input } from '$lib/components/ui/input';
  import MediaFlowSignInPrompt from '$lib/components/account/MediaFlowSignInPrompt.svelte';
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
    (config.provider !== 'mediaflow' || mediaflowModelCatalogStore.hasTranscriptionModels) &&
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
  const mediaFlowModels = $derived(mediaflowModelCatalogStore.transcriptionModels);
  const hasMediaFlowModels = $derived(mediaFlowModels.length > 0);
  const modelOptions = $derived(isMediaFlow ? mediaFlowModels : DEEPGRAM_MODELS);
  const hasModelOptions = $derived(modelOptions.length > 0);
  const providerOptions = $derived<TranscriptionProvider[]>(
    import.meta.env.DEV
      ? (hasMediaFlowModels ? ['deepgram', 'mediaflow'] : ['deepgram'])
      : (hasMediaFlowModels ? ['mediaflow'] : [])
  );
  const showProviderSelector = import.meta.env.DEV;
  const idPrefix = `transcription-panel-${Math.random().toString(36).slice(2)}`;
  const providerSelectId = `${idPrefix}-provider`;
  const punctuationSwitchId = `${idPrefix}-punctuation`;
  const smartFormatSwitchId = `${idPrefix}-smart-format`;
  const paragraphsSwitchId = `${idPrefix}-paragraphs`;
  const diarizeSwitchId = `${idPrefix}-diarize`;
  const uttSplitSliderId = `${idPrefix}-utt-split`;
  const maxConcurrentInputId = `${idPrefix}-max-concurrent`;

  $effect(() => {
    if (config.provider === 'mediaflow' && !hasMediaFlowModels && import.meta.env.DEV) {
      onProviderChange('deepgram');
      return;
    }

    const firstMediaFlowModel = mediaFlowModels[0]?.id;
    if (
      config.provider === 'mediaflow' &&
      firstMediaFlowModel &&
      !mediaFlowModels.some((model) => model.id === config.deepgramConfig.model)
    ) {
      onDeepgramConfigChange({ model: firstMediaFlowModel });
    }
  });
</script>

<div class={cn("h-full flex flex-col overflow-auto", className)}>
  <!-- API Key Status -->
  {#if !apiKeyConfigured}
    <div class="p-4">
      {#if isMediaFlow}
        <MediaFlowSignInPrompt
          title="Sign in to use managed transcription"
          description="MediaFlow uses your account credits for managed transcription."
        />
      {:else}
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
      {/if}
    </div>
  {/if}

  <div class="p-4 space-y-6 flex-1">
    <!-- Model Selection -->
    <Card.Root>
      <Card.Content class="space-y-4">
        {#if showProviderSelector}
          <Field.Field>
            <Field.FieldLabel for={providerSelectId}>Provider</Field.FieldLabel>
            <Select.Root
              type="single"
              value={config.provider}
              onValueChange={(value) => onProviderChange(value as TranscriptionProvider)}
              disabled={isTranscribing}
            >
              <Select.Trigger id={providerSelectId} class="w-full">
                {config.provider === 'mediaflow' ? 'MediaFlow' : 'Deepgram'}
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  {#each providerOptions as provider (provider)}
                    <Select.Item value={provider}>
                      {provider === 'mediaflow' ? 'MediaFlow' : 'Deepgram'}
                    </Select.Item>
                  {/each}
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </Field.Field>

          <Separator />
        {/if}

        <ModelSelector
          value={config.deepgramConfig.model}
          models={modelOptions}
          onValueChange={(model) => onDeepgramConfigChange({ model })}
          disabled={isTranscribing || !hasModelOptions}
        />

        {#if isMediaFlow && !hasModelOptions}
          <Alert.Root role="note" aria-live="off">
            <AlertTriangle class="size-4" />
            <Alert.Title>MediaFlow models unavailable</Alert.Title>
            <Alert.Description>
              Managed transcription models could not be loaded.
            </Alert.Description>
          </Alert.Root>
        {/if}
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
          <Alert.Root
            role="note"
            aria-live="off"
            class="mt-3 border-amber-500/40 text-amber-700 dark:text-amber-300"
          >
            <AlertTriangle class="size-3.5" />
            <Alert.Title class="min-w-0 text-sm leading-snug break-words">Select a source language</Alert.Title>
            <Alert.Description class="min-w-0 text-xs leading-snug">
              Auto-detection is unavailable.

              <div class="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                <Badge variant="secondary" class="text-[11px]">
                  {invalidFileCountLabel}
                </Badge>
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
        <Field.Field orientation="horizontal">
          <Field.FieldContent>
            <Field.FieldLabel for={punctuationSwitchId}>Auto Punctuation</Field.FieldLabel>
            <Field.FieldDescription>
              Add punctuation to text
            </Field.FieldDescription>
          </Field.FieldContent>
          <Switch
            id={punctuationSwitchId}
            checked={config.deepgramConfig.punctuate}
            onCheckedChange={(checked) => onDeepgramConfigChange({ punctuate: checked })}
            disabled={isTranscribing}
          />
        </Field.Field>

        <!-- Smart Format -->
        <Field.Field orientation="horizontal">
          <Field.FieldContent>
            <Field.FieldLabel for={smartFormatSwitchId}>Smart Format</Field.FieldLabel>
            <Field.FieldDescription>
              Format numbers, dates, currencies
            </Field.FieldDescription>
          </Field.FieldContent>
          <Switch
            id={smartFormatSwitchId}
            checked={config.deepgramConfig.smartFormat}
            onCheckedChange={(checked) => onDeepgramConfigChange({ smartFormat: checked })}
            disabled={isTranscribing}
          />
        </Field.Field>

        <!-- Paragraphs -->
        <Field.Field orientation="horizontal">
          <Field.FieldContent>
            <Field.FieldLabel for={paragraphsSwitchId}>Paragraphs</Field.FieldLabel>
            <Field.FieldDescription>
              Detect paragraph changes
            </Field.FieldDescription>
          </Field.FieldContent>
          <Switch
            id={paragraphsSwitchId}
            checked={config.deepgramConfig.paragraphs}
            onCheckedChange={(checked) => onDeepgramConfigChange({ paragraphs: checked })}
            disabled={isTranscribing}
          />
        </Field.Field>

        <Separator />

        <!-- Diarization -->
        <Field.Field orientation="horizontal">
          <Field.FieldContent>
            <Field.FieldLabel for={diarizeSwitchId}>
              <Users class="size-4" />
              Diarization
            </Field.FieldLabel>
            <Field.FieldDescription>
              Identify different speakers
            </Field.FieldDescription>
          </Field.FieldContent>
          <Switch
            id={diarizeSwitchId}
            checked={config.deepgramConfig.diarize}
            onCheckedChange={(checked) => onDeepgramConfigChange({ diarize: checked })}
            disabled={isTranscribing}
          />
        </Field.Field>

        <Separator />

        <!-- Utterance Split -->
        <Field.Field>
          <Field.FieldLabel id={`${uttSplitSliderId}-label`}>Pause Threshold</Field.FieldLabel>
          <Field.FieldDescription>
              Silence duration to split phrases ({config.deepgramConfig.uttSplit.toFixed(1)}s)
          </Field.FieldDescription>
          <Slider
            id={uttSplitSliderId}
            aria-labelledby={`${uttSplitSliderId}-label`}
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
        </Field.Field>

        <Separator />

        <!-- Concurrent Transcriptions -->
        <Field.Field>
          <Field.FieldLabel for={maxConcurrentInputId}>Concurrent Transcriptions</Field.FieldLabel>
          <Field.FieldDescription>
              Number of files to transcribe simultaneously ({config.maxConcurrentTranscriptions})
          </Field.FieldDescription>
          <div class="flex items-center gap-3">
            <Input
              id={maxConcurrentInputId}
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
        </Field.Field>
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
          {isMediaFlow ? 'Sign in to use managed transcription' : 'Configure your Deepgram API key'}
        {:else if hasInvalidAutoLanguageFiles}
          Choose a source language manually above before transcribing
        {:else if transcribableFilesCount === 0}
          Add audio files to transcribe
        {/if}
      </p>
    {/if}
  </div>
</div>
