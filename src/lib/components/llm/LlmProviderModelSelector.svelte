<script lang="ts">
  import { Bot, Check, ChevronsUpDown, Key, Plus, X } from '@lucide/svelte';
  import { useId } from 'bits-ui';

  import MediaFlowSignInPrompt from '$lib/components/account/MediaFlowSignInPrompt.svelte';
  import * as Alert from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Command from '$lib/components/ui/command';
  import * as Field from '$lib/components/ui/field';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';
  import { settingsStore } from '$lib/stores';
  import { mediaflowModelCatalogStore } from '$lib/stores/mediaflow-model-catalog.svelte';
  import {
    getLLMProviderModels,
    getSelectableLLMProviders,
    LLM_PROVIDERS,
    normalizeLLMProvider,
    normalizeLLMSelection,
  } from '$lib/types';
  import type { LLMProvider, ProviderModel } from '$lib/types';
  import { cn } from '$lib/utils';

  interface LlmProviderModelSelectorProps {
    provider: LLMProvider;
    model: string;
    onProviderChange: (provider: LLMProvider) => void;
    onModelChange: (model: string) => void;
    onNavigateToSettings?: () => void;
    mediaflowModels?: readonly ProviderModel[];
    class?: string;
  }

  let {
    provider,
    model,
    onProviderChange,
    onModelChange,
    onNavigateToSettings,
    mediaflowModels,
    class: className = '',
  }: LlmProviderModelSelectorProps = $props();

  const mediaFlowModels = $derived(mediaflowModels ?? mediaflowModelCatalogStore.chatModels);
  const providerKeys = $derived(getSelectableLLMProviders(import.meta.env.DEV, mediaFlowModels.length > 0));
  const hasSelectableProviders = $derived(providerKeys.length > 0);
  const catalogLoading = $derived(
    mediaflowModelCatalogStore.status === 'idle' || mediaflowModelCatalogStore.status === 'loading'
  );
  const catalogLoadResolved = $derived(
    mediaflowModelCatalogStore.status === 'ready' || mediaflowModelCatalogStore.status === 'unavailable'
  );
  const showProviderSelector = $derived(providerKeys.length > 1);
  const baseId = useId();
  const providerSelectId = `${baseId}-provider`;
  const modelSelectId = `${baseId}-model`;
  const normalizedSelection = $derived(
    hasSelectableProviders
      ? normalizeLLMSelection(provider, model, import.meta.env.DEV, mediaFlowModels)
      : { provider, model: '' }
  );
  const effectiveProvider = $derived(normalizedSelection.provider);
  const effectiveModel = $derived(normalizedSelection.model);

  const currentProvider = $derived(LLM_PROVIDERS[effectiveProvider]);
  const currentProviderModels = $derived(getLLMProviderModels(effectiveProvider, mediaFlowModels));
  const hasModels = $derived(currentProviderModels.length > 0);
  const currentApiKey = $derived(settingsStore.getLLMApiKey(effectiveProvider));
  const hasApiKey = $derived(!!currentApiKey);

  let openRouterOpen = $state(false);
  let openRouterSearch = $state('');

  const savedModels = $derived(settingsStore.settings.openRouterModels);
  const filteredModels = $derived(
    savedModels.filter((savedModel) => savedModel.toLowerCase().includes(openRouterSearch.toLowerCase()))
  );
  const searchMatchesExisting = $derived(
    savedModels.some((savedModel) => savedModel.toLowerCase() === openRouterSearch.toLowerCase())
  );

  // Keep controlled parent state aligned with build-restricted provider rules.
  $effect(() => {
    if (!hasSelectableProviders) {
      if (catalogLoadResolved && model) {
        onModelChange('');
      }
      return;
    }

    if (provider !== effectiveProvider) {
      onProviderChange(effectiveProvider);
    }

    if (model !== effectiveModel) {
      onModelChange(effectiveModel);
    }
  });

  function getProviderApiKey(providerKey: LLMProvider): string {
    return settingsStore.getLLMApiKey(providerKey);
  }

  function getSelectedModelName(): string {
    const providerModel = currentProviderModels.find((providerItem: ProviderModel) => providerItem.id === effectiveModel);
    return providerModel?.name || 'Select model';
  }

  function handleProviderChange(value: string): void {
    const nextProvider = normalizeLLMProvider(value as LLMProvider, import.meta.env.DEV, mediaFlowModels.length > 0);
    onProviderChange(nextProvider);

    const providerModels = getLLMProviderModels(nextProvider, mediaFlowModels);
    if (providerModels.length > 0) {
      onModelChange(providerModels[0].id);
      return;
    }

    onModelChange(settingsStore.settings.openRouterModels[0] || '');
  }

  function handleModelChange(value: string): void {
    const nextSelection = normalizeLLMSelection(effectiveProvider, value, import.meta.env.DEV, mediaFlowModels);
    if (nextSelection.provider !== effectiveProvider) {
      onProviderChange(nextSelection.provider);
    }
    onModelChange(nextSelection.model);
  }

  function handleOpenRouterModelSelect(modelId: string): void {
    onModelChange(modelId);
    openRouterOpen = false;
    openRouterSearch = '';
  }

  async function handleAddNewModel(): Promise<void> {
    const trimmed = openRouterSearch.trim();
    if (!trimmed) return;

    await settingsStore.addOpenRouterModel(trimmed);
    onModelChange(trimmed);
    openRouterOpen = false;
    openRouterSearch = '';
  }

  async function handleRemoveModel(modelId: string): Promise<void> {
    await settingsStore.removeOpenRouterModel(modelId);

    if (effectiveModel === modelId) {
      onModelChange(settingsStore.settings.openRouterModels[0] || '');
    }
  }
