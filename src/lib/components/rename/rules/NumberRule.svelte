<script lang="ts">
  import type { NumberConfig } from '$lib/types/rename';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as Item from '$lib/components/ui/item';
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
  const preview = $derived.by(() => {
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

  const controlId = $props.id();
  const positionSelectId = `${controlId}-number-position`;
  const startInputId = `${controlId}-number-start`;
  const stepInputId = `${controlId}-number-step`;
  const paddingInputId = `${controlId}-number-padding`;
  const separatorInputId = `${controlId}-number-separator`;
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

  <div class="grid grid-cols-3 gap-3">
    <Field.Field>
      <Field.FieldLabel for={startInputId}>Start</Field.FieldLabel>
      <Input
        id={startInputId}
        type="number"
        min="0"
        value={config.start}
        oninput={handleStartChange}
      />
    </Field.Field>
    <Field.Field>
      <Field.FieldLabel for={stepInputId}>Step</Field.FieldLabel>
      <Input
        id={stepInputId}
        type="number"
        min="1"
        value={config.step}
        oninput={handleStepChange}
      />
    </Field.Field>
    <Field.Field>
      <Field.FieldLabel for={paddingInputId}>Padding</Field.FieldLabel>
      <Input
        id={paddingInputId}
        type="number"
        min="1"
        max="10"
        value={config.padding}
        oninput={handlePaddingChange}
      />
    </Field.Field>
  </div>

  {#if config.position !== 'replace'}
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
  {/if}

  <Item.Root variant="muted" size="xs">
    <Item.Description class="text-xs">Preview: <span class="font-mono">{preview}</span></Item.Description>
  </Item.Root>
</div>
