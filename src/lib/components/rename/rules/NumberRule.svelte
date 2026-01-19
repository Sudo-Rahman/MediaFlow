<script lang="ts">
  import type { NumberConfig } from '$lib/types/rename';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';

  interface NumberRuleProps {
    config: NumberConfig;
    onUpdate: (config: NumberConfig) => void;
  }

  let { config, onUpdate }: NumberRuleProps = $props();

  const positionOptions = [
    { value: 'prefix', label: 'At the beginning' },
    { value: 'suffix', label: 'At the end' },
    { value: 'replace', label: 'Replace entire name' },
  ];

  // Preview of numbering
  const preview = $derived(() => {
    const num1 = String(config.start).padStart(config.padding, '0');
    const num2 = String(config.start + config.step).padStart(config.padding, '0');
    const num3 = String(config.start + config.step * 2).padStart(config.padding, '0');
    return `${num1}, ${num2}, ${num3}...`;
  });

  function handlePositionChange(value: string | undefined) {
    if (value) {
      onUpdate({ ...config, position: value as NumberConfig['position'] });
    }
  }

  function handleStartChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, start: parseInt(target.value) || 0 });
  }

  function handleStepChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, step: parseInt(target.value) || 1 });
  }

  function handlePaddingChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, padding: parseInt(target.value) || 1 });
  }

  function handleSeparatorChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, separator: target.value });
  }
</script>

<div class="space-y-3">
  <div class="space-y-1.5">
    <Label>Position</Label>
    <Select.Root type="single" value={config.position} onValueChange={handlePositionChange}>
      <Select.Trigger class="w-full">
        {positionOptions.find(o => o.value === config.position)?.label || 'Select position...'}
      </Select.Trigger>
      <Select.Content>
        {#each positionOptions as option}
          <Select.Item value={option.value}>{option.label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="grid grid-cols-3 gap-3">
    <div class="space-y-1.5">
      <Label for="number-start">Start</Label>
      <Input
        id="number-start"
        type="number"
        min="0"
        value={config.start}
        oninput={handleStartChange}
      />
    </div>
    <div class="space-y-1.5">
      <Label for="number-step">Step</Label>
      <Input
        id="number-step"
        type="number"
        min="1"
        value={config.step}
        oninput={handleStepChange}
      />
    </div>
    <div class="space-y-1.5">
      <Label for="number-padding">Padding</Label>
      <Input
        id="number-padding"
        type="number"
        min="1"
        max="10"
        value={config.padding}
        oninput={handlePaddingChange}
      />
    </div>
  </div>

  {#if config.position !== 'replace'}
    <div class="space-y-1.5">
      <Label for="number-separator">Separator</Label>
      <Input
        id="number-separator"
        value={config.separator}
        oninput={handleSeparatorChange}
        placeholder="_"
        maxlength={5}
      />
    </div>
  {/if}

  <div class="p-2 rounded-md bg-muted">
    <p class="text-xs text-muted-foreground">Preview: <span class="font-mono">{preview()}</span></p>
  </div>
</div>
