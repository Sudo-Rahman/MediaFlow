<script lang="ts">
  import { ArrowRight } from '@lucide/svelte';

  import { LlmProviderModelSelector } from '$lib/components/llm';
  import { RetryVersionDialogShell } from '$lib/components/shared';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as Item from '$lib/components/ui/item';
  import * as Select from '$lib/components/ui/select';
  import {
    getDefaultLLMModel,
    getDefaultLLMProvider,
    LLM_PROVIDERS,
    normalizeLLMSelection,
    SUPPORTED_LANGUAGES,
  } from '$lib/types';
  import type {
    LLMProvider,
    LanguageCode,
    TranslationModelSelection,
    TranslationVersion,
  } from '$lib/types';

  interface TranslationRetryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    fileName: string;
    existingVersions: TranslationVersion[];
    defaultProvider: LLMProvider;
    defaultModel: string;
    defaultSourceLanguage: LanguageCode;
    defaultTargetLanguage: LanguageCode;
    defaultBatchCount: number;
    defaultModels: TranslationModelSelection[];
    isCompareMode: boolean;
    onConfirm: (opts: {
      versionName: string;
      provider: LLMProvider;
      model: string;
      sourceLanguage: LanguageCode;
      targetLanguage: LanguageCode;
      batchCount: number;
      models: TranslationModelSelection[];
    }) => void;
    onNavigateToSettings?: () => void;
  }

  let {
    open,
    onOpenChange,
    fileName,
    existingVersions,
    defaultProvider,
    defaultModel,
    defaultSourceLanguage,
    defaultTargetLanguage,
    defaultBatchCount,
    defaultModels,
    isCompareMode,
    onConfirm,
    onNavigateToSettings,
  }: TranslationRetryDialogProps = $props();

  const defaultRetryProvider = getDefaultLLMProvider();
  let versionName = $state('');
  let provider = $state<LLMProvider>(defaultRetryProvider);
  let model = $state(getDefaultLLMModel(defaultRetryProvider));
  let sourceLanguage = $state<LanguageCode>('auto');
  let targetLanguage = $state<LanguageCode>('fr');
  let batchCount = $state(1);
  let models = $state<TranslationModelSelection[]>([]);

  const targetLanguages = SUPPORTED_LANGUAGES.filter((lang) => lang.code !== 'auto');
  const compareModelDisplay = $derived(
    models.map((entry) => {
      const provider = LLM_PROVIDERS[entry.provider];
      const modelName = provider.models.find((modelEntry) => modelEntry.id === entry.model)?.name ?? entry.model;
      return {
        id: entry.id,
        label: `${provider.name} - ${modelName}`,
      };
    })
  );
  const canConfirm = $derived(isCompareMode || !!model);

  $effect(() => {
    if (open) {
      const defaultSelection = normalizeLLMSelection(defaultProvider, defaultModel);
      versionName = `Version ${existingVersions.length + 1}`;
      provider = defaultSelection.provider;
      model = defaultSelection.model;
      sourceLanguage = defaultSourceLanguage;
      targetLanguage = defaultTargetLanguage;
      batchCount = defaultBatchCount;
      models = defaultModels.map((entry) => {
        const selection = normalizeLLMSelection(entry.provider, entry.model);
        return { ...entry, provider: selection.provider, model: selection.model };
      });
    }
  });

  function handleConfirm(): void {
    const selection = normalizeLLMSelection(provider, model);
    onConfirm({
      versionName: versionName.trim() || `Version ${existingVersions.length + 1}`,
      provider: selection.provider,
      model: selection.model,
      sourceLanguage,
      targetLanguage,
      batchCount: Math.max(1, batchCount),
      models: models.map((entry) => {
        const selection = normalizeLLMSelection(entry.provider, entry.model);
        return { ...entry, provider: selection.provider, model: selection.model };
      }),
    });
    onOpenChange(false);
  }

  const controlId = $props.id();
  const sourceLanguageId = `${controlId}-retry-source-language`;
  const targetLanguageId = `${controlId}-retry-target-language`;
  const batchCountId = `${controlId}-retry-batch-count`;
</script>

<RetryVersionDialogShell
  {open}
  {onOpenChange}
  title="Translate Again"
  description={`Create a new translation version for ${fileName || 'this file'}`}
  bind:versionName
  versionNamePlaceholder="Version name"
  confirmLabel="Translate"
  maxWidthClass="max-w-md"
  confirmDisabled={!canConfirm}
  onConfirm={handleConfirm}
>
  {#snippet optionsContent()}
    <Field.FieldSet class="gap-2">
      <Field.FieldLegend variant="label" class="mb-0">Languages</Field.FieldLegend>
      <div class="flex items-center gap-3">
        <Field.Field class="flex-1">
          <Field.FieldLabel for={sourceLanguageId} class="sr-only">Source language</Field.FieldLabel>
          <Select.Root
            type="single"
            value={sourceLanguage}
            onValueChange={(value) => sourceLanguage = value as LanguageCode}
          >
            <Select.Trigger id={sourceLanguageId} class="w-full h-9">
              {SUPPORTED_LANGUAGES.find((lang) => lang.code === sourceLanguage)?.name || 'Source'}
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                {#each SUPPORTED_LANGUAGES as lang (lang.code)}
                  <Select.Item value={lang.code}>{lang.name}</Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
        </Field.Field>

        <ArrowRight class="size-4 text-muted-foreground shrink-0" />

        <Field.Field class="flex-1">
          <Field.FieldLabel for={targetLanguageId} class="sr-only">Target language</Field.FieldLabel>
          <Select.Root
            type="single"
            value={targetLanguage}
            onValueChange={(value) => targetLanguage = value as LanguageCode}
          >
            <Select.Trigger id={targetLanguageId} class="w-full h-9">
              {targetLanguages.find((lang) => lang.code === targetLanguage)?.name || 'Target'}
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                {#each targetLanguages as lang (lang.code)}
                  <Select.Item value={lang.code}>{lang.name}</Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
        </Field.Field>
      </div>
    </Field.FieldSet>

    {#if isCompareMode}
      <Field.Field>
        <Field.FieldTitle class="text-sm">Compare models</Field.FieldTitle>
        <Field.FieldDescription class="text-xs">
          Using active Compare Models selection from the tool.
        </Field.FieldDescription>
        <div class="space-y-1">
          {#each compareModelDisplay as modelEntry (modelEntry.id)}
            <Item.Root variant="outline" size="xs">
              <Item.Title class="truncate text-xs">{modelEntry.label}</Item.Title>
            </Item.Root>
          {/each}
        </div>
      </Field.Field>
    {:else}
      <LlmProviderModelSelector
        {provider}
        {model}
        onProviderChange={(nextProvider) => {
          provider = nextProvider;
          model = '';
        }}
        onModelChange={(nextModel) => {
          model = nextModel;
        }}
        {onNavigateToSettings}
      />
    {/if}

    <Field.Field>
      <Field.FieldLabel for={batchCountId} class="text-sm">Number of batches</Field.FieldLabel>
      <Input
        id={batchCountId}
        type="number"
        min="1"
        max="20"
        bind:value={batchCount}
        class="h-9"
      />
      <Field.FieldDescription class="text-xs">
        Split file into N parts to avoid token limits.
      </Field.FieldDescription>
    </Field.Field>
  {/snippet}
</RetryVersionDialogShell>
