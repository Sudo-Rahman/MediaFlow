<script lang="ts">
  import type { RemoveConfig } from '$lib/types/rename';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';

  interface RemoveRuleProps {
    config: RemoveConfig;
    onUpdate: (config: RemoveConfig) => void;
  }

  let { config, onUpdate }: RemoveRuleProps = $props();

  const modeOptions = [
    { value: 'first', label: 'First N characters' },
    { value: 'last', label: 'Last N characters' },
    { value: 'range', label: 'Character range' },
    { value: 'pattern', label: 'Pattern (regex)' },
  ];

  function handleModeChange(value: string | undefined) {
    if (value) {
      onUpdate({ ...config, mode: value as RemoveConfig['mode'] });
    }
  }

  function handleCountChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, count: parseInt(target.value) || 0 });
  }

  function handleFromChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, from: parseInt(target.value) || 0 });
  }

  function handleToChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, to: parseInt(target.value) || 0 });
  }

  function handlePatternChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, pattern: target.value });
  }
</script>

<div class="space-y-3">
  <div class="space-y-1.5">
    <Label>Remove Mode</Label>
    <Select.Root type="single" value={config.mode} onValueChange={handleModeChange}>
      <Select.Trigger class="w-full">
        {modeOptions.find(o => o.value === config.mode)?.label || 'Select mode...'}
      </Select.Trigger>
      <Select.Content>
        {#each modeOptions as option}
          <Select.Item value={option.value}>{option.label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  {#if config.mode === 'first' || config.mode === 'last'}
    <div class="space-y-1.5">
      <Label for="remove-count">Number of characters</Label>
      <Input
        id="remove-count"
        type="number"
        min="0"
        value={config.count}
        oninput={handleCountChange}
      />
    </div>
  {/if}

  {#if config.mode === 'range'}
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <Label for="remove-from">From position</Label>
        <Input
          id="remove-from"
          type="number"
          min="0"
          value={config.from}
          oninput={handleFromChange}
        />
      </div>
      <div class="space-y-1.5">
        <Label for="remove-to">To position</Label>
        <Input
          id="remove-to"
          type="number"
          min="0"
          value={config.to}
          oninput={handleToChange}
        />
      </div>
    </div>
    <p class="text-xs text-muted-foreground">
      Position is 0-indexed (first character is 0).
    </p>
  {/if}

  {#if config.mode === 'pattern'}
    <div class="space-y-1.5">
      <Label for="remove-pattern">Pattern (regex)</Label>
      <Input
        id="remove-pattern"
        value={config.pattern}
        oninput={handlePatternChange}
        placeholder="e.g., \s+|_+"
      />
    </div>
    <p class="text-xs text-muted-foreground">
      All matches will be removed from the filename.
    </p>
  {/if}
</div>
