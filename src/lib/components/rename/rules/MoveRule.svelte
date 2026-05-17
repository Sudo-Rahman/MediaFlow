<script lang="ts">
  import type { MoveConfig } from '$lib/types/rename';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as Item from '$lib/components/ui/item';

  interface MoveRuleProps {
    config: MoveConfig;
    onUpdate: (config: MoveConfig) => void;
  }

  let { config, onUpdate }: MoveRuleProps = $props();

  function handleFromChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, from: parseInt(target.value) || 0 });
  }

  function handleLengthChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, length: parseInt(target.value) || 1 });
  }

  function handleToChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, to: parseInt(target.value) || 0 });
  }

  // Visual example
  const example = $derived.by(() => {
    const original = "example_file";
    const from = Math.max(0, Math.min(config.from, original.length));
    const length = Math.max(0, config.length);
    const to = Math.max(0, Math.min(config.to, original.length));
    
    if (from + length > original.length) return { original, result: original };
    
    const segment = original.substring(from, from + length);
    const withoutSegment = original.substring(0, from) + original.substring(from + length);
    const adjustedTo = to > from ? to - length : to;
    const result = withoutSegment.substring(0, adjustedTo) + segment + withoutSegment.substring(adjustedTo);
    
    return { original, result, segment };
  });

  const controlId = $props.id();
  const fromInputId = `${controlId}-move-from`;
  const lengthInputId = `${controlId}-move-length`;
  const toInputId = `${controlId}-move-to`;
</script>

<div class="space-y-3">
  <div class="grid grid-cols-3 gap-3">
    <Field.Field>
      <Field.FieldLabel for={fromInputId}>From position</Field.FieldLabel>
      <Input
        id={fromInputId}
        type="number"
        min="0"
        value={config.from}
        oninput={handleFromChange}
      />
    </Field.Field>
    <Field.Field>
      <Field.FieldLabel for={lengthInputId}>Length</Field.FieldLabel>
      <Input
        id={lengthInputId}
        type="number"
        min="1"
        value={config.length}
        oninput={handleLengthChange}
      />
    </Field.Field>
    <Field.Field>
      <Field.FieldLabel for={toInputId}>To position</Field.FieldLabel>
      <Input
        id={toInputId}
        type="number"
        min="0"
        value={config.to}
        oninput={handleToChange}
      />
    </Field.Field>
  </div>

  <p class="text-xs text-muted-foreground">
    Position is 0-indexed. Move {config.length} character(s) from position {config.from} to position {config.to}.
  </p>

  <Item.Root variant="muted" size="xs" class="items-start">
    <Item.Content>
      <Item.Description class="text-xs">
      Original: <span class="font-mono">{example.original}</span>
      </Item.Description>
      <Item.Description class="text-xs">
      Result: <span class="font-mono">{example.result}</span>
      </Item.Description>
    </Item.Content>
  </Item.Root>
</div>
