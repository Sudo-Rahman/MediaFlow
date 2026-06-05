<script lang="ts">
  import { AlertTriangle, Info } from '@lucide/svelte';

  import type { OcrConfig, OcrRetryMode, OcrVideoFile } from '$lib/types/video-ocr';
  import { DEFAULT_OCR_CONFIG, OCR_LANGUAGES } from '$lib/types/video-ocr';
  import { LlmProviderModelSelector } from '$lib/components/llm';
  import { RetryVersionDialogShell } from '$lib/components/shared';
  import { mediaflowModelCatalogStore } from '$lib/stores';
  import { isLLMSelectionAvailable } from '$lib/types';
  import { canRunOcrRetryMode, willRetryFallbackToFullPipeline } from './video-ocr-processing';

  import * as Field from '$lib/components/ui/field';
  import * as Item from '$lib/components/ui/item';
  import { Separator } from '$lib/components/ui/separator';
  import * as Select from '$lib/components/ui/select';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';

  interface OcrRetryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    file: OcrVideoFile | null;
    baseConfig: OcrConfig;
    onConfirm: (fileId: string, versionName: string, mode: OcrRetryMode, config: OcrConfig) => void;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    file,
    baseConfig,
    onConfirm,
  }: OcrRetryDialogProps = $props();

  let versionName = $state('');
  let mode = $state<OcrRetryMode>('full_pipeline');
  let config = $state<OcrConfig>({ ...DEFAULT_OCR_CONFIG });
  const idPrefix = `ocr-retry-${Math.random().toString(36).slice(2)}`;
  const retryModeSelectId = `${idPrefix}-mode`;
  const languageSelectId = `${idPrefix}-language`;
  const frameRateSliderId = `${idPrefix}-frame-rate`;
  const confidenceSliderId = `${idPrefix}-confidence`;
  const gpuSwitchId = `${idPrefix}-gpu`;
  const aiCleanupSwitchId = `${idPrefix}-ai-cleanup`;
  const mergeSwitchId = `${idPrefix}-merge`;
  const similaritySliderId = `${idPrefix}-similarity`;
  const maxGapSliderId = `${idPrefix}-max-gap`;
  const minCueDurationSliderId = `${idPrefix}-min-cue-duration`;
  const filterUrlSwitchId = `${idPrefix}-filter-url`;

  const willFallbackToFullPipeline = $derived(file ? willRetryFallbackToFullPipeline(file, mode) : false);
  const canRunSelectedMode = $derived(file ? canRunOcrRetryMode(file, mode) : false);
  const showPipelineOptions = $derived(mode === 'full_pipeline');
  const showCleanupOptions = $derived(mode === 'full_pipeline' || mode === 'cleanup_only' || mode === 'cleanup_and_ai');
  const selectedModeRunsAi = $derived(
    mode === 'cleanup_and_ai'
    || mode === 'ai_only'
    || (mode === 'full_pipeline' && config.aiCleanupEnabled)
  );
  const showAiOptions = $derived(selectedModeRunsAi);
  const aiCleanupModelAvailable = $derived(
    isLLMSelectionAvailable(
      config.aiCleanupProvider,
      config.aiCleanupModel,
      import.meta.env.DEV,
      mediaflowModelCatalogStore.chatModels,
    )
  );
  const canConfirm = $derived(canRunSelectedMode && (!selectedModeRunsAi || aiCleanupModelAvailable));

  $effect(() => {
    if (open && file) {
      versionName = `Version ${(file.ocrVersions?.length ?? 0) + 1}`;
      mode = 'full_pipeline';
      config = { ...baseConfig };
    }
  });

  function handleConfirm() {
    if (!file || !canConfirm) {
      return;
    }

    const finalConfig: OcrConfig = {
      ...config,
      aiCleanupEnabled:
        mode === 'cleanup_and_ai' || mode === 'ai_only'
          ? true
          : mode === 'cleanup_only'
            ? false
            : config.aiCleanupEnabled,
    };

    onConfirm(file.id, versionName.trim() || 'New version', mode, finalConfig);
    onOpenChange(false);
  }

  function getModeLabel(value: OcrRetryMode): string {
    switch (value) {
      case 'full_pipeline':
        return 'Full pipeline';
      case 'cleanup_only':
        return 'Cleanup only';
      case 'cleanup_and_ai':
        return 'Cleanup + AI';
      case 'ai_only':
        return 'AI only';
    }
  }
</script>

