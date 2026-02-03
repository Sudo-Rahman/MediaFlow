<script lang="ts">
  import { DEEPGRAM_MODELS, type DeepgramModel } from '$lib/types';
  import { cn } from '$lib/utils';
  import * as Select from '$lib/components/ui/select';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import { Cpu, Sparkles, Zap } from '@lucide/svelte';

  interface ModelSelectorProps {
    value: DeepgramModel;
    onValueChange: (model: DeepgramModel) => void;
    disabled?: boolean;
    class?: string;
  }

  let {
    value,
    onValueChange,
    disabled = false,
    class: className = ''
  }: ModelSelectorProps = $props();

  const selectedModel = $derived(DEEPGRAM_MODELS.find(m => m.id === value));

  function getTierBadge(tier: string): { variant: 'default' | 'secondary' | 'outline'; text: string } {
    switch (tier) {
      case 'latest':
        return { variant: 'default', text: 'New' };
      case 'stable':
        return { variant: 'secondary', text: 'Stable' };
      default:
        return { variant: 'outline', text: tier };
    }
  }
</script>

<div class={cn("space-y-2", className)}>
  <Label class="text-sm font-medium">Deepgram Model</Label>
  
  <Select.Root 
    type="single"
    value={value}
    onValueChange={(v) => v && onValueChange(v as DeepgramModel)}
    {disabled}
  >
    <Select.Trigger class="w-full">
      <div class="flex items-center gap-2">
        {#if selectedModel?.tier === 'latest'}
          <Sparkles class="size-4 text-primary" />
        {:else}
          <Cpu class="size-4 text-muted-foreground" />
        {/if}
        <span>{selectedModel?.name ?? value}</span>
        {#if selectedModel?.tier === 'latest'}
          <Badge variant="default" class="text-[10px] ml-auto">New</Badge>
        {/if}
      </div>
    </Select.Trigger>
    <Select.Content>
      {#each DEEPGRAM_MODELS as model (model.id)}
        {@const tierBadge = getTierBadge(model.tier)}
        <Select.Item value={model.id} label={model.name}>
          <div class="flex items-center justify-between w-full gap-4">
            <div class="flex items-center gap-2">
              {#if model.tier === 'latest'}
                <Sparkles class="size-4 text-primary" />
              {:else}
                <Zap class="size-4 text-muted-foreground" />
              {/if}
              <span>{model.name}</span>
              <Badge variant={tierBadge.variant} class="text-[10px]">{tierBadge.text}</Badge>
            </div>
          </div>
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>

  <!-- Model description -->
  {#if selectedModel}
    <p class="text-xs text-muted-foreground">
      {selectedModel.description}
    </p>
  {/if}
</div>
