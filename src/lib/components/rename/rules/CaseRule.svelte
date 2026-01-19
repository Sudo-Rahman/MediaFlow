<script lang="ts">
  import type { CaseConfig, CaseMode } from '$lib/types/rename';
  import { Label } from '$lib/components/ui/label';
  import * as RadioGroup from '$lib/components/ui/radio-group';

  interface CaseRuleProps {
    config: CaseConfig;
    onUpdate: (config: CaseConfig) => void;
  }

  let { config, onUpdate }: CaseRuleProps = $props();

  const caseOptions: { value: CaseMode; label: string; example: string }[] = [
    { value: 'upper', label: 'UPPERCASE', example: 'MY FILE NAME' },
    { value: 'lower', label: 'lowercase', example: 'my file name' },
    { value: 'title', label: 'Title Case', example: 'My File Name' },
    { value: 'sentence', label: 'Sentence case', example: 'My file name' },
    { value: 'capitalize', label: 'Capitalize Each Word', example: 'My File Name' },
  ];

  function handleChange(value: string) {
    onUpdate({ mode: value as CaseMode });
  }
</script>

<div class="space-y-3">
  <Label>Case Style</Label>
  
  <RadioGroup.Root value={config.mode} onValueChange={handleChange} class="space-y-2">
    {#each caseOptions as option}
      <label class="flex items-center gap-3 p-2 rounded-md border cursor-pointer hover:bg-accent/50 transition-colors">
        <RadioGroup.Item value={option.value} />
        <div class="flex-1">
          <p class="text-sm font-medium">{option.label}</p>
          <p class="text-xs text-muted-foreground font-mono">{option.example}</p>
        </div>
      </label>
    {/each}
  </RadioGroup.Root>
</div>
