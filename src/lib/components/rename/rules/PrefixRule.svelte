<script lang="ts">
  import type { PrefixConfig } from '$lib/types/rename';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  interface PrefixRuleProps {
    config: PrefixConfig;
    onUpdate: (config: PrefixConfig) => void;
  }

  let { config, onUpdate }: PrefixRuleProps = $props();

  function handleChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, text: target.value });
  }
</script>

<div class="space-y-3">
  <div class="space-y-1.5">
    <Label for="prefix-text">Prefix Text</Label>
    <Input
      id="prefix-text"
      value={config.text}
      oninput={handleChange}
      placeholder="Enter prefix..."
    />
  </div>
  <p class="text-xs text-muted-foreground">
    This text will be added at the beginning of each filename.
  </p>
</div>
