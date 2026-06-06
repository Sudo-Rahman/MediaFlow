<script lang="ts">
  import { AlertTriangle, Info, RotateCw, Sparkles } from '@lucide/svelte';
  import { useId } from 'bits-ui';

  import { LlmProviderModelSelector } from '$lib/components/llm';
  import * as Field from '$lib/components/ui/field';
  import * as Item from '$lib/components/ui/item';
  import { Separator } from '$lib/components/ui/separator';
  import * as Select from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import {
    DEFAULT_SUBTITLE_OCR_CONFIG,
    type SubtitleOcrConfig,
    type SubtitleOcrRetryMode,
  } from '$lib/types';
  import { OCR_LANGUAGES } from '$lib/types/video-ocr';
  import { cloneSubtitleOcrConfig } from './subtitle-ocr-retry-dialog-state';

  interface SubtitleOcrRetryOptionsFieldsProps {
    mode: SubtitleOcrRetryMode;
    config: SubtitleOcrConfig;
    scope: 'single' | 'all';
    activeVersionName?: string;
    aiSelectionUnavailable?: boolean;
    onNavigateToSettings?: () => void;
  }

  let {
    mode = $bindable<SubtitleOcrRetryMode>('full_ocr'),
    config = $bindable<SubtitleOcrConfig>(cloneSubtitleOcrConfig(DEFAULT_SUBTITLE_OCR_CONFIG)),
    scope,
    activeVersionName,
    aiSelectionUnavailable = false,
    onNavigateToSettings,
  }: SubtitleOcrRetryOptionsFieldsProps = $props();

  const baseId = useId();
  const retryModeSelectId = `${baseId}-mode`;
  const ocrModelSelectId = `${baseId}-ocr-model`;
  const gpuSwitchId = `${baseId}-gpu`;
  const aiCleanupSwitchId = `${baseId}-ai-cleanup`;

  const selectedOcrModelLabel = $derived(
    OCR_LANGUAGES.find((language) => language.value === config.ocrModel)?.label ?? 'Select OCR model',
  );
  const showFullOcrOptions = $derived(mode === 'full_ocr');
  const showAiOptions = $derived(mode === 'ai_cleanup_only' || config.aiCleanupEnabled);
  const cleanupInfoTitle = $derived(scope === 'all' ? 'Selected versions' : 'Selected version');
  const cleanupInfoDescription = $derived(
    scope === 'all'
      ? "Runs AI cleanup on each source's active version without re-running OCR."
      : `Runs AI cleanup on ${activeVersionName ?? 'the current version'} without re-running OCR.`,
  );

  function handleOcrModelChange(value: string): void {
    config = { ...config, ocrModel: value as SubtitleOcrConfig['ocrModel'] };
  }

  function getModeLabel(value: SubtitleOcrRetryMode): string {
    switch (value) {
      case 'full_ocr':
        return 'Full OCR';
      case 'ai_cleanup_only':
        return 'AI cleanup only';
    }
  }
</script>

<Field.Field>
  <Field.FieldLabel for={retryModeSelectId}>Retry mode</Field.FieldLabel>
  <Select.Root
    type="single"
    value={mode}
    onValueChange={(value) => value && (mode = value as SubtitleOcrRetryMode)}
  >
    <Select.Trigger id={retryModeSelectId} class="w-full">
      {getModeLabel(mode)}
    </Select.Trigger>
    <Select.Content>
      <Select.Group>
        <Select.Item value="full_ocr">
          <div class="flex items-center gap-2">
            <RotateCw class="size-4" />
            <span>Full OCR</span>
          </div>
        </Select.Item>
        <Select.Item value="ai_cleanup_only">
          <div class="flex items-center gap-2">
            <Sparkles class="size-4" />
            <span>AI cleanup only</span>
          </div>
        </Select.Item>
      </Select.Group>
    </Select.Content>
  </Select.Root>
  <Field.FieldDescription>
    Defaults use the current global Subtitle OCR options.
  </Field.FieldDescription>
</Field.Field>

{#if mode === 'ai_cleanup_only'}
  <Item.Root variant="outline" size="xs">
    <Item.Media>
      <Info class="size-4" />
    </Item.Media>
    <Item.Content>
      <Item.Title>{cleanupInfoTitle}</Item.Title>
      <Item.Description>
        {cleanupInfoDescription}
      </Item.Description>
    </Item.Content>
  </Item.Root>
{/if}

{#if showFullOcrOptions}
  <Separator />
  <Field.FieldGroup class="gap-4">
    <Field.Field>
      <Field.FieldLabel for={ocrModelSelectId}>OCR model</Field.FieldLabel>
      <Select.Root type="single" value={config.ocrModel} onValueChange={handleOcrModelChange}>
        <Select.Trigger id={ocrModelSelectId} class="w-full">
          {selectedOcrModelLabel}
        </Select.Trigger>
        <Select.Content>
          <Select.Group>
            {#each OCR_LANGUAGES as language (language.value)}
              <Select.Item value={language.value}>
                <span>{language.label}</span>
                <span class="ml-2 text-xs text-muted-foreground">{language.description}</span>
              </Select.Item>
            {/each}
          </Select.Group>
        </Select.Content>
      </Select.Root>
      <Field.FieldDescription>
        Source item OCR overrides still take priority over this default.
      </Field.FieldDescription>
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
        <Field.FieldLabel for={aiCleanupSwitchId}>AI cleanup</Field.FieldLabel>
        <Field.FieldDescription>
          Correct OCR errors and merge duplicate consecutive cues after OCR.
        </Field.FieldDescription>
      </Field.FieldContent>
      <Switch
        id={aiCleanupSwitchId}
        checked={config.aiCleanupEnabled}
        onCheckedChange={(checked) => config = { ...config, aiCleanupEnabled: checked }}
      />
    </Field.Field>
  </Field.FieldGroup>
{/if}

{#if showAiOptions}
  <Separator />
  <LlmProviderModelSelector
    provider={config.aiCleanupProvider}
    model={config.aiCleanupModel}
    onProviderChange={(provider) => config = { ...config, aiCleanupProvider: provider }}
    onModelChange={(model) => config = { ...config, aiCleanupModel: model }}
    {onNavigateToSettings}
  />
  {#if aiSelectionUnavailable}
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
{/if}
