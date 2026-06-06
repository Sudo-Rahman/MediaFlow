<script lang="ts">
  import { ArrowRight, Languages, Plus, X } from '@lucide/svelte';

  import { LlmProviderModelSelector } from '$lib/components/llm';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Item from '$lib/components/ui/item';
  import * as Select from '$lib/components/ui/select';
  import { mediaflowModelCatalogStore, settingsStore, translationStore } from '$lib/stores';
  import { getLLMModelDisplayName, LLM_PROVIDERS, SUPPORTED_LANGUAGES } from '$lib/types';
  import type { LanguageCode, LLMProvider } from '$lib/types';

  interface TranslationConfigPanelProps {
    onNavigateToSettings?: () => void;
  }

  let { onNavigateToSettings }: TranslationConfigPanelProps = $props();

  const targetLanguages = SUPPORTED_LANGUAGES.filter((language) => language.code !== 'auto');

  function handleSourceLangChange(value: string): void {
    translationStore.setSourceLanguage(value as LanguageCode);
  }

  function handleTargetLangChange(value: string): void {
    translationStore.setTargetLanguage(value as LanguageCode);
  }

  // Multi-model: the primary model is always the one selected in the main selector
  const additionalModels = $derived(translationStore.config.models);
  const isMultiModel = $derived(additionalModels.length > 0);

  function getModelDisplayName(provider: LLMProvider, model: string): string {
    const providerConfig = LLM_PROVIDERS[provider];
    const modelName = getLLMModelDisplayName(provider, model, mediaflowModelCatalogStore.chatModels);
    const providerName = providerConfig.name;
    return `${providerName} - ${modelName}`;
  }

  function handleAddCurrentModel(): void {
    const { provider, model } = translationStore.config;
    if (!model) return;

    // Check there's an API key for this provider
    if (!settingsStore.getLLMApiKey(provider)) return;

    translationStore.addModel(provider, model);
  }

  function handleRemoveModel(modelSelectionId: string): void {
    translationStore.removeModel(modelSelectionId);
  }

  // Whether the current primary selection can be added
  const canAddCurrent = $derived.by(() => {
    const { provider, model } = translationStore.config;
    if (!model) return false;
    return !!settingsStore.getLLMApiKey(provider);
  });

  const controlId = $props.id();
  const sourceLanguageId = `${controlId}-source-language`;
  const targetLanguageId = `${controlId}-target-language`;
</script>

<Card.Root>
  <Card.Header>
    <div class="flex items-center gap-2">
      <Languages class="size-5 text-primary" />
      <Card.Title>Translation Settings</Card.Title>
    </div>
    <Card.Description>
      Configure languages and AI model for translation
    </Card.Description>
  </Card.Header>
  <Card.Content class="space-y-6">
    <Field.FieldSet class="gap-4">
      <Field.FieldLegend variant="label" class="mb-0">Languages</Field.FieldLegend>
      <div class="flex items-center gap-3">
        <Field.Field class="flex-1">
          <Field.FieldLabel for={sourceLanguageId} class="sr-only">Source language</Field.FieldLabel>
          <Select.Root
            type="single"
            value={translationStore.config.sourceLanguage}
            onValueChange={handleSourceLangChange}
          >
            <Select.Trigger id={sourceLanguageId} class="w-full">
              {SUPPORTED_LANGUAGES.find((language) => language.code === translationStore.config.sourceLanguage)?.name || 'Select source'}
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                {#each SUPPORTED_LANGUAGES as language (language.code)}
                  <Select.Item value={language.code}>{language.name}</Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
        </Field.Field>

        <ArrowRight class="size-5 text-muted-foreground shrink-0" />

        <Field.Field class="flex-1">
          <Field.FieldLabel for={targetLanguageId} class="sr-only">Target language</Field.FieldLabel>
          <Select.Root
            type="single"
            value={translationStore.config.targetLanguage}
            onValueChange={handleTargetLangChange}
          >
            <Select.Trigger id={targetLanguageId} class="w-full">
              {targetLanguages.find((language) => language.code === translationStore.config.targetLanguage)?.name || 'Select target'}
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                {#each targetLanguages as language (language.code)}
                  <Select.Item value={language.code}>{language.name}</Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
        </Field.Field>
      </div>
    </Field.FieldSet>

    <LlmProviderModelSelector
      provider={translationStore.config.provider}
      model={translationStore.config.model}
      onProviderChange={(provider) => translationStore.setProvider(provider)}
      onModelChange={(model) => translationStore.setModel(model)}
      onNavigateToSettings={onNavigateToSettings}
    />

    <!-- Multi-Model Comparison -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <Field.FieldTitle class="text-sm font-medium">Compare Models</Field.FieldTitle>
        {#if isMultiModel}
          <Badge variant="secondary" class="text-xs">
            {additionalModels.length} model{additionalModels.length > 1 ? 's' : ''}
          </Badge>
        {/if}
      </div>
      <p class="text-xs text-muted-foreground">
        Add models to translate with multiple AI models in parallel. Each produces a separate version.
      </p>

      {#if additionalModels.length > 0}
        <div class="space-y-1.5">
          {#each additionalModels as entry (entry.id)}
            <Item.Root variant="muted" size="xs" class="flex-nowrap">
              <Item.Content class="min-w-0">
                <Item.Title class="w-full truncate">{getModelDisplayName(entry.provider, entry.model)}</Item.Title>
              </Item.Content>
              <Item.Actions>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-6 text-muted-foreground hover:text-destructive"
                  onclick={() => handleRemoveModel(entry.id)}
                >
                  <X class="size-3" />
                  <span class="sr-only">Remove model</span>
                </Button>
              </Item.Actions>
            </Item.Root>
          {/each}
        </div>
      {/if}

      <Button
        variant="outline"
        size="sm"
        class="w-full"
        onclick={handleAddCurrentModel}
        disabled={!canAddCurrent}
      >
        <Plus class="size-3.5 mr-1.5" />
        Add Current Model
      </Button>
    </div>
  </Card.Content>
</Card.Root>
