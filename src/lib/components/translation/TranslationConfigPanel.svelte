<script lang="ts">
  import { ArrowRight, Languages } from '@lucide/svelte';

  import { LlmProviderModelSelector } from '$lib/components/llm';
  import * as Card from '$lib/components/ui/card';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { translationStore } from '$lib/stores';
  import { SUPPORTED_LANGUAGES } from '$lib/types';
  import type { LanguageCode } from '$lib/types';

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
  </Card.Content>
</Card.Root>