</script>

<div class={cn('space-y-4', className)}>
  {#if !hasSelectableProviders}
    <Alert.Root role="note" aria-live="off">
      <Bot class="size-4" />
      <Alert.Title>{catalogLoading ? 'MediaFlow models loading' : 'MediaFlow models unavailable'}</Alert.Title>
      <Alert.Description>
        {catalogLoading ? 'Managed AI models are loading.' : 'Managed AI models could not be loaded.'}
      </Alert.Description>
    </Alert.Root>
  {:else if showProviderSelector}
    <Field.Field>
      <Field.FieldLabel for={providerSelectId}>AI Provider</Field.FieldLabel>
      <Select.Root
        type="single"
        value={effectiveProvider}
        onValueChange={handleProviderChange}
      >
        <Select.Trigger id={providerSelectId} class="w-full">
          <div class="flex items-center gap-2">
            <Bot class="size-4" />
            <span>{currentProvider.name}</span>
            {#if !hasApiKey}
              <Badge variant="destructive" class="ml-auto text-xs">
                {effectiveProvider === 'mediaflow' ? 'Sign in' : 'No API Key'}
              </Badge>
            {/if}
          </div>
        </Select.Trigger>
        <Select.Content>
            <Select.Group>
              {#each providerKeys as providerKey (providerKey)}
              {@const providerItem = LLM_PROVIDERS[providerKey]}
              <Select.Item value={providerKey}>
                  <div class="flex items-center gap-2">
                  <span>{providerItem.name}</span>
                  {#if !getProviderApiKey(providerKey)}
                      <Badge variant="outline" class="text-xs">
                        {providerKey === 'mediaflow' ? 'Sign in' : 'No key'}
                      </Badge>
                  {/if}
                  </div>
              </Select.Item>
              {/each}
            </Select.Group>
        </Select.Content>
      </Select.Root>
    </Field.Field>
  {/if}

  {#if hasSelectableProviders}
  <Field.Field>
    <Field.FieldLabel for={modelSelectId}>Model</Field.FieldLabel>
    {#if hasModels}
      <Select.Root
        type="single"
        value={effectiveModel}
        onValueChange={handleModelChange}
      >
        <Select.Trigger id={modelSelectId} class="w-full">
          {getSelectedModelName()}
        </Select.Trigger>
        <Select.Content>
          <Select.Group>
            {#each currentProviderModels as providerModel (providerModel.id)}
              <Select.Item value={providerModel.id}>{providerModel.name}</Select.Item>
            {/each}
          </Select.Group>
        </Select.Content>
      </Select.Root>
    {:else}
      <Popover.Root bind:open={openRouterOpen}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              id={modelSelectId}
              variant="outline"
              role="combobox"
              aria-expanded={openRouterOpen}
              class="w-full justify-between font-normal"
            >
              <span class="truncate">
                {effectiveModel || 'Select or enter model...'}
              </span>
              <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-[var(--bits-popover-anchor-width)] p-0" align="start">
          <Command.Root shouldFilter={false} class="[&_.cn-command-item-indicator]:hidden">
            <Command.Input
              placeholder="Search or enter model ID..."
              bind:value={openRouterSearch}
            />
            <Command.List class="max-h-[calc(50dvh-5rem)]">
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
                {#each filteredModels as savedModel (savedModel)}
                  <div class="flex items-center gap-1">
                    <Command.Item
                      value={savedModel}
                      onSelect={() => handleOpenRouterModelSelect(savedModel)}
                      class="min-w-0 flex-1 rounded-full"
                    >
                      <div class="flex min-w-0 flex-1 items-center gap-2">
                        {#if effectiveModel === savedModel}
                          <Check class="size-4 shrink-0" />
                        {:else}
                          <div class="size-4 shrink-0"></div>
                        {/if}
                        <span class="truncate">{savedModel}</span>
                      </div>
                    </Command.Item>
                    <button
                      type="button"
                      class="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                      onclick={() => handleRemoveModel(savedModel)}
                      title="Remove model"
                      aria-label={`Remove ${savedModel}`}
                    >
                      <X class="size-3" />
                    </button>
                  </div>
                {/each}
              </Command.Group>
              {#if openRouterSearch.trim() && !searchMatchesExisting}
                <Command.Group>
                  <Command.Item
                    value={`add-${openRouterSearch}`}
                    onSelect={handleAddNewModel}
                    class="w-full items-center gap-2 rounded-full"
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
  </Field.Field>
  {/if}

  {#if hasSelectableProviders && !hasApiKey}
    {#if effectiveProvider === 'mediaflow'}
      <MediaFlowSignInPrompt
        title="Sign in to use MediaFlow AI"
        description="MediaFlow uses your account credits for managed AI features."
      />
    {:else}
      <Alert.Root variant="destructive">
        <Key class="size-4" />
        <Alert.Title>API key required</Alert.Title>
        <Alert.Description>
          Configure your {currentProvider.name} API key in Settings
        </Alert.Description>
        {#if onNavigateToSettings}
          <Alert.Action>
            <Button variant="outline" size="sm" onclick={() => onNavigateToSettings?.()}>
              Settings
            </Button>
          </Alert.Action>
        {/if}
      </Alert.Root>
    {/if}
  {/if}
</div>
