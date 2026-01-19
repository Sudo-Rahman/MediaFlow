<script lang="ts">
  import type { TextConfig } from '$lib/types/rename';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  interface TextRuleProps {
    config: TextConfig;
    onUpdate: (config: TextConfig) => void;
  }

  let { config, onUpdate }: TextRuleProps = $props();

  function handleChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, text: target.value });
  }
</script>

<div class="space-y-3">
  <div class="space-y-1.5">
    <Label for="text-content">Filename Text</Label>
    <Input
      id="text-content"
      value={config.text}
      oninput={handleChange}
      placeholder="Enter filename..."
    />
  </div>
  <p class="text-xs text-muted-foreground">
    All files will be renamed to this text. Combine with Numbering to add unique identifiers.
  </p>
</div>
