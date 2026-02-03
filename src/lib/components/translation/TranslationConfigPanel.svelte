<script lang="ts">
  import { Languages, ArrowRight, Bot, Key, ChevronsUpDown, Check, X, Plus } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import * as Select from '$lib/components/ui/select';
  import * as Popover from '$lib/components/ui/popover';
  import * as Command from '$lib/components/ui/command';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';

  import { translationStore, settingsStore } from '$lib/stores';
  import { LLM_PROVIDERS, SUPPORTED_LANGUAGES, type LLMProvider, type LanguageCode, type ProviderModel } from '$lib/types';

  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;

  interface TranslationConfigPanelProps {
    onNavigateToSettings?: () => void;
  }

  let { onNavigateToSettings }: TranslationConfigPanelProps = $props();

  // Filter out 'auto' for target language
  const targetLanguages = SUPPORTED_LANGUAGES.filter(l => l.code !== 'auto');

  // Provider keys for iteration
  const providerKeys: LLMProvider[] = ['google', 'anthropic', 'openai', 'openrouter'];

  // Get current provider info
  const currentProvider = $derived(LLM_PROVIDERS[translationStore.config.provider as LLMProvider]);
  const hasModels = $derived(currentProvider.models.length > 0);
  const currentApiKey = $derived(settingsStore.getLLMApiKey(translationStore.config.provider));
  const hasApiKey = $derived(!!currentApiKey);

  // OpenRouter combobox state
  let openRouterOpen = $state(false);
  let openRouterSearch = $state('');

  // Saved OpenRouter models from settings
  const savedModels = $derived(settingsStore.settings.openRouterModels);

  // Filter models based on search
  const filteredModels = $derived(
    savedModels.filter(m => m.toLowerCase().includes(openRouterSearch.toLowerCase()))
  );

  // Check if search matches an existing model
  const searchMatchesExisting = $derived(
    savedModels.some(m => m.toLowerCase() === openRouterSearch.toLowerCase())
  );

  function getProviderApiKey(provider: LLMProvider): string {
    return settingsStore.getLLMApiKey(provider);
  }

  function getSelectedModelName(): string {
    const model = currentProvider.models.find((m: ProviderModel) => m.id === translationStore.config.model);
    return model?.name || 'Select model';
  }

  function handleProviderChange(value: string) {
    translationStore.setProvider(value as LLMProvider);
    // Set default model for providers with fixed models
    const provider = LLM_PROVIDERS[value as LLMProvider];
    if (provider.models.length > 0) {
      translationStore.setModel(provider.models[0].id);
    } else {
      // For OpenRouter, use the first saved model or empty
      const firstSaved = settingsStore.settings.openRouterModels[0];
      translationStore.setModel(firstSaved || '');
    }
  }

  function handleModelChange(value: string) {
    translationStore.setModel(value);
  }

  function handleOpenRouterModelSelect(modelId: string) {
    translationStore.setModel(modelId);
    openRouterOpen = false;
    openRouterSearch = '';
  }

  async function handleAddNewModel() {
    const trimmed = openRouterSearch.trim();
    if (!trimmed) return;
    
    await settingsStore.addOpenRouterModel(trimmed);
    translationStore.setModel(trimmed);
    openRouterOpen = false;
    openRouterSearch = '';
  }

  async function handleRemoveModel(e: MouseEvent, modelId: string) {
    e.stopPropagation();
    await settingsStore.removeOpenRouterModel(modelId);
    // If we removed the currently selected model, clear it
    if (translationStore.config.model === modelId) {
      const firstRemaining = settingsStore.settings.openRouterModels[0];
      translationStore.setModel(firstRemaining || '');
    }
  }

  function handleSourceLangChange(value: string) {
    translationStore.setSourceLanguage(value as LanguageCode);
  }

  function handleTargetLangChange(value: string) {
    translationStore.setTargetLanguage(value as LanguageCode);
  }
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
    <!-- Language Selection -->
    <div class="space-y-4">
      <Label class="text-sm font-medium">Languages</Label>
      <div class="flex items-center gap-3">
        <!-- Source Language -->
        <div class="flex-1">
          <Select.Root
            type="single"
            value={translationStore.config.sourceLanguage}
            onValueChange={handleSourceLangChange}
          >
            <Select.Trigger class="w-full">
              {SUPPORTED_LANGUAGES.find(l => l.code === translationStore.config.sourceLanguage)?.name || 'Select source'}
            </Select.Trigger>
            <Select.Content>
              {#each SUPPORTED_LANGUAGES as lang (lang.code)}
                <Select.Item value={lang.code}>{lang.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <ArrowRight class="size-5 text-muted-foreground shrink-0" />

        <!-- Target Language -->
        <div class="flex-1">
          <Select.Root
            type="single"
            value={translationStore.config.targetLanguage}
            onValueChange={handleTargetLangChange}
          >
            <Select.Trigger class="w-full">
              {targetLanguages.find(l => l.code === translationStore.config.targetLanguage)?.name || 'Select target'}
            </Select.Trigger>
            <Select.Content>
              {#each targetLanguages as lang (lang.code)}
                <Select.Item value={lang.code}>{lang.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
    </div>

    <!-- Provider Selection -->
    <div class="space-y-2">
      <Label class="text-sm font-medium">AI Provider</Label>
      <Select.Root
        type="single"
        value={translationStore.config.provider}
        onValueChange={handleProviderChange}
      >
        <Select.Trigger class="w-full">
          <div class="flex items-center gap-2">
            <Bot class="size-4" />
            <span>{currentProvider.name}</span>
            {#if !hasApiKey}
              <Badge variant="destructive" class="ml-auto text-xs">No API Key</Badge>
            {/if}
          </div>
        </Select.Trigger>
        <Select.Content>
          {#each providerKeys as providerKey (providerKey)}
            {@const provider = LLM_PROVIDERS[providerKey]}
            <Select.Item value={providerKey}>
              <div class="flex items-center gap-2">
                <span>{provider.name}</span>
                {#if !getProviderApiKey(providerKey)}
                  <Badge variant="outline" class="text-xs">No key</Badge>
                {/if}
              </div>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <!-- Model Selection -->
    <div class="space-y-2">
      <Label class="text-sm font-medium">Model</Label>
      {#if hasModels}
        <Select.Root
          type="single"
          value={translationStore.config.model}
          onValueChange={handleModelChange}
        >
          <Select.Trigger class="w-full">
            {getSelectedModelName()}
          </Select.Trigger>
          <Select.Content>
            {#each currentProvider.models as model (model.id)}
              <Select.Item value={model.id}>{model.name}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      {:else}
        <!-- OpenRouter: Combobox with saved models -->
        <Popover.Root bind:open={openRouterOpen}>
          <Popover.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="outline"
                role="combobox"
                aria-expanded={openRouterOpen}
                class="w-full justify-between font-normal"
              >
                <span class="truncate">
                  {translationStore.config.model || 'Select or enter model...'}
                </span>
                <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content class="w-[var(--bits-popover-anchor-width)] p-0" align="start">
            <Command.Root shouldFilter={false}>
              <Command.Input 
                placeholder="Search or enter model ID..." 
                bind:value={openRouterSearch}
              />
              <Command.List>
                <Command.Empty>
                  {#if openRouterSearch.trim()}
                    <button
                      type="button"
                      class="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent rounded cursor-pointer"
                      onclick={handleAddNewModel}
                    >
                      <Plus class="size-4" />
                      <span>Add "{openRouterSearch.trim()}"</span>
                    </button>
                  {:else}
                    <span class="text-muted-foreground">No saved models</span>
                  {/if}
                </Command.Empty>
                <Command.Group>
                  {#each filteredModels as model (model)}
                    <Command.Item
                      value={model}
                      onSelect={() => handleOpenRouterModelSelect(model)}
                      class="flex items-center justify-between"
                    >
                      <div class="flex items-center gap-2 min-w-0 flex-1">
                        {#if translationStore.config.model === model}
                          <Check class="size-4 shrink-0" />
                        {:else}
                          <div class="size-4 shrink-0"></div>
                        {/if}
                        <span class="truncate">{model}</span>
                      </div>
                      <button
                        type="button"
                        class="size-6 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive shrink-0"
                        onclick={(e) => handleRemoveModel(e, model)}
                        title="Remove model"
                      >
                        <X class="size-3" />
                      </button>
                    </Command.Item>
                  {/each}
                </Command.Group>
                {#if openRouterSearch.trim() && !searchMatchesExisting}
                  <Command.Group>
                    <Command.Item
                      value={`add-${openRouterSearch}`}
                      onSelect={handleAddNewModel}
                      class="flex items-center gap-2"
                    >
                      <Plus class="size-4" />
                      <span>Add "{openRouterSearch.trim()}"</span>
                    </Command.Item>
                  </Command.Group>
                {/if}
              </Command.List>
            </Command.Root>
          </Popover.Content>
        </Popover.Root>
        <p class="text-xs text-muted-foreground">
          Type a model ID and press Enter to save it
        </p>
      {/if}
    </div>

    <!-- API Key Warning -->
    {#if !hasApiKey}
      <div class="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
        <Key class="size-4 text-destructive shrink-0" />
        <div class="flex-1 text-sm">
          <p class="font-medium text-destructive">API key required</p>
          <p class="text-muted-foreground">
            Configure your {currentProvider.name} API key in Settings
          </p>
        </div>
        <Button variant="outline" size="sm" onclick={() => onNavigateToSettings?.()}>
          Settings
        </Button>
      </div>
    {/if}
  </Card.Content>
</Card.Root>

