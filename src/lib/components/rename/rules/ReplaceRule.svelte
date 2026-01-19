<script lang="ts">
  import type { ReplaceConfig } from '$lib/types/rename';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';

  interface ReplaceRuleProps {
    config: ReplaceConfig;
    onUpdate: (config: ReplaceConfig) => void;
  }

  let { config, onUpdate }: ReplaceRuleProps = $props();

  function handleSearchChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, search: target.value });
  }

  function handleReplaceChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, replace: target.value });
  }

  function handleCaseChange(checked: boolean) {
    onUpdate({ ...config, caseSensitive: checked });
  }
</script>

<div class="space-y-3">
  <div class="space-y-1.5">
    <Label for="search-text">Search For</Label>
    <Input
      id="search-text"
      value={config.search}
      oninput={handleSearchChange}
      placeholder="Text to find..."
    />
  </div>
  
  <div class="space-y-1.5">
    <Label for="replace-text">Replace With</Label>
    <Input
      id="replace-text"
      value={config.replace}
      oninput={handleReplaceChange}
      placeholder="Replacement text..."
    />
  </div>

  <label class="flex items-center gap-2 cursor-pointer">
    <Checkbox
      checked={config.caseSensitive}
      onCheckedChange={handleCaseChange}
    />
    <span class="text-sm">Case sensitive</span>
  </label>
</div>
