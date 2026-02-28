<script lang="ts">
  import { ChevronDown, Play, RotateCw, Settings, Square } from '@lucide/svelte';

  import type { OcrConfig, OcrLanguage } from '$lib/types/video-ocr';
  import { OCR_LANGUAGES } from '$lib/types/video-ocr';
  import { LlmProviderModelSelector } from '$lib/components/llm';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Button } from '$lib/components/ui/button';
  import * as ButtonGroup from '$lib/components/ui/button-group';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';

  interface OcrOptionsPanelProps {
    config: OcrConfig;
    canStart: boolean;
    canRetryAll: boolean;
    isProcessing: boolean;
    startCount: number;
    retryCount: number;
    primaryAction: 'start' | 'retry';
    availableLanguages?: string[];  // Languages with installed models
    maxThreads?: number;            // Max available threads
    onConfigChange: (updates: Partial<OcrConfig>) => void;
    onStart: () => void;
    onRetryAll: () => void;
    onCancel: () => void;
    onNavigateToSettings?: () => void;
  }

  let {
    config,
    canStart,
    canRetryAll,
    isProcessing,
    startCount,
    retryCount,
    primaryAction = 'start',
    availableLanguages = [],
    maxThreads = navigator.hardwareConcurrency || 4,
    onConfigChange,
    onStart,
    onRetryAll,
    onCancel,
    onNavigateToSettings,
  }: OcrOptionsPanelProps = $props();

  // Filter languages to only show those with installed models
  // If no availableLanguages provided, show all (fallback)
  const filteredLanguages = $derived(
    availableLanguages.length > 0
      ? OCR_LANGUAGES.filter(lang => availableLanguages.includes(lang.value))
      : OCR_LANGUAGES
  );

  function handleLanguageChange(value: string) {
    onConfigChange({ language: value as OcrLanguage });
  }

  function handleFrameRateChange(value: number) {
    onConfigChange({ frameRate: value });
  }

  function handleConfidenceChange(value: number) {
    onConfigChange({ confidenceThreshold: value / 100 });
  }

  function handleThreadCountChange(value: number) {
    onConfigChange({ threadCount: value });
  }

  function handleSimilarityThresholdChange(value: number) {
    onConfigChange({ similarityThreshold: value / 100 });
  }

  function handleMaxGapChange(value: number) {
    onConfigChange({ maxGapMs: value });
  }

  function handleMinCueDurationChange(value: number) {
    onConfigChange({ minCueDurationMs: value });
  }

  function handlePrimaryAction() {
    if (primaryAction === 'retry') {
      if (!canRetryAll) {
        return;
      }

      onRetryAll();
      return;
    }

    if (!canStart) {
      return;
    }

    onStart();
  }

  function handleStartAction() {
    if (!canStart) {
      return;
    }

    onStart();
  }

  function handleRetryAllAction() {
    if (!canRetryAll) {
      return;
    }

    onRetryAll();
  }

  const hasAnyAction = $derived(canStart || canRetryAll);
  const primaryLabel = $derived(
    primaryAction === 'retry'
      ? `Retry all (${retryCount})`
      : `Start OCR (${startCount})`
  );
  const primaryIsRetry = $derived(primaryAction === 'retry');
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center gap-2">
    <Settings class="size-5 text-muted-foreground" />
    <h3 class="font-semibold">OCR Options</h3>
  </div>

  <!-- Language -->
  <div class="space-y-2">
    <Label>Language</Label>
    <Select.Root type="single" value={config.language} onValueChange={handleLanguageChange}>
      <Select.Trigger class="w-full">
        {filteredLanguages.find(l => l.value === config.language)?.label ?? 'Select language'}
      </Select.Trigger>
      <Select.Content>
        {#each filteredLanguages as lang}
          <Select.Item value={lang.value}>
            <span>{lang.label}</span>
            <span class="text-xs text-muted-foreground ml-2">{lang.description}</span>
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
    {#if availableLanguages.length > 0 && availableLanguages.length < OCR_LANGUAGES.length}
      <p class="text-xs text-muted-foreground">
        {availableLanguages.length} of {OCR_LANGUAGES.length} language models installed
      </p>
    {/if}
  </div>

  <!-- Frame Rate -->
  <div class="space-y-2">
    <div class="flex justify-between">
      <Label>Frame Rate</Label>
      <span class="text-sm text-muted-foreground">{config.frameRate} fps</span>
    </div>
    <Slider
      type="single"
      value={config.frameRate}
      onValueChange={handleFrameRateChange}
      min={1}
      max={30}
      step={1}
    />
    <p class="text-xs text-muted-foreground">
      Higher = more accurate timing, slower processing
    </p>
  </div>

  <!-- Confidence Threshold -->
  <div class="space-y-2">
    <div class="flex justify-between">
      <Label>Min Confidence</Label>
      <span class="text-sm text-muted-foreground">{Math.round(config.confidenceThreshold * 100)}%</span>
    </div>
    <Slider
      type="single"
      value={config.confidenceThreshold * 100}
      onValueChange={handleConfidenceChange}
      min={0}
      max={100}
      step={5}
    />
    <p class="text-xs text-muted-foreground">
      Ignore OCR results below this confidence level
    </p>
  </div>

  <!-- Parallel Workers -->
  <div class="space-y-2">
    <div class="flex justify-between">
      <Label>Parallel Workers</Label>
      <span class="text-sm text-muted-foreground">{config.threadCount} / {maxThreads}</span>
    </div>
    <Slider
      type="single"
      value={config.threadCount}
      onValueChange={handleThreadCountChange}
      min={1}
      max={maxThreads}
      step={1}
    />
    <p class="text-xs text-muted-foreground">
      More workers = faster, but uses more memory
    </p>
  </div>

  <!-- GPU Acceleration -->
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <Label>Use GPU acceleration</Label>
      <Switch
        checked={config.useGpu}
        onCheckedChange={(checked) => onConfigChange({ useGpu: checked })}
      />
    </div>
  </div>

  <!-- Advanced Cleanup -->
  <div class="pt-4 border-t space-y-4">
    <h4 class="text-sm font-medium">Advanced Cleanup</h4>

    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <Label>Merge similar subtitles</Label>
        <Switch
          checked={config.mergeSimilar}
          onCheckedChange={(checked) => onConfigChange({ mergeSimilar: checked })}
        />
      </div>

      <div class="space-y-2">
        <div class="flex justify-between">
          <Label>Similarity threshold</Label>
          <span class="text-sm text-muted-foreground">{Math.round(config.similarityThreshold * 100)}%</span>
        </div>
        <Slider
          type="single"
          value={Math.round(config.similarityThreshold * 100)}
          onValueChange={handleSimilarityThresholdChange}
          min={80}
          max={98}
          step={1}
          disabled={!config.mergeSimilar}
        />
        <p class="text-xs text-muted-foreground">
          Higher = stricter merging
        </p>
      </div>

      <div class="space-y-2">
        <div class="flex justify-between">
          <Label>Max gap to merge</Label>
          <span class="text-sm text-muted-foreground">{config.maxGapMs} ms</span>
        </div>
        <Slider
          type="single"
          value={config.maxGapMs}
          onValueChange={handleMaxGapChange}
          min={0}
          max={1000}
          step={50}
          disabled={!config.mergeSimilar}
        />
        <p class="text-xs text-muted-foreground">
          Bridge brief OCR dropouts
        </p>
      </div>

      <div class="space-y-2">
        <div class="flex justify-between">
          <Label>Minimum cue duration</Label>
          <span class="text-sm text-muted-foreground">{config.minCueDurationMs} ms</span>
        </div>
        <Slider
          type="single"
          value={config.minCueDurationMs}
          onValueChange={handleMinCueDurationChange}
          min={0}
          max={2000}
          step={50}
        />
        <p class="text-xs text-muted-foreground">
          Helps reduce micro-cues
        </p>
      </div>

      <div class="flex items-center justify-between">
        <Label>Filter URL-like watermarks</Label>
        <Switch
          checked={config.filterUrlLike}
          onCheckedChange={(checked) => onConfigChange({ filterUrlLike: checked })}
        />
      </div>
    </div>
  </div>

  <!-- AI Cleanup -->
  <div class="pt-4 border-t space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="space-y-1">
        <Label>AI subtitle cleanup</Label>
        <p class="text-xs text-muted-foreground">
          Correct OCR mistakes with AI and merge duplicate consecutive lines
        </p>
      </div>
      <Switch
        checked={config.aiCleanupEnabled}
        onCheckedChange={(checked) => onConfigChange({ aiCleanupEnabled: checked })}
      />
    </div>

    {#if config.aiCleanupEnabled}
      <LlmProviderModelSelector
        provider={config.aiCleanupProvider}
        model={config.aiCleanupModel}
        onProviderChange={(provider) => onConfigChange({ aiCleanupProvider: provider })}
        onModelChange={(model) => onConfigChange({ aiCleanupModel: model })}
        onNavigateToSettings={onNavigateToSettings}
      />
      <p class="text-xs text-muted-foreground">
        If cleanup fails, OCR subtitles from heuristic cleanup are kept automatically.
      </p>
    {/if}
  </div>

  <!-- Action Buttons -->
  <div class="pt-4 border-t space-y-2">
    {#if isProcessing}
      <Button
        variant="destructive"
        class="w-full"
        onclick={onCancel}
      >
        <Square class="size-4 mr-2" />
        Cancel OCR
      </Button>
    {:else}
      <ButtonGroup.Root class="w-full">
        <Button
          class="flex-1 rounded-r-none"
          disabled={!hasAnyAction}
          onclick={handlePrimaryAction}
        >
          {#if primaryIsRetry}
            <RotateCw class="size-4 mr-2" />
          {:else}
            <Play class="size-4 mr-2" />
          {/if}
          {primaryLabel}
        </Button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                class="rounded-l-none px-2"
                disabled={!hasAnyAction}
                aria-label="Open OCR actions"
              >
                <ChevronDown class="size-4" />
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="w-52">
            <DropdownMenu.Item onclick={handleStartAction} disabled={!canStart}>
              Start OCR ({startCount})
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={handleRetryAllAction} disabled={!canRetryAll}>
              Retry all... ({retryCount})
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </ButtonGroup.Root>
    {/if}

    {#if !hasAnyAction && !isProcessing}
      <p class="text-xs text-muted-foreground text-center">
        Add videos and wait for transcoding to complete
      </p>
    {/if}
  </div>

</div>
