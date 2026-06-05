<script lang="ts">
  import { AlertTriangle, Settings2, Users } from '@lucide/svelte';

  import type { AudioFile, DeepgramConfig, TranscriptionProvider } from '$lib/types';
  import { DEFAULT_DEEPGRAM_CONFIG } from '$lib/types';
  import { mediaflowModelCatalogStore } from '$lib/stores';
  import { RetryVersionDialogShell } from '$lib/components/shared';
  import * as Alert from '$lib/components/ui/alert';

  import * as Field from '$lib/components/ui/field';
  import { Separator } from '$lib/components/ui/separator';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';

  import LanguageSelector from './LanguageSelector.svelte';
  import ModelSelector from './ModelSelector.svelte';

  interface RetranscribeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    file: AudioFile | null;
    baseConfig: DeepgramConfig;
    provider: TranscriptionProvider;
    onConfirm: (fileId: string, versionName: string, config: DeepgramConfig) => Promise<string | null> | string | null;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    file,
    baseConfig,
    provider,
    onConfirm,
  }: RetranscribeDialogProps = $props();

  let versionName = $state('');
  let config = $state<DeepgramConfig>({ ...DEFAULT_DEEPGRAM_CONFIG });
  let validationMessage = $state('');
  const idPrefix = `retranscribe-${Math.random().toString(36).slice(2)}`;
  const punctuationSwitchId = `${idPrefix}-punctuation`;
  const smartFormatSwitchId = `${idPrefix}-smart-format`;
  const paragraphsSwitchId = `${idPrefix}-paragraphs`;
  const diarizeSwitchId = `${idPrefix}-diarize`;
  const uttSplitSliderId = `${idPrefix}-utt-split`;
  const modelOptions = $derived(provider === 'mediaflow' ? mediaflowModelCatalogStore.transcriptionModels : undefined);

  $effect(() => {
    if (open && file) {
      const versionCount = file.transcriptionVersions?.length ?? 0;
      versionName = `Version ${versionCount + 1}`;
      config = { ...baseConfig };
      validationMessage = '';
    }
  });

  async function handleConfirm() {
    if (!file) {
      return;
    }

    const errorMessage = await onConfirm(file.id, versionName.trim() || 'New version', config);
    if (errorMessage) {
      validationMessage = errorMessage;
      return;
    }

    onOpenChange(false);
  }
</script>

<RetryVersionDialogShell
  bind:open
  {onOpenChange}
  title="New Transcription"
  description={`Create a new transcription version for ${file?.name ?? 'this file'}`}
  bind:versionName
  versionNamePlaceholder="Version 1"
  confirmLabel="Transcribe"
  maxWidthClass="max-w-lg"
  onConfirm={handleConfirm}
>
  {#snippet optionsContent()}
    {#if validationMessage}
      <Alert.Root role="note" aria-live="off" class="border-amber-500/40 text-amber-700 dark:text-amber-300">
        <AlertTriangle class="size-4" />
        <Alert.Title>Choose a source language to continue</Alert.Title>
        <Alert.Description>{validationMessage}</Alert.Description>
      </Alert.Root>
    {/if}

    <Separator />

    <ModelSelector
      value={config.model}
      models={modelOptions}
      onValueChange={(model) => config = { ...config, model }}
      disabled={provider === 'mediaflow' && mediaflowModelCatalogStore.transcriptionModels.length === 0}
    />

    {#if provider === 'mediaflow' && mediaflowModelCatalogStore.transcriptionModels.length === 0}
      <Alert.Root role="note" aria-live="off">
        <AlertTriangle class="size-4" />
        <Alert.Title>MediaFlow models unavailable</Alert.Title>
        <Alert.Description>
          Managed transcription models could not be loaded.
        </Alert.Description>
      </Alert.Root>
    {/if}

    <LanguageSelector
      value={config.language}
      onValueChange={(language) => config = { ...config, language }}
    />

    <Separator />

    <Field.FieldSet>
      <Field.FieldLegend variant="label" class="flex items-center gap-2">
        <Settings2 class="size-4" />
        Options
      </Field.FieldLegend>

      <Field.FieldGroup class="gap-4">
      <Field.Field orientation="horizontal">
        <Field.FieldContent>
          <Field.FieldLabel for={punctuationSwitchId}>Auto Punctuation</Field.FieldLabel>
          <Field.FieldDescription>Add punctuation</Field.FieldDescription>
        </Field.FieldContent>
        <Switch
          id={punctuationSwitchId}
          checked={config.punctuate}
          onCheckedChange={(checked) => config = { ...config, punctuate: checked }}
        />
      </Field.Field>

      <Field.Field orientation="horizontal">
        <Field.FieldContent>
          <Field.FieldLabel for={smartFormatSwitchId}>Smart Format</Field.FieldLabel>
          <Field.FieldDescription>Format numbers, dates, currencies</Field.FieldDescription>
        </Field.FieldContent>
        <Switch
          id={smartFormatSwitchId}
          checked={config.smartFormat}
          onCheckedChange={(checked) => config = { ...config, smartFormat: checked }}
        />
      </Field.Field>

      <Field.Field orientation="horizontal">
        <Field.FieldContent>
          <Field.FieldLabel for={paragraphsSwitchId}>Paragraphs</Field.FieldLabel>
          <Field.FieldDescription>Detect paragraphs</Field.FieldDescription>
        </Field.FieldContent>
        <Switch
          id={paragraphsSwitchId}
          checked={config.paragraphs}
          onCheckedChange={(checked) => config = { ...config, paragraphs: checked }}
        />
      </Field.Field>

      <Separator />

      <Field.Field orientation="horizontal">
        <Field.FieldContent>
          <Field.FieldLabel for={diarizeSwitchId}>
            <Users class="size-4" />
            Diarization
          </Field.FieldLabel>
          <Field.FieldDescription>Identify speakers</Field.FieldDescription>
        </Field.FieldContent>
        <Switch
          id={diarizeSwitchId}
          checked={config.diarize}
          onCheckedChange={(checked) => config = { ...config, diarize: checked }}
        />
      </Field.Field>

      <Separator />

      <Field.Field>
        <Field.FieldLabel id={`${uttSplitSliderId}-label`}>Pause Threshold</Field.FieldLabel>
        <Field.FieldDescription>
            Silence duration to split phrases ({config.uttSplit.toFixed(1)}s)
        </Field.FieldDescription>
        <Slider
          id={uttSplitSliderId}
          aria-labelledby={`${uttSplitSliderId}-label`}
          type="multiple"
          value={[config.uttSplit]}
          onValueChange={(values: number[]) => config = { ...config, uttSplit: values[0] }}
          min={0.1}
          max={2.0}
          step={0.1}
        />
        <div class="flex justify-between text-xs text-muted-foreground">
          <span>0.1s</span>
          <span>2.0s</span>
        </div>
      </Field.Field>
      </Field.FieldGroup>
    </Field.FieldSet>
  {/snippet}
</RetryVersionDialogShell>
