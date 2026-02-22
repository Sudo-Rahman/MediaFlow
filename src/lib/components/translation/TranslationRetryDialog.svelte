<script lang="ts">
  import { ArrowRight } from '@lucide/svelte';

  import { LlmProviderModelSelector } from '$lib/components/llm';
  import { RetryVersionDialogShell } from '$lib/components/shared';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { LLM_PROVIDERS, SUPPORTED_LANGUAGES } from '$lib/types';
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

  let versionName = $state('');
  let provider = $state<LLMProvider>('google');
  let model = $state('');
  let sourceLanguage = $state<LanguageCode>('auto');
  let targetLanguage = $state<LanguageCode>('fr');
  let batchCount = $state(1);
  let models = $state<TranslationModelSelection[]>([]);

  const targetLanguages = SUPPORTED_LANGUAGES.filter((lang) => lang.code !== 'auto');
  const compareModelDisplay = $derived(
    models.map((entry) => {
      const provider = LLM_PROVIDERS[entry.provider];
      const modelName = provider.models.find((modelEntry) => modelEntry.id === entry.model)?.name ?? entry.model;
      return `${provider.name} - ${modelName}`;
    })
  );
  const canConfirm = $derived(isCompareMode || !!model);

  $effect(() => {
    if (open) {
      versionName = `Version ${existingVersions.length + 1}`;
      provider = defaultProvider;
      model = defaultModel;
      sourceLanguage = defaultSourceLanguage;
      targetLanguage = defaultTargetLanguage;
      batchCount = defaultBatchCount;
      models = defaultModels.map((entry) => ({ ...entry }));
    }
  });

  function handleConfirm(): void {
    onConfirm({
      versionName: versionName.trim() || `Version ${existingVersions.length + 1}`,
      provider,
      model,
      sourceLanguage,
      targetLanguage,
      batchCount: Math.max(1, batchCount),
      models: models.map((entry) => ({ ...entry })),
    });
    onOpenChange(false);
  }
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
    <div class="space-y-2">
      <Label class="text-sm">Languages</Label>
      <div class="flex items-center gap-3">
        <div class="flex-1">
          <Select.Root
            type="single"
            value={sourceLanguage}
            onValueChange={(value) => sourceLanguage = value as LanguageCode}
          >
            <Select.Trigger class="w-full h-9">
              {SUPPORTED_LANGUAGES.find((lang) => lang.code === sourceLanguage)?.name || 'Source'}
            </Select.Trigger>
            <Select.Content>
              {#each SUPPORTED_LANGUAGES as lang (lang.code)}
                <Select.Item value={lang.code}>{lang.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <ArrowRight class="size-4 text-muted-foreground shrink-0" />

        <div class="flex-1">
          <Select.Root
            type="single"
            value={targetLanguage}
            onValueChange={(value) => targetLanguage = value as LanguageCode}
          >
            <Select.Trigger class="w-full h-9">
              {targetLanguages.find((lang) => lang.code === targetLanguage)?.name || 'Target'}
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

    {#if isCompareMode}
      <div class="space-y-2">
        <Label class="text-sm">Compare models</Label>
        <p class="text-xs text-muted-foreground">
          Using active Compare Models selection from the tool.
        </p>
        <div class="rounded-md border p-2 space-y-1">
          {#each compareModelDisplay as modelEntry}
            <p class="text-xs">{modelEntry}</p>
          {/each}
        </div>
      </div>
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

    <div class="space-y-2">
      <Label for="retry-batch-count" class="text-sm">Number of batches</Label>
      <Input
        id="retry-batch-count"
        type="number"
        min="1"
        max="20"
        bind:value={batchCount}
        class="h-9"
      />
      <p class="text-xs text-muted-foreground">
        Split file into N parts to avoid token limits.
      </p>
    </div>
  {/snippet}
</RetryVersionDialogShell>
