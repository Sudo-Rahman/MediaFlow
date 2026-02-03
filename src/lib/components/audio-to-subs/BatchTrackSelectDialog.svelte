<script lang="ts">
  import { AudioLines, Check, Languages, ListOrdered, FileStack } from '@lucide/svelte';
  import type { BatchTrackStrategy } from '$lib/types';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { cn } from '$lib/utils';
  ;
  ;
  ;
  ;
  ;

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
  const isValid = $derived(() => {
    if (selectedStrategy === 'language' && !selectedLanguage) return false;
    if (selectedStrategy === 'index' && (trackIndex < 0 || isNaN(trackIndex))) return false;
    return true;
  });
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content class="max-w-lg max-h-[80vh] overflow-y-scroll">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <AudioLines class="size-5" />
        Batch Track Selection
      </Dialog.Title>
      <Dialog.Description>
        {fileCount} files have multiple audio tracks. Choose how to select which track to use.
      </Dialog.Description>
    </Dialog.Header>

    <div class="py-4 space-y-3">
      {#each strategies as strategy (strategy.type)}
        {@const isSelected = selectedStrategy === strategy.type}
        {@const Icon = strategy.icon}
        <button
          class={cn(
            "w-full text-left p-3 rounded-lg border transition-colors",
            isSelected 
              ? "border-primary bg-primary/5" 
              : "border-border hover:bg-muted/50"
          )}
          onclick={() => selectedStrategy = strategy.type}
        >
          <div class="flex items-start gap-3">
            <!-- Selection indicator -->
            <div class={cn(
              "size-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
              isSelected ? "border-primary bg-primary" : "border-muted-foreground"
            )}>
              {#if isSelected}
                <Check class="size-3 text-primary-foreground" />
              {/if}
            </div>
            
            <!-- Strategy info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <Icon class="size-4 text-muted-foreground" />
                <span class="font-medium text-sm">{strategy.label}</span>
              </div>
              <p class="text-xs text-muted-foreground mt-0.5">
                {strategy.description}
              </p>
              
              <!-- Additional inputs for certain strategies -->
              {#if isSelected && strategy.type === 'language' && availableLanguages.length > 0}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div class="mt-3" onclick={(e) => e.stopPropagation()}>
                  <Select.Root type="single" bind:value={selectedLanguage}>
                    <Select.Trigger class="w-full">
                      {selectedLanguage ? selectedLanguage.toUpperCase() : 'Select language'}
                    </Select.Trigger>
                    <Select.Content>
                      {#each availableLanguages as lang}
                        <Select.Item value={lang}>{lang.toUpperCase()}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
              {:else if isSelected && strategy.type === 'language' && availableLanguages.length === 0}
                <p class="mt-2 text-xs text-amber-500">
                  No language tags detected in these files.
                </p>
              {/if}
              
              {#if isSelected && strategy.type === 'index'}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div class="mt-3 flex items-center gap-2" onclick={(e) => e.stopPropagation()}>
                  <Label for="track-index" class="text-xs whitespace-nowrap">Track number:</Label>
                  <Input 
                    id="track-index"
                    type="number" 
                    min="1"
                    class="w-20 h-8"
                    value={trackIndex + 1}
                    onchange={(e) => {
                      const val = parseInt((e.target as HTMLInputElement).value) - 1;
                      trackIndex = Math.max(0, isNaN(val) ? 0 : val);
                    }}
                  />
                  <span class="text-xs text-muted-foreground">(1-based)</span>
                </div>
              {/if}
            </div>
          </div>
        </button>
      {/each}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={handleCancel}>
        Cancel
      </Button>
      <Button onclick={handleConfirm} disabled={!isValid()}>
        Apply to All
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
