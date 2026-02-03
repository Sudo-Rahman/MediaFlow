<script lang="ts">
  import { DEEPGRAM_LANGUAGES, type DeepgramLanguageCode } from '$lib/types';
  import { cn } from '$lib/utils';
  import * as Select from '$lib/components/ui/select';
  import { Label } from '$lib/components/ui/label';
  import { Languages, Globe } from '@lucide/svelte';

  interface LanguageSelectorProps {
    value: string;
    onValueChange: (language: string) => void;
    disabled?: boolean;
    class?: string;
  }

  let {
    value,
    onValueChange,
    disabled = false,
    class: className = ''
  }: LanguageSelectorProps = $props();

  const selectedLanguage = $derived(DEEPGRAM_LANGUAGES.find(l => l.code === value));
</script>

<div class={cn("space-y-2", className)}>
  <Label class="text-sm font-medium">Source Language</Label>
  
  <Select.Root 
    type="single"
    value={value}
    onValueChange={(v) => v && onValueChange(v)}
    {disabled}
  >
    <Select.Trigger class="w-full">
      <div class="flex items-center gap-2">
        {#if value === 'multi'}
          <Globe class="size-4 text-primary" />
        {:else}
          <Languages class="size-4 text-muted-foreground" />
        {/if}
        <span>
          {#if selectedLanguage?.flag}
            {selectedLanguage.flag}
          {/if}
          {selectedLanguage?.name ?? value}
        </span>
      </div>
    </Select.Trigger>
    <Select.Content class="max-h-[300px]">
      {#each DEEPGRAM_LANGUAGES as lang (lang.code)}
        <Select.Item value={lang.code} label={lang.name}>
          <div class="flex items-center gap-2">
            {#if lang.code === 'multi'}
              <Globe class="size-4 text-primary" />
            {:else if lang.flag}
              <span>{lang.flag}</span>
            {/if}
            <span>{lang.name}</span>
            {#if lang.code !== 'multi'}
              <span class="text-xs text-muted-foreground ml-auto uppercase">{lang.code}</span>
            {/if}
          </div>
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>

  {#if value === 'multi'}
    <p class="text-xs text-muted-foreground">
      Deepgram will automatically detect the language
    </p>
  {/if}
</div>
