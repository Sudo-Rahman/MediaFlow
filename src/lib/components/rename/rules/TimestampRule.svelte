<script lang="ts">
  import type { TimestampConfig, TimestampSource } from '$lib/types/rename';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';

  interface TimestampRuleProps {
    config: TimestampConfig;
    onUpdate: (config: TimestampConfig) => void;
  }

  let { config, onUpdate }: TimestampRuleProps = $props();

  const positionOptions = [
    { value: 'prefix', label: 'At the beginning' },
    { value: 'suffix', label: 'At the end' },
  ];

  const sourceOptions = [
    { value: 'current', label: 'Current date/time' },
    { value: 'modified', label: 'File modified date' },
    { value: 'created', label: 'File created date' },
  ];

  const formatPresets = [
    { value: 'YYYY-MM-DD', label: '2024-01-15' },
    { value: 'YYYYMMDD', label: '20240115' },
    { value: 'DD-MM-YYYY', label: '15-01-2024' },
    { value: 'YYYY-MM-DD_HH-mm-ss', label: '2024-01-15_14-30-00' },
    { value: 'YYMMDDHHmmss', label: '240115143000' },
  ];

  // Preview timestamp
  const preview = $derived(() => {
    const now = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    
    return config.format
      .replace('YYYY', String(now.getFullYear()))
      .replace('YY', String(now.getFullYear()).slice(-2))
      .replace('MM', pad(now.getMonth() + 1))
      .replace('DD', pad(now.getDate()))
      .replace('HH', pad(now.getHours()))
      .replace('mm', pad(now.getMinutes()))
      .replace('ss', pad(now.getSeconds()));
  });

  function handlePositionChange(value: string | undefined) {
    if (value) {
      onUpdate({ ...config, position: value as TimestampConfig['position'] });
    }
  }

  function handleSourceChange(value: string | undefined) {
    if (value) {
      onUpdate({ ...config, source: value as TimestampSource });
    }
  }

  function handleFormatChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, format: target.value });
  }

  function handleSeparatorChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, separator: target.value });
  }

  function applyPreset(format: string) {
    onUpdate({ ...config, format });
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

  <div class="space-y-1.5">
    <Label>Date Source</Label>
    <Select.Root type="single" value={config.source} onValueChange={handleSourceChange}>
      <Select.Trigger class="w-full">
        {sourceOptions.find(o => o.value === config.source)?.label || 'Select source...'}
      </Select.Trigger>
      <Select.Content>
        {#each sourceOptions as option}
          <Select.Item value={option.value}>{option.label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="space-y-1.5">
    <Label for="timestamp-format">Format</Label>
    <Input
      id="timestamp-format"
      value={config.format}
      oninput={handleFormatChange}
      placeholder="YYYY-MM-DD"
    />
    <div class="flex flex-wrap gap-1 mt-1">
      {#each formatPresets as preset}
        <button
          type="button"
          class="text-xs px-2 py-0.5 rounded bg-muted hover:bg-accent transition-colors"
          onclick={() => applyPreset(preset.value)}
        >
          {preset.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="space-y-1.5">
    <Label for="timestamp-separator">Separator</Label>
    <Input
      id="timestamp-separator"
      value={config.separator}
      oninput={handleSeparatorChange}
      placeholder="_"
      maxlength={5}
    />
  </div>

  <div class="p-2 rounded-md bg-muted">
    <p class="text-xs text-muted-foreground">
      Preview: <span class="font-mono">{preview()}</span>
    </p>
  </div>

  <p class="text-xs text-muted-foreground">
    Available tokens: YYYY, YY, MM, DD, HH, mm, ss
  </p>
</div>
