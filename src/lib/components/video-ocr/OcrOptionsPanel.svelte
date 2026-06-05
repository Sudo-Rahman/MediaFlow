<script lang="ts">
  import { ChevronDown, Play, RotateCw, Settings, Square } from '@lucide/svelte';

  import type { OcrConfig, OcrLanguage } from '$lib/types/video-ocr';
  import { OCR_LANGUAGES } from '$lib/types/video-ocr';
  import { LlmProviderModelSelector } from '$lib/components/llm';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Button } from '$lib/components/ui/button';
  import * as ButtonGroup from '$lib/components/ui/button-group';
  import * as Field from '$lib/components/ui/field';
  import { Separator } from '$lib/components/ui/separator';
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
    actionHint: string;
    primaryAction: 'start' | 'retry';
    availableLanguages?: string[];  // Languages with installed models
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
    actionHint,
    primaryAction = 'start',
    availableLanguages = [],
    onConfigChange,
    onStart,
    onRetryAll,
    onCancel,
    onNavigateToSettings,
  }: OcrOptionsPanelProps = $props();

  const idPrefix = `ocr-options-${Math.random().toString(36).slice(2)}`;
  const languageSelectId = `${idPrefix}-language`;
  const frameRateSliderId = `${idPrefix}-frame-rate`;
  const confidenceSliderId = `${idPrefix}-confidence`;
  const gpuSwitchId = `${idPrefix}-gpu`;
  const mergeSwitchId = `${idPrefix}-merge`;
  const similaritySliderId = `${idPrefix}-similarity`;
  const maxGapSliderId = `${idPrefix}-max-gap`;
  const minCueDurationSliderId = `${idPrefix}-min-cue-duration`;
  const filterUrlSwitchId = `${idPrefix}-filter-url`;
  const aiCleanupSwitchId = `${idPrefix}-ai-cleanup`;

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
    if (effectivePrimaryAction === 'retry') {
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
  const effectivePrimaryAction = $derived(
    primaryAction === 'start' && !canStart && canRetryAll ? 'retry' : primaryAction
  );
  const primaryIsRetry = $derived(effectivePrimaryAction === 'retry');
  const primaryLabel = $derived(
    primaryIsRetry
      ? `Retry all (${retryCount})`
      : `Start OCR (${startCount})`
  );
  const primaryDisabled = $derived(primaryIsRetry ? !canRetryAll : !canStart);
</script>

<Field.FieldGroup class="gap-6">
  <!-- Header -->
  <div class="flex items-center gap-2">
    <Settings class="size-5 text-muted-foreground" />
    <h3 class="font-semibold">OCR Options</h3>
  </div>

  <!-- Language -->
  <Field.Field>
    <Field.FieldLabel for={languageSelectId}>Language</Field.FieldLabel>
    <Select.Root type="single" value={config.language} onValueChange={handleLanguageChange}>
      <Select.Trigger id={languageSelectId} class="w-full">
        {filteredLanguages.find(l => l.value === config.language)?.label ?? 'Select language'}
      </Select.Trigger>
      <Select.Content>
        <Select.Group>
          {#each filteredLanguages as lang (lang.value)}
            <Select.Item value={lang.value}>
              <span>{lang.label}</span>
              <span class="text-xs text-muted-foreground ml-2">{lang.description}</span>
            </Select.Item>
          {/each}
        </Select.Group>
      </Select.Content>
    </Select.Root>
    {#if availableLanguages.length > 0 && availableLanguages.length < OCR_LANGUAGES.length}
      <Field.FieldDescription>
        {availableLanguages.length} of {OCR_LANGUAGES.length} language models installed
      </Field.FieldDescription>
    {/if}
  </Field.Field>

  <!-- Frame Rate -->
  <Field.Field>
    <div class="flex justify-between">
      <Field.FieldLabel id={`${frameRateSliderId}-label`}>Frame Rate</Field.FieldLabel>
      <span class="text-sm text-muted-foreground">{config.frameRate} fps</span>
    </div>
    <Slider
      id={frameRateSliderId}
      aria-labelledby={`${frameRateSliderId}-label`}
      type="single"
      value={config.frameRate}
      onValueChange={handleFrameRateChange}
      min={1}
      max={30}
      step={1}
    />
    <Field.FieldDescription>
      Higher = more accurate timing, slower processing
    </Field.FieldDescription>
  </Field.Field>

  <!-- Confidence Threshold -->
  <Field.Field>
    <div class="flex justify-between">
      <Field.FieldLabel id={`${confidenceSliderId}-label`}>Min Confidence</Field.FieldLabel>
      <span class="text-sm text-muted-foreground">{Math.round(config.confidenceThreshold * 100)}%</span>
    </div>
    <Slider
      id={confidenceSliderId}
      aria-labelledby={`${confidenceSliderId}-label`}
      type="single"
      value={config.confidenceThreshold * 100}
      onValueChange={handleConfidenceChange}
      min={0}
      max={100}
      step={5}
    />
    <Field.FieldDescription>
      Ignore OCR results below this confidence level
    </Field.FieldDescription>
  </Field.Field>

  <!-- GPU Acceleration -->
  <Field.Field orientation="horizontal">
    <Field.FieldContent>
      <Field.FieldLabel for={gpuSwitchId}>Use GPU acceleration</Field.FieldLabel>
    </Field.FieldContent>
      <Switch
        id={gpuSwitchId}
        checked={config.useGpu}
        onCheckedChange={(checked) => onConfigChange({ useGpu: checked })}
      />
  </Field.Field>

  <!-- Advanced Cleanup -->
  <Separator />

  <Field.FieldSet>
    <Field.FieldLegend variant="label">Advanced Cleanup</Field.FieldLegend>

    <Field.FieldGroup class="gap-4">
      <Field.Field orientation="horizontal">
        <Field.FieldContent>
          <Field.FieldLabel for={mergeSwitchId}>Merge similar subtitles</Field.FieldLabel>
        </Field.FieldContent>
        <Switch
          id={mergeSwitchId}
          checked={config.mergeSimilar}
          onCheckedChange={(checked) => onConfigChange({ mergeSimilar: checked })}
        />
      </Field.Field>

      <Field.Field>
        <div class="flex justify-between">
          <Field.FieldLabel id={`${similaritySliderId}-label`}>Similarity threshold</Field.FieldLabel>
          <span class="text-sm text-muted-foreground">{Math.round(config.similarityThreshold * 100)}%</span>
        </div>
        <Slider
          id={similaritySliderId}
          aria-labelledby={`${similaritySliderId}-label`}
          type="single"
          value={Math.round(config.similarityThreshold * 100)}
          onValueChange={handleSimilarityThresholdChange}
          min={80}
          max={98}
          step={1}
          disabled={!config.mergeSimilar}
        />
        <Field.FieldDescription>
          Higher = stricter merging
        </Field.FieldDescription>
      </Field.Field>

      <Field.Field>
        <div class="flex justify-between">
          <Field.FieldLabel id={`${maxGapSliderId}-label`}>Max gap to merge</Field.FieldLabel>
          <span class="text-sm text-muted-foreground">{config.maxGapMs} ms</span>
        </div>
        <Slider
          id={maxGapSliderId}
          aria-labelledby={`${maxGapSliderId}-label`}
          type="single"
          value={config.maxGapMs}
          onValueChange={handleMaxGapChange}
          min={0}
          max={1000}
          step={50}
          disabled={!config.mergeSimilar}
        />
        <Field.FieldDescription>
          Bridge brief OCR dropouts
        </Field.FieldDescription>
      </Field.Field>

      <Field.Field>
        <div class="flex justify-between">
          <Field.FieldLabel id={`${minCueDurationSliderId}-label`}>Minimum cue duration</Field.FieldLabel>
          <span class="text-sm text-muted-foreground">{config.minCueDurationMs} ms</span>
        </div>
        <Slider
          id={minCueDurationSliderId}
          aria-labelledby={`${minCueDurationSliderId}-label`}
          type="single"
          value={config.minCueDurationMs}
          onValueChange={handleMinCueDurationChange}
          min={0}
          max={2000}
          step={50}
        />
        <Field.FieldDescription>
          Helps reduce micro-cues
        </Field.FieldDescription>
      </Field.Field>

      <Field.Field orientation="horizontal">
        <Field.FieldContent>
          <Field.FieldLabel for={filterUrlSwitchId}>Filter URL-like watermarks</Field.FieldLabel>
        </Field.FieldContent>
        <Switch
          id={filterUrlSwitchId}
          checked={config.filterUrlLike}
          onCheckedChange={(checked) => onConfigChange({ filterUrlLike: checked })}
        />
      </Field.Field>
    </Field.FieldGroup>
  </Field.FieldSet>

  <!-- AI Cleanup -->
  <Separator />

  <Field.FieldSet>
    <Field.Field orientation="horizontal">
      <Field.FieldContent>
        <Field.FieldLabel for={aiCleanupSwitchId}>AI subtitle cleanup</Field.FieldLabel>
        <Field.FieldDescription>
          Correct OCR mistakes with AI and merge duplicate consecutive lines
        </Field.FieldDescription>
      </Field.FieldContent>
      <Switch
        id={aiCleanupSwitchId}
        checked={config.aiCleanupEnabled}
        onCheckedChange={(checked) => onConfigChange({ aiCleanupEnabled: checked })}
      />
    </Field.Field>

    {#if config.aiCleanupEnabled}
      <LlmProviderModelSelector
        provider={config.aiCleanupProvider}
        model={config.aiCleanupModel}
        onProviderChange={(provider) => onConfigChange({ aiCleanupProvider: provider })}
        onModelChange={(model) => onConfigChange({ aiCleanupModel: model })}
        onNavigateToSettings={onNavigateToSettings}
      />
      <Field.FieldDescription>
        If cleanup fails, OCR subtitles from heuristic cleanup are kept automatically.
      </Field.FieldDescription>
    {/if}
  </Field.FieldSet>

  <!-- Action Buttons -->
  <Separator />

  <div class="space-y-2">
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
          disabled={primaryDisabled}
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
        {actionHint}
      </p>
    {/if}
  </div>

</Field.FieldGroup>
