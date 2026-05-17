<script lang="ts">
  import { AlertTriangle, AudioLines, Check, Languages, ListOrdered, FileStack } from '@lucide/svelte';
  import type { BatchTrackStrategy } from '$lib/types';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Field from '$lib/components/ui/field';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Item from '$lib/components/ui/item';
  import * as Select from '$lib/components/ui/select';
  import { getAudioTrackLanguageLabel } from '$lib/utils/audio-language';
  import { cn } from '$lib/utils';

  interface BatchTrackSelectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    fileCount: number;
    availableLanguages: string[];
    onSelect: (strategy: BatchTrackStrategy) => void;
    onCancel: () => void;
  }

  let { 
    open = $bindable(false), 
    onOpenChange,
    fileCount,
    availableLanguages,
    onSelect,
    onCancel
  }: BatchTrackSelectDialogProps = $props();

  type StrategyType = 'default' | 'language' | 'first' | 'index' | 'individual';

  let selectedStrategy = $state<StrategyType>('default');
  let selectedLanguage = $state<string>('');
  let trackIndex = $state<number>(0);
  const trackIndexInputId = `batch-track-index-${Math.random().toString(36).slice(2)}`;
  const languageSelectId = `batch-track-language-${Math.random().toString(36).slice(2)}`;

  // Reset when dialog opens
  $effect(() => {
    if (open) {
      selectedStrategy = 'default';
      selectedLanguage = availableLanguages[0] ?? '';
      trackIndex = 0;
    }
  });

  const strategies: { type: StrategyType; label: string; description: string; icon: typeof AudioLines }[] = [
    { 
      type: 'default', 
      label: 'Use default track', 
      description: 'Uses the track marked as default, or the first track',
      icon: AudioLines
    },
    { 
      type: 'language', 
      label: 'Filter by language', 
      description: 'Select tracks matching a specific language',
      icon: Languages
    },
    { 
      type: 'first', 
      label: 'First track', 
      description: 'Always use the first audio track (index 0)',
      icon: ListOrdered
    },
    { 
      type: 'index', 
      label: 'Track by index', 
      description: 'Use a specific track number for all files',
      icon: ListOrdered
    },
    { 
      type: 'individual', 
      label: 'Select for each file', 
      description: 'Choose the track manually for each file',
      icon: FileStack
    }
  ];

  function handleConfirm() {
    let strategy: BatchTrackStrategy;
    
    switch (selectedStrategy) {
      case 'default':
        strategy = { type: 'default' };
        break;
      case 'language':
        strategy = { type: 'language', language: selectedLanguage };
        break;
      case 'first':
        strategy = { type: 'first' };
        break;
      case 'index':
        strategy = { type: 'index', index: trackIndex };
        break;
      case 'individual':
        strategy = { type: 'individual' };
        break;
    }
    
    onSelect(strategy);
    onOpenChange(false);
  }

  function handleCancel() {
    onCancel();
    onOpenChange(false);
  }

  // Validation
  const isValid = $derived.by(() => {
    if (selectedStrategy === 'language' && !selectedLanguage) return false;
    if (selectedStrategy === 'index' && (trackIndex < 0 || isNaN(trackIndex))) return false;
    return true;
  });
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content class="max-w-lg max-h-[80vh] flex flex-col">
    <Dialog.Header class="shrink-0">
      <Dialog.Title class="flex items-center gap-2">
        <AudioLines class="size-5" />
        Batch Track Selection
      </Dialog.Title>
      <Dialog.Description>
        {fileCount} files have multiple audio tracks. Choose how to select which track to use.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-scroll-body flex flex-col gap-3 py-4">
      {#each strategies as strategy (strategy.type)}
        {@const isSelected = selectedStrategy === strategy.type}
        {@const Icon = strategy.icon}
        <Item.Root
          variant={isSelected ? 'outline' : 'default'}
          size="sm"
          class={cn(
            "items-start hover:bg-muted/50",
            isSelected && "border-primary bg-card ring-1 ring-primary/20 hover:bg-card"
          )}
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-start gap-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-pressed={isSelected}
            onclick={() => selectedStrategy = strategy.type}
          >
            <!-- Selection indicator -->
            <Item.Media class="mt-0.5">
              <div class={cn(
                "size-5 rounded-full border-2 flex items-center justify-center",
                isSelected ? "border-primary bg-primary" : "border-muted-foreground"
              )}>
                {#if isSelected}
                  <Check class="size-3 text-primary-foreground" />
                {/if}
              </div>
            </Item.Media>

            <Item.Content class="min-w-0">
              <Item.Title>
                <Icon class="size-4 text-muted-foreground" />
                {strategy.label}
              </Item.Title>
              <Item.Description class="text-xs">
                {strategy.description}
              </Item.Description>
            </Item.Content>
          </button>

          <!-- Additional inputs for certain strategies -->
          {#if isSelected && strategy.type === 'language' && availableLanguages.length > 0}
            <Field.Field class="basis-full pl-8">
              <Field.FieldLabel for={languageSelectId}>Language</Field.FieldLabel>
              <Select.Root type="single" bind:value={selectedLanguage}>
                <Select.Trigger id={languageSelectId} class="w-full">
                  {selectedLanguage ? (getAudioTrackLanguageLabel(selectedLanguage) ?? selectedLanguage.toUpperCase()) : 'Select language'}
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {#each availableLanguages as lang (lang)}
                      <Select.Item value={lang}>{getAudioTrackLanguageLabel(lang) ?? lang.toUpperCase()}</Select.Item>
                    {/each}
                  </Select.Group>
                </Select.Content>
              </Select.Root>
            </Field.Field>
          {:else if isSelected && strategy.type === 'language' && availableLanguages.length === 0}
            <Item.Root variant="outline" size="xs" class="basis-full border-amber-500/40 text-amber-700 dark:text-amber-300">
              <Item.Media>
                <AlertTriangle class="size-4" />
              </Item.Media>
              <Item.Content>
                <Item.Title>No language tags detected</Item.Title>
                <Item.Description>These files do not include language tags.</Item.Description>
              </Item.Content>
            </Item.Root>
          {/if}

          {#if isSelected && strategy.type === 'index'}
            <Field.Field orientation="horizontal" class="basis-full items-center gap-2 pl-8">
              <Field.FieldLabel for={trackIndexInputId} class="whitespace-nowrap text-xs">Track number:</Field.FieldLabel>
              <Input
                id={trackIndexInputId}
                type="number"
                min="1"
                class="h-8 w-20"
                value={trackIndex + 1}
                onchange={(e) => {
                  const val = parseInt((e.target as HTMLInputElement).value) - 1;
                  trackIndex = Math.max(0, isNaN(val) ? 0 : val);
                }}
              />
              <Field.FieldDescription class="text-xs">(1-based)</Field.FieldDescription>
            </Field.Field>
          {/if}
        </Item.Root>
      {/each}
    </div>

    <Dialog.Footer class="shrink-0">
      <Button variant="outline" onclick={handleCancel}>
        Cancel
      </Button>
      <Button onclick={handleConfirm} disabled={!isValid}>
        Apply to All
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