<RetryVersionDialogShell
  bind:open
  {onOpenChange}
  title="New OCR Version"
  description={`Create a new OCR version for ${file?.name ?? 'this file'}`}
  bind:versionName
  versionNamePlaceholder="Version 1"
  confirmLabel="Run"
  confirmDisabled={!canConfirm}
  maxWidthClass="max-w-xl"
  onConfirm={handleConfirm}
>
  {#snippet optionsContent()}
    <Field.Field>
      <Field.FieldLabel for={retryModeSelectId}>Retry mode</Field.FieldLabel>
      <Select.Root
        type="single"
        value={mode}
        onValueChange={(value) => value && (mode = value as OcrRetryMode)}
      >
        <Select.Trigger id={retryModeSelectId} class="w-full">
          {getModeLabel(mode)}
        </Select.Trigger>
        <Select.Content>
          <Select.Group>
            <Select.Item value="full_pipeline">Full pipeline</Select.Item>
            <Select.Item value="cleanup_only">Cleanup only</Select.Item>
            <Select.Item value="cleanup_and_ai">Cleanup + AI</Select.Item>
            <Select.Item value="ai_only">AI only</Select.Item>
          </Select.Group>
        </Select.Content>
      </Select.Root>
    </Field.Field>

    {#if willFallbackToFullPipeline}
      <Item.Root variant="outline" size="xs" class="border-amber-500/40 text-amber-700 dark:text-amber-300">
        <Item.Media>
          <AlertTriangle class="size-4" />
        </Item.Media>
        <Item.Content>
          <Item.Title>This retry needs full pipeline</Item.Title>
          <Item.Description class="line-clamp-none">
            Partial retry needs raw OCR for the active version. Select Full pipeline to process the current zones.
          </Item.Description>
        </Item.Content>
      </Item.Root>
    {/if}

    {#if mode !== 'full_pipeline'}
      <Item.Root variant="outline" size="xs">
        <Item.Media>
          <Info class="size-4" />
        </Item.Media>
        <Item.Content>
          <Item.Title>Partial retry timing</Item.Title>
          <Item.Description>
            Partial retry reuses the original raw OCR frame rate for timing.
          </Item.Description>
        </Item.Content>
      </Item.Root>
    {/if}

    {#if showPipelineOptions}
      <Separator />
      <Field.FieldSet>
        <Field.FieldLegend variant="label">Pipeline options</Field.FieldLegend>

        <Field.FieldGroup class="gap-4">
        <Field.Field>
          <Field.FieldLabel for={languageSelectId}>Language</Field.FieldLabel>
        <Select.Root
          type="single"
          value={config.language}
          onValueChange={(value) => value && (config = { ...config, language: value as OcrConfig['language'] })}
        >
          <Select.Trigger id={languageSelectId} class="w-full">
            {OCR_LANGUAGES.find((lang) => lang.value === config.language)?.label ?? 'Select language'}
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              {#each OCR_LANGUAGES as lang (lang.value)}
                <Select.Item value={lang.value}>{lang.label}</Select.Item>
              {/each}
            </Select.Group>
          </Select.Content>
        </Select.Root>
        </Field.Field>

      <Field.Field>
        <div class="flex items-center justify-between">
          <Field.FieldLabel id={`${frameRateSliderId}-label`}>Frame rate</Field.FieldLabel>
          <span class="text-xs text-muted-foreground">{config.frameRate} fps</span>
        </div>
        <Slider
          id={frameRateSliderId}
          aria-labelledby={`${frameRateSliderId}-label`}
          type="single"
          value={config.frameRate}
          min={1}
          max={30}
          step={1}
          onValueChange={(value) => config = { ...config, frameRate: value }}
        />
      </Field.Field>

      <Field.Field>
        <div class="flex items-center justify-between">
          <Field.FieldLabel id={`${confidenceSliderId}-label`}>Min confidence</Field.FieldLabel>
          <span class="text-xs text-muted-foreground">{Math.round(config.confidenceThreshold * 100)}%</span>
        </div>
        <Slider
          id={confidenceSliderId}
          aria-labelledby={`${confidenceSliderId}-label`}
          type="single"
          value={Math.round(config.confidenceThreshold * 100)}
          min={0}
          max={100}
          step={5}
          onValueChange={(value) => config = { ...config, confidenceThreshold: value / 100 }}
        />
      </Field.Field>

      <Field.Field orientation="horizontal">
        <Field.FieldContent>
          <Field.FieldLabel for={gpuSwitchId}>Use GPU acceleration</Field.FieldLabel>
        </Field.FieldContent>
        <Switch
          id={gpuSwitchId}
          checked={config.useGpu}
          onCheckedChange={(checked) => config = { ...config, useGpu: checked }}
        />
      </Field.Field>

      <Field.Field orientation="horizontal">
        <Field.FieldContent>
          <Field.FieldLabel for={aiCleanupSwitchId}>Enable AI cleanup</Field.FieldLabel>
        </Field.FieldContent>
        <Switch
          id={aiCleanupSwitchId}
          checked={config.aiCleanupEnabled}
          onCheckedChange={(checked) => config = { ...config, aiCleanupEnabled: checked }}
        />
      </Field.Field>
        </Field.FieldGroup>
      </Field.FieldSet>
    {/if}

    {#if showCleanupOptions}
      <Separator />
      <Field.FieldSet>
        <Field.FieldLegend variant="label">Cleanup options</Field.FieldLegend>

        <Field.FieldGroup class="gap-4">
        <Field.Field orientation="horizontal">
          <Field.FieldContent>
            <Field.FieldLabel for={mergeSwitchId}>Merge similar subtitles</Field.FieldLabel>
          </Field.FieldContent>
          <Switch
            id={mergeSwitchId}
            checked={config.mergeSimilar}
            onCheckedChange={(checked) => config = { ...config, mergeSimilar: checked }}
          />
        </Field.Field>

        <Field.Field>
          <div class="flex items-center justify-between">
            <Field.FieldLabel id={`${similaritySliderId}-label`}>Similarity threshold</Field.FieldLabel>
            <span class="text-xs text-muted-foreground">{Math.round(config.similarityThreshold * 100)}%</span>
          </div>
          <Slider
            id={similaritySliderId}
            aria-labelledby={`${similaritySliderId}-label`}
            type="single"
            value={Math.round(config.similarityThreshold * 100)}
            min={80}
            max={98}
            step={1}
            disabled={!config.mergeSimilar}
            onValueChange={(value) => config = { ...config, similarityThreshold: value / 100 }}
          />
        </Field.Field>

        <Field.Field>
          <div class="flex items-center justify-between">
            <Field.FieldLabel id={`${maxGapSliderId}-label`}>Max gap to merge</Field.FieldLabel>
            <span class="text-xs text-muted-foreground">{config.maxGapMs} ms</span>
          </div>
          <Slider
            id={maxGapSliderId}
            aria-labelledby={`${maxGapSliderId}-label`}
            type="single"
            value={config.maxGapMs}
            min={0}
            max={1000}
            step={50}
            onValueChange={(value) => config = { ...config, maxGapMs: value }}
          />
        </Field.Field>

        <Field.Field>
          <div class="flex items-center justify-between">
            <Field.FieldLabel id={`${minCueDurationSliderId}-label`}>Minimum cue duration</Field.FieldLabel>
            <span class="text-xs text-muted-foreground">{config.minCueDurationMs} ms</span>
          </div>
          <Slider
            id={minCueDurationSliderId}
            aria-labelledby={`${minCueDurationSliderId}-label`}
            type="single"
            value={config.minCueDurationMs}
            min={0}
            max={2000}
            step={50}
            onValueChange={(value) => config = { ...config, minCueDurationMs: value }}
          />
        </Field.Field>

        <Field.Field orientation="horizontal">
          <Field.FieldContent>
            <Field.FieldLabel for={filterUrlSwitchId}>Filter URL-like watermarks</Field.FieldLabel>
          </Field.FieldContent>
          <Switch
            id={filterUrlSwitchId}
            checked={config.filterUrlLike}
            onCheckedChange={(checked) => config = { ...config, filterUrlLike: checked }}
          />
        </Field.Field>
        </Field.FieldGroup>
      </Field.FieldSet>
    {/if}

    {#if showAiOptions}
      <Separator />
      <Field.FieldSet>
        <Field.FieldLegend variant="label">AI options</Field.FieldLegend>
        <LlmProviderModelSelector
          provider={config.aiCleanupProvider}
          model={config.aiCleanupModel}
          onProviderChange={(provider) => config = { ...config, aiCleanupProvider: provider }}
          onModelChange={(model) => config = { ...config, aiCleanupModel: model }}
        />
        {#if !aiCleanupModelAvailable}
          <Item.Root variant="outline" size="xs" class="border-amber-500/40 text-amber-700 dark:text-amber-300">
            <Item.Media>
              <AlertTriangle class="size-4" />
            </Item.Media>
            <Item.Content>
              <Item.Title>AI cleanup unavailable</Item.Title>
              <Item.Description>
                Select an available AI model before running this retry.
              </Item.Description>
            </Item.Content>
          </Item.Root>
        {/if}
      </Field.FieldSet>
    {/if}
  {/snippet}
</RetryVersionDialogShell>
