<script lang="ts">
  import type { SuffixConfig } from '$lib/types/rename';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  interface SuffixRuleProps {
    config: SuffixConfig;
    onUpdate: (config: SuffixConfig) => void;
  }

  let { config, onUpdate }: SuffixRuleProps = $props();

  function handleChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, text: target.value });
  }
</script>

<div class="space-y-3">
  <div class="space-y-1.5">
    <Label for="suffix-text">Suffix Text</Label>
    <Input
      id="suffix-text"
      value={config.text}
      oninput={handleChange}
      placeholder="Enter suffix..."
    />
  </div>
  <p class="text-xs text-muted-foreground">
    This text will be added before the file extension.
  </p>
</div>
