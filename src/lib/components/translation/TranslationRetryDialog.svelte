<script lang="ts">
  import { ArrowRight, RotateCw } from '@lucide/svelte';

  import { LlmProviderModelSelector } from '$lib/components/llm';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { SUPPORTED_LANGUAGES } from '$lib/types';
  import type { LLMProvider, LanguageCode, TranslationVersion } from '$lib/types';

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
    onConfirm: (opts: {
      versionName: string;
      provider: LLMProvider;
      model: string;
      sourceLanguage: LanguageCode;
      targetLanguage: LanguageCode;
      batchCount: number;
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
    onConfirm,
    onNavigateToSettings,
  }: TranslationRetryDialogProps = $props();

  let versionName = $state('');
  let provider = $state<LLMProvider>('google');
  let model = $state('');
  let sourceLanguage = $state<LanguageCode>('auto');
  let targetLanguage = $state<LanguageCode>('fr');
  let batchCount = $state(1);

  const targetLanguages = SUPPORTED_LANGUAGES.filter((lang) => lang.code !== 'auto');

  // Reset local state when dialog opens
  $effect(() => {
    if (open) {
      versionName = `Version ${existingVersions.length + 1}`;
      provider = defaultProvider;
      model = defaultModel;
      sourceLanguage = defaultSourceLanguage;
      targetLanguage = defaultTargetLanguage;
      batchCount = defaultBatchCount;
    }
  });

  function handleConfirm(): void {
    onConfirm({
      versionName,
      provider,
      model,
      sourceLanguage,
      targetLanguage,
      batchCount,
    });
    onOpenChange(false);
  }
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Translate Again</Dialog.Title>
      <Dialog.Description>
        Create a new translation version for <span class="font-medium">{fileName}</span>
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 py-4">
      <!-- Version name -->
      <div class="space-y-2">
        <Label for="version-name" class="text-sm">Version Name</Label>
        <Input
          id="version-name"
          bind:value={versionName}
          placeholder="Version name"
          class="h-9"
        />
      </div>

      <!-- Language selection -->
      <div class="space-y-2">
        <Label class="text-sm">Languages</Label>
        <div class="flex items-center gap-3">
          <div class="flex-1">
            <Select.Root
              type="single"
              value={sourceLanguage}
              onValueChange={(v) => { sourceLanguage = v as LanguageCode; }}
            >
              <Select.Trigger class="w-full h-9">
                {SUPPORTED_LANGUAGES.find((l) => l.code === sourceLanguage)?.name || 'Source'}
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
              onValueChange={(v) => { targetLanguage = v as LanguageCode; }}
            >
              <Select.Trigger class="w-full h-9">
                {targetLanguages.find((l) => l.code === targetLanguage)?.name || 'Target'}
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

      <!-- Provider/model -->
      <LlmProviderModelSelector
        {provider}
        {model}
        onProviderChange={(p) => { provider = p; model = ''; }}
        onModelChange={(m) => { model = m; }}
        {onNavigateToSettings}
      />

      <!-- Batch count -->
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
          Split file into N parts to avoid token limits
        </p>
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => onOpenChange(false)}>Cancel</Button>
      <Button onclick={handleConfirm} disabled={!model}>
        <RotateCw class="size-4 mr-2" />
        Translate
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
