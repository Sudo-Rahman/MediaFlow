<script lang="ts">
  import { ArrowRight, Languages, Plus, X } from '@lucide/svelte';

  import { LlmProviderModelSelector } from '$lib/components/llm';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { settingsStore, translationStore } from '$lib/stores';
  import { LLM_PROVIDERS, SUPPORTED_LANGUAGES } from '$lib/types';
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
    const providerModel = providerConfig.models.find(m => m.id === model);
    const modelName = providerModel?.name || model;
    const providerName = providerConfig.name;
    return `${providerName} - ${modelName}`;
  }

  function handleAddCurrentModel(): void {
    const { provider, model } = translationStore.config;
    if (!model) return;

    // Check the primary model isn't already in the list
    const alreadyAdded = additionalModels.some(m => m.provider === provider && m.model === model);
    if (alreadyAdded) return;

    // Check there's an API key for this provider
    if (!settingsStore.getLLMApiKey(provider)) return;

    translationStore.addModel(provider, model);
  }

  function handleRemoveModel(provider: LLMProvider, model: string): void {
    translationStore.removeModel(provider, model);
  }

  // Whether the current primary selection can be added
  const canAddCurrent = $derived(() => {
    const { provider, model } = translationStore.config;
    if (!model) return false;
    if (!settingsStore.getLLMApiKey(provider)) return false;
    return !additionalModels.some(m => m.provider === provider && m.model === model);
  });
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
    <div class="space-y-4">
      <Label class="text-sm font-medium">Languages</Label>
      <div class="flex items-center gap-3">
        <div class="flex-1">
          <Select.Root
            type="single"
            value={translationStore.config.sourceLanguage}
            onValueChange={handleSourceLangChange}
          >
            <Select.Trigger class="w-full">
              {SUPPORTED_LANGUAGES.find((language) => language.code === translationStore.config.sourceLanguage)?.name || 'Select source'}
            </Select.Trigger>
            <Select.Content>
              {#each SUPPORTED_LANGUAGES as language (language.code)}
                <Select.Item value={language.code}>{language.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <ArrowRight class="size-5 text-muted-foreground shrink-0" />

        <div class="flex-1">
          <Select.Root
            type="single"
            value={translationStore.config.targetLanguage}
            onValueChange={handleTargetLangChange}
          >
            <Select.Trigger class="w-full">
              {targetLanguages.find((language) => language.code === translationStore.config.targetLanguage)?.name || 'Select target'}
            </Select.Trigger>
            <Select.Content>
              {#each targetLanguages as language (language.code)}
                <Select.Item value={language.code}>{language.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
    </div>

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
        <Label class="text-sm font-medium">Compare Models</Label>
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
          {#each additionalModels as entry (`${entry.provider}/${entry.model}`)}
            <div class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 text-sm">
              <span class="flex-1 truncate">{getModelDisplayName(entry.provider, entry.model)}</span>
              <Button
                variant="ghost"
                size="icon"
                class="size-6 text-muted-foreground hover:text-destructive"
                onclick={() => handleRemoveModel(entry.provider, entry.model)}
              >
                <X class="size-3" />
              </Button>
            </div>
          {/each}
        </div>
      {/if}

      <Button
        variant="outline"
        size="sm"
        class="w-full"
        onclick={handleAddCurrentModel}
        disabled={!canAddCurrent()}
      >
        <Plus class="size-3.5 mr-1.5" />
        Add Current Model
      </Button>
    </div>
  </Card.Content>
</Card.Root>
