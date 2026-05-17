<script lang="ts">
  import type { CaseConfig, CaseMode } from '$lib/types/rename';
  import * as Field from '$lib/components/ui/field';
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

  const controlId = $props.id();
</script>

<Field.FieldSet class="gap-3">
  <Field.FieldLegend variant="label" class="mb-0">Case Style</Field.FieldLegend>
  
  <RadioGroup.Root value={config.mode} onValueChange={handleChange} class="space-y-2">
    {#each caseOptions as option (option.value)}
      {@const optionId = `${controlId}-case-${option.value}`}
      <Field.Field orientation="horizontal" class="relative border p-3 transition-colors hover:bg-accent/50">
        <RadioGroup.Item id={optionId} value={option.value} />
        <Field.FieldLabel for={optionId} class="absolute inset-0 z-10 cursor-pointer">
          <span class="sr-only">{option.label}: {option.example}</span>
        </Field.FieldLabel>
        <Field.FieldContent class="pointer-events-none">
          <Field.FieldTitle>{option.label}</Field.FieldTitle>
          <Field.FieldDescription class="font-mono text-xs">{option.example}</Field.FieldDescription>
        </Field.FieldContent>
      </Field.Field>
    {/each}
  </RadioGroup.Root>
</Field.FieldSet>
