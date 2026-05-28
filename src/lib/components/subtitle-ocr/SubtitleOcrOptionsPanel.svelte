<script lang="ts">
  import { Play, Settings, Square } from '@lucide/svelte';
  import { useId } from 'bits-ui';

  import { LlmProviderModelSelector } from '$lib/components/llm';
  import { Button } from '$lib/components/ui/button';
  import * as Field from '$lib/components/ui/field';
  import { Separator } from '$lib/components/ui/separator';
  import * as Select from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import type { SubtitleOcrConfig } from '$lib/types';
  import { OCR_LANGUAGES } from '$lib/types/video-ocr';

  interface SubtitleOcrOptionsPanelProps {
    config: SubtitleOcrConfig;
    canStart: boolean;
    isProcessing: boolean;
    readyCount: number;
    actionHint: string;
    onConfigChange: (updates: Partial<SubtitleOcrConfig>) => void;
    onStart: () => void;
    onCancel: () => void;
    onNavigateToSettings?: () => void;
  }

  let {
    config,
    canStart,
    isProcessing,
    readyCount,
    actionHint,
    onConfigChange,
    onStart,
    onCancel,
    onNavigateToSettings,
  }: SubtitleOcrOptionsPanelProps = $props();

  const baseId = useId();
  const ocrModelSelectId = `${baseId}-ocr-model`;
  const gpuSwitchId = `${baseId}-gpu`;
  const aiCleanupSwitchId = `${baseId}-ai-cleanup`;

  const selectedOcrModelLabel = $derived(
    OCR_LANGUAGES.find((language) => language.value === config.ocrModel)?.label ?? 'Select OCR model',
  );

  function handleOcrModelChange(value: string): void {
    onConfigChange({ ocrModel: value as SubtitleOcrConfig['ocrModel'] });
  }

  function handleStartAction(): void {
    if (!canStart) {
      return;
    }

    onStart();
  }
</script>

<Field.FieldGroup class="gap-6">
  <div class="flex items-center gap-2">
    <Settings class="size-5 text-muted-foreground" />
    <h3 class="font-semibold">Subtitle OCR Options</h3>
  </div>

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
      Used by source items set to Default.
    </Field.FieldDescription>
  </Field.Field>

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

  <Separator />

  <Field.FieldSet>
    <Field.FieldLegend variant="label">AI cleanup</Field.FieldLegend>
    <Field.FieldGroup class="gap-4">
      <Field.Field orientation="horizontal">
        <Field.FieldContent>
          <Field.FieldLabel for={aiCleanupSwitchId}>AI cleanup</Field.FieldLabel>
          <Field.FieldDescription>
            Correct OCR errors and merge duplicate consecutive cues.
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
      {/if}
    </Field.FieldGroup>
  </Field.FieldSet>

  <Separator />

  <div class="space-y-2">
    {#if isProcessing}
      <Button variant="destructive" class="w-full" onclick={onCancel}>
        <Square class="mr-2 size-4" />
        Cancel Subtitle OCR
      </Button>
    {:else}
      <Button class="w-full" disabled={!canStart} onclick={handleStartAction}>
        <Play class="mr-2 size-4" />
        Start OCR ({readyCount})
      </Button>
    {/if}

    {#if !canStart && !isProcessing}
      <p class="text-center text-xs text-muted-foreground">
        {actionHint}
      </p>
    {/if}
  </div>
</Field.FieldGroup>
