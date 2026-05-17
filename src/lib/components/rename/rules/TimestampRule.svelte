<script lang="ts">
  import type { TimestampConfig, TimestampSource } from '$lib/types/rename';
  import { Button } from '$lib/components/ui/button';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as Item from '$lib/components/ui/item';
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
  const preview = $derived.by(() => {
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

  const controlId = $props.id();
  const positionSelectId = `${controlId}-timestamp-position`;
  const sourceSelectId = `${controlId}-timestamp-source`;
  const formatInputId = `${controlId}-timestamp-format`;
  const separatorInputId = `${controlId}-timestamp-separator`;
</script>

<div class="space-y-3">
  <Field.Field>
    <Field.FieldLabel for={positionSelectId}>Position</Field.FieldLabel>
    <Select.Root type="single" value={config.position} onValueChange={handlePositionChange}>
      <Select.Trigger id={positionSelectId} class="w-full">
        {positionOptions.find(o => o.value === config.position)?.label || 'Select position...'}
      </Select.Trigger>
      <Select.Content>
        <Select.Group>
          {#each positionOptions as option (option.value)}
            <Select.Item value={option.value}>{option.label}</Select.Item>
          {/each}
        </Select.Group>
      </Select.Content>
    </Select.Root>
  </Field.Field>

  <Field.Field>
    <Field.FieldLabel for={sourceSelectId}>Date Source</Field.FieldLabel>
    <Select.Root type="single" value={config.source} onValueChange={handleSourceChange}>
      <Select.Trigger id={sourceSelectId} class="w-full">
        {sourceOptions.find(o => o.value === config.source)?.label || 'Select source...'}
      </Select.Trigger>
      <Select.Content>
        <Select.Group>
          {#each sourceOptions as option (option.value)}
            <Select.Item value={option.value}>{option.label}</Select.Item>
          {/each}
        </Select.Group>
      </Select.Content>
    </Select.Root>
  </Field.Field>

  <Field.Field>
    <Field.FieldLabel for={formatInputId}>Format</Field.FieldLabel>
    <Input
      id={formatInputId}
      value={config.format}
      oninput={handleFormatChange}
      placeholder="YYYY-MM-DD"
    />
    <div class="flex flex-wrap gap-1 mt-1">
      {#each formatPresets as preset (preset.value)}
        <Button
          type="button"
          variant="secondary"
          size="xs"
          class="h-6 px-2 font-mono text-xs"
          onclick={() => applyPreset(preset.value)}
        >
          {preset.label}
        </Button>
      {/each}
    </div>
  </Field.Field>

  <Field.Field>
    <Field.FieldLabel for={separatorInputId}>Separator</Field.FieldLabel>
    <Input
      id={separatorInputId}
      value={config.separator}
      oninput={handleSeparatorChange}
      placeholder="_"
      maxlength={5}
    />
  </Field.Field>

  <Item.Root variant="muted" size="xs">
    <Item.Description class="text-xs">
      Preview: <span class="font-mono">{preview}</span>
    </Item.Description>
  </Item.Root>

  <p class="text-xs text-muted-foreground">
    Available tokens: YYYY, YY, MM, DD, HH, mm, ss
  </p>
</div>
