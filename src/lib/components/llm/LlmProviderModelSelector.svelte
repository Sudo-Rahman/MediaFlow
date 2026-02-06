<script lang="ts">
  import { Bot, Check, ChevronsUpDown, Key, Plus, X } from '@lucide/svelte';

  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Command from '$lib/components/ui/command';
  import { Label } from '$lib/components/ui/label';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';
  import { settingsStore } from '$lib/stores';
  import { LLM_PROVIDERS } from '$lib/types';
  import type { LLMProvider, ProviderModel } from '$lib/types';
  import { cn } from '$lib/utils';

  interface LlmProviderModelSelectorProps {
    provider: LLMProvider;
    model: string;
    onProviderChange: (provider: LLMProvider) => void;
    onModelChange: (model: string) => void;
    onNavigateToSettings?: () => void;
    class?: string;
  }

  let {
    provider,
    model,
    onProviderChange,
    onModelChange,
    onNavigateToSettings,
    class: className = '',
  }: LlmProviderModelSelectorProps = $props();

  const providerKeys: LLMProvider[] = ['google', 'anthropic', 'openai', 'openrouter'];

  const currentProvider = $derived(LLM_PROVIDERS[provider]);
  const hasModels = $derived(currentProvider.models.length > 0);
  const currentApiKey = $derived(settingsStore.getLLMApiKey(provider));
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

  function getProviderApiKey(providerKey: LLMProvider): string {
    return settingsStore.getLLMApiKey(providerKey);
  }

  function getSelectedModelName(): string {
    const providerModel = currentProvider.models.find((providerItem: ProviderModel) => providerItem.id === model);
    return providerModel?.name || 'Select model';
  }

  function handleProviderChange(value: string): void {
    const nextProvider = value as LLMProvider;
    onProviderChange(nextProvider);

    const providerConfig = LLM_PROVIDERS[nextProvider];
    if (providerConfig.models.length > 0) {
      onModelChange(providerConfig.models[0].id);
      return;
    }

    onModelChange(settingsStore.settings.openRouterModels[0] || '');
  }

  function handleModelChange(value: string): void {
    onModelChange(value);
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

  async function handleRemoveModel(event: MouseEvent, modelId: string): Promise<void> {
    event.stopPropagation();
    await settingsStore.removeOpenRouterModel(modelId);

    if (model === modelId) {
      onModelChange(settingsStore.settings.openRouterModels[0] || '');
    }
  }
</script>

<div class={cn('space-y-4', className)}>
  <div class="space-y-2">
    <Label class="text-sm font-medium">AI Provider</Label>
    <Select.Root
      type="single"
      value={provider}
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
          {@const providerItem = LLM_PROVIDERS[providerKey]}
          <Select.Item value={providerKey}>
            <div class="flex items-center gap-2">
              <span>{providerItem.name}</span>
              {#if !getProviderApiKey(providerKey)}
                <Badge variant="outline" class="text-xs">No key</Badge>
              {/if}
            </div>
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="space-y-2">
    <Label class="text-sm font-medium">Model</Label>
    {#if hasModels}
      <Select.Root
        type="single"
        value={model}
        onValueChange={handleModelChange}
      >
        <Select.Trigger class="w-full">
          {getSelectedModelName()}
        </Select.Trigger>
        <Select.Content>
          {#each currentProvider.models as providerModel (providerModel.id)}
            <Select.Item value={providerModel.id}>{providerModel.name}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    {:else}
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
                {model || 'Select or enter model...'}
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
                {#each filteredModels as savedModel (savedModel)}
                  <Command.Item
                    value={savedModel}
                    onSelect={() => handleOpenRouterModelSelect(savedModel)}
                    class="flex items-center justify-between"
                  >
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                      {#if model === savedModel}
                        <Check class="size-4 shrink-0" />
                      {:else}
                        <div class="size-4 shrink-0"></div>
                      {/if}
                      <span class="truncate">{savedModel}</span>
                    </div>
                    <button
                      type="button"
                      class="size-6 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive shrink-0"
                      onclick={(event) => handleRemoveModel(event, savedModel)}
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

  {#if !hasApiKey}
    <div class="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
      <Key class="size-4 text-destructive shrink-0" />
      <div class="flex-1 text-sm">
        <p class="font-medium text-destructive">API key required</p>
        <p class="text-muted-foreground">
          Configure your {currentProvider.name} API key in Settings
        </p>
      </div>
      {#if onNavigateToSettings}
        <Button variant="outline" size="sm" onclick={() => onNavigateToSettings?.()}>
          Settings
        </Button>
      {/if}
    </div>
  {/if}
</div>
