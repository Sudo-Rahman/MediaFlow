<script lang="ts">
  import type { RegexConfig } from '$lib/types/rename';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';

  interface RegexRuleProps {
    config: RegexConfig;
    onUpdate: (config: RegexConfig) => void;
  }

  let { config, onUpdate }: RegexRuleProps = $props();

  let isValidRegex = $state(true);

  function handlePatternChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const pattern = target.value;
    
    // Validate regex
    try {
      if (pattern) {
        new RegExp(pattern, config.flags);
      }
      isValidRegex = true;
    } catch {
      isValidRegex = false;
    }
    
    onUpdate({ ...config, pattern });
  }

  function handleReplacementChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({ ...config, replacement: target.value });
  }

  function toggleFlag(flag: string, enabled: boolean) {
    let flags = config.flags;
    if (enabled && !flags.includes(flag)) {
      flags += flag;
    } else if (!enabled) {
      flags = flags.replace(flag, '');
    }
    onUpdate({ ...config, flags });
  }
</script>

<div class="space-y-3">
  <div class="space-y-1.5">
    <Label for="regex-pattern">Pattern (Regular Expression)</Label>
    <Input
      id="regex-pattern"
      value={config.pattern}
      oninput={handlePatternChange}
      placeholder="e.g., \d+|[A-Z]+"
      class={!isValidRegex ? 'border-destructive' : ''}
    />
    {#if !isValidRegex}
      <p class="text-xs text-destructive">Invalid regular expression</p>
    {/if}
  </div>
  
  <div class="space-y-1.5">
    <Label for="regex-replacement">Replacement</Label>
    <Input
      id="regex-replacement"
      value={config.replacement}
      oninput={handleReplacementChange}
      placeholder="Use $1, $2 for capture groups"
    />
  </div>

  <div class="space-y-2">
    <Label>Flags</Label>
    <div class="flex gap-4">
      <label class="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={config.flags.includes('g')}
          onCheckedChange={(v) => toggleFlag('g', v === true)}
        />
        <span class="text-sm">Global (g)</span>
      </label>
      <label class="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={config.flags.includes('i')}
          onCheckedChange={(v) => toggleFlag('i', v === true)}
        />
        <span class="text-sm">Case insensitive (i)</span>
      </label>
    </div>
  </div>

  <p class="text-xs text-muted-foreground">
    Use regular expressions for advanced pattern matching.
  </p>
</div>
