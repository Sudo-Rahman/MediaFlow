<script lang="ts">
  import { WHISPER_LANGUAGES, type WhisperLanguage } from '$lib/types';
  import { cn } from '$lib/utils';
  import * as Select from '$lib/components/ui/select';
  import { Label } from '$lib/components/ui/label';
  import Languages from 'lucide-svelte/icons/languages';
  import Sparkles from 'lucide-svelte/icons/sparkles';

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

  const selectedLanguage = $derived(WHISPER_LANGUAGES.find((l: WhisperLanguage) => l.code === value));
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
        {#if value === 'auto'}
          <Sparkles class="size-4 text-primary" />
        {:else}
          <Languages class="size-4 text-muted-foreground" />
        {/if}
        <span>{selectedLanguage?.name ?? value}</span>
      </div>
    </Select.Trigger>
    <Select.Content class="max-h-[300px]">
      {#each WHISPER_LANGUAGES as lang (lang.code)}
        <Select.Item value={lang.code} label={lang.name}>
          <div class="flex items-center gap-2">
            {#if lang.code === 'auto'}
              <Sparkles class="size-4 text-primary" />
            {/if}
            <span>{lang.name}</span>
            {#if lang.code !== 'auto'}
              <span class="text-xs text-muted-foreground ml-auto">{lang.code}</span>
            {/if}
          </div>
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>

  {#if value === 'auto'}
    <p class="text-xs text-muted-foreground">
      Whisper will automatically detect the spoken language
    </p>
  {/if}
</div>
