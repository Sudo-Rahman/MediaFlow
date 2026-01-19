<script lang="ts">
  import type { MoveConfig } from '$lib/types/rename';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

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
  const example = $derived(() => {
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
</script>

<div class="space-y-3">
  <div class="grid grid-cols-3 gap-3">
    <div class="space-y-1.5">
      <Label for="move-from">From position</Label>
      <Input
        id="move-from"
        type="number"
        min="0"
        value={config.from}
        oninput={handleFromChange}
      />
    </div>
    <div class="space-y-1.5">
      <Label for="move-length">Length</Label>
      <Input
        id="move-length"
        type="number"
        min="1"
        value={config.length}
        oninput={handleLengthChange}
      />
    </div>
    <div class="space-y-1.5">
      <Label for="move-to">To position</Label>
      <Input
        id="move-to"
        type="number"
        min="0"
        value={config.to}
        oninput={handleToChange}
      />
    </div>
  </div>

  <p class="text-xs text-muted-foreground">
    Position is 0-indexed. Move {config.length} character(s) from position {config.from} to position {config.to}.
  </p>

  <div class="p-2 rounded-md bg-muted space-y-1">
    <p class="text-xs text-muted-foreground">
      Original: <span class="font-mono">{example().original}</span>
    </p>
    <p class="text-xs text-muted-foreground">
      Result: <span class="font-mono">{example().result}</span>
    </p>
  </div>
</div>
