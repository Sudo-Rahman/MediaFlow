<script lang="ts">
  import { WHISPER_MODELS, type WhisperModel, type WhisperModelInfo } from '$lib/types';
  import { cn } from '$lib/utils';
  import * as Select from '$lib/components/ui/select';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import Cpu from 'lucide-svelte/icons/cpu';
  import Gauge from 'lucide-svelte/icons/gauge';
  import HardDrive from 'lucide-svelte/icons/hard-drive';

  interface ModelSelectorProps {
    value: WhisperModel;
    downloadedModels: Set<WhisperModel>;
    onValueChange: (model: WhisperModel) => void;
    disabled?: boolean;
    class?: string;
  }

  let {
    value,
    downloadedModels,
    onValueChange,
    disabled = false,
    class: className = ''
  }: ModelSelectorProps = $props();

  function getAccuracyColor(accuracy: string): string {
    switch (accuracy) {
      case 'Excellent': return 'text-green-500';
      case 'Très bon': return 'text-emerald-500';
      case 'Bon': return 'text-yellow-500';
      case 'Correct': return 'text-orange-500';
      case 'Faible': return 'text-red-500';
      default: return 'text-muted-foreground';
    }
  }

  function getSpeedColor(speed: string): string {
    switch (speed) {
      case 'Très rapide': return 'text-green-500';
      case 'Rapide': return 'text-emerald-500';
      case 'Moyen': return 'text-yellow-500';
      case 'Lent': return 'text-orange-500';
      default: return 'text-muted-foreground';
    }
  }

  const selectedModel = $derived(WHISPER_MODELS.find((m: WhisperModelInfo) => m.id === value));
</script>

<div class={cn("space-y-2", className)}>
  <Label class="text-sm font-medium">Model</Label>
  
  <Select.Root 
    type="single"
    value={value}
    onValueChange={(v) => v && onValueChange(v as WhisperModel)}
    {disabled}
  >
    <Select.Trigger class="w-full">
      <div class="flex items-center gap-2">
        <Cpu class="size-4 text-muted-foreground" />
        <span>{selectedModel?.name ?? value}</span>
        {#if !downloadedModels.has(value)}
          <Badge variant="outline" class="text-[10px] ml-auto">Not downloaded</Badge>
        {/if}
      </div>
    </Select.Trigger>
    <Select.Content>
      {#each WHISPER_MODELS as model (model.id)}
        {@const isDownloaded = downloadedModels.has(model.id)}
        <Select.Item value={model.id} label={model.name}>
          <div class="flex items-center justify-between w-full gap-4">
            <div class="flex items-center gap-2">
              <span>{model.name}</span>
              {#if model.englishOnly}
                <Badge variant="secondary" class="text-[10px]">EN only</Badge>
              {/if}
              {#if !isDownloaded}
                <Badge variant="outline" class="text-[10px]">Download</Badge>
              {/if}
            </div>
            <div class="flex items-center gap-3 text-xs">
              <span class="text-muted-foreground">{model.size}</span>
              <span class={getSpeedColor(model.speed)}>{model.speed}</span>
            </div>
          </div>
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>

  <!-- Model details -->
  {#if selectedModel}
    <div class="flex items-center gap-4 text-xs text-muted-foreground pt-1">
      <div class="flex items-center gap-1">
        <HardDrive class="size-3" />
        <span>{selectedModel.size}</span>
      </div>
      <div class="flex items-center gap-1">
        <Gauge class="size-3" />
        <span class={getSpeedColor(selectedModel.speed)}>{selectedModel.speed}</span>
      </div>
      <div class="flex items-center gap-1">
        <span class={getAccuracyColor(selectedModel.accuracy)}>{selectedModel.accuracy}</span>
      </div>
    </div>
  {/if}
</div>
