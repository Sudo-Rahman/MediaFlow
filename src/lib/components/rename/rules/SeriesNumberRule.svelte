<script lang="ts">
  import { AlertTriangle, ListOrdered } from '@lucide/svelte';

  import type { RenameWorkspaceStore } from '$lib/stores/rename.svelte';
  import type { SeriesNumberConfig } from '$lib/types/rename';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as Item from '$lib/components/ui/item';
  import * as Select from '$lib/components/ui/select';

  interface SeriesNumberRuleProps {
    workspace: RenameWorkspaceStore;
    config: SeriesNumberConfig;
    onUpdate: (config: SeriesNumberConfig) => void;
  }

  let { workspace, config, onUpdate }: SeriesNumberRuleProps = $props();

  const positionOptions = [
    { value: 'prefix', label: 'At the beginning' },
    { value: 'suffix', label: 'At the end' },
    { value: 'replace', label: 'Replace entire name' },
  ];

  const preview = $derived.by(() => {
    const episode = String(config.start).padStart(config.padding, '0');
    const nextEpisode = String(config.start + config.step).padStart(config.padding, '0');
    return `S01E${episode}, S01E${nextEpisode}, …`;
  });
  const resolutions = $derived(workspace.seriesResolutions);

  function handlePositionChange(value: string | undefined): void {
    if (value) {
      onUpdate({ ...config, position: value as SeriesNumberConfig['position'] });
    }
  }

  function handleStartChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    onUpdate({ ...config, start: parseInt(target.value, 10) || 1 });
  }

  function handleStepChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    onUpdate({ ...config, step: parseInt(target.value, 10) || 1 });
  }

  function handlePaddingChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    onUpdate({ ...config, padding: parseInt(target.value, 10) || 1 });
  }

  function handleSeparatorChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    onUpdate({ ...config, separator: target.value });
  }

  function handleSeasonInput(groupKey: string, event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = Number.parseInt(target.value, 10);
    if (target.value.trim() === '') {
      workspace.clearSeasonAssignment(groupKey);
    } else if (Number.isInteger(value) && value > 0) {
      workspace.setSeasonAssignment(groupKey, value);
    }
  }

  const controlId = $props.id();
  const positionSelectId = `${controlId}-series-position`;
  const startInputId = `${controlId}-series-start`;
  const stepInputId = `${controlId}-series-step`;
  const paddingInputId = `${controlId}-series-padding`;
  const separatorInputId = `${controlId}-series-separator`;
</script>

<div class="min-w-0 space-y-3">
  <Field.Field>
    <Field.FieldLabel for={positionSelectId}>Position</Field.FieldLabel>
    <Select.Root type="single" value={config.position} onValueChange={handlePositionChange}>
      <Select.Trigger id={positionSelectId} class="w-full">
        {positionOptions.find((option) => option.value === config.position)?.label || 'Select position...'}
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

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
    <Field.Field>
      <Field.FieldLabel for={startInputId}>Episode start</Field.FieldLabel>
      <Input id={startInputId} type="number" min="1" value={config.start} oninput={handleStartChange} />
    </Field.Field>
    <Field.Field>
      <Field.FieldLabel for={stepInputId}>Step</Field.FieldLabel>
      <Input id={stepInputId} type="number" min="1" value={config.step} oninput={handleStepChange} />
    </Field.Field>
    <Field.Field>
      <Field.FieldLabel for={paddingInputId}>Episode padding</Field.FieldLabel>
      <Input id={paddingInputId} type="number" min="1" max="10" value={config.padding} oninput={handlePaddingChange} />
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

  <Item.Root variant="muted" size="xs" class="min-w-0">
    <Item.Description class="min-w-0 break-words text-xs">
      Preview: <span class="font-mono">{preview}</span>. Season uses two digits.
    </Item.Description>
  </Item.Root>

  {#if resolutions.length > 0}
    <section class="min-w-0 space-y-3 border-t pt-4" aria-labelledby={`${controlId}-season-assignments`}>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <ListOrdered class="size-4 shrink-0 text-primary" />
          <h3 id={`${controlId}-season-assignments`} class="font-semibold text-sm">Season assignments</h3>
        </div>
        <Button type="button" variant="outline" size="xs" onclick={() => workspace.assignSeasonsSequentially()}>
          Assign 1, 2, 3…
        </Button>
      </div>

      <div class="space-y-2">
        {#each resolutions as resolution, index (resolution.groupKey)}
          {@const seasonInputId = `${controlId}-season-${index}`}
          <Item.Root variant="outline" size="xs" class="min-w-0 items-start">
            <Item.Content class="min-w-0 overflow-hidden gap-1">
              <div class="flex min-w-0 items-center justify-between gap-2">
                <Item.Title class="min-w-0 w-auto flex-1 truncate text-sm" title={resolution.label}>
                  {resolution.label}
                </Item.Title>
                {#if resolution.explicitSeasonNumber !== undefined}
                  <Badge variant="secondary" class="shrink-0">Manual</Badge>
                {:else if resolution.status === 'resolved'}
                  <Badge variant="outline" class="shrink-0">Detected</Badge>
                {:else}
                  <Badge variant="destructive" class="shrink-0">Needs selection</Badge>
                {/if}
              </div>

              <Field.Field orientation="horizontal" class="flex-wrap items-center gap-2 sm:flex-nowrap">
                <Field.FieldLabel for={seasonInputId} class="text-xs text-muted-foreground">Season</Field.FieldLabel>
                <Input
                  id={seasonInputId}
                  type="number"
                  min="1"
                  value={resolution.explicitSeasonNumber ?? resolution.seasonNumber ?? ''}
                  aria-label={`Season for ${resolution.label}`}
                  oninput={(event) => handleSeasonInput(resolution.groupKey, event)}
                  class="h-7 w-20 shrink-0"
                />
                {#if resolution.explicitSeasonNumber !== undefined}
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onclick={() => workspace.clearSeasonAssignment(resolution.groupKey)}
                  >
                    Use detection
                  </Button>
                {/if}
              </Field.Field>

              {#if resolution.status === 'conflict'}
                <Alert variant="destructive" class="mt-1 px-2 py-1.5 text-xs">
                  <AlertTriangle class="size-3.5" />
                  <AlertDescription>
                    Several season numbers were found for this folder ({resolution.candidates.map((season) => `Season ${season}`).join(', ')}). Choose the season to use.
                  </AlertDescription>
                </Alert>
              {:else if resolution.status === 'unresolved'}
                <Alert variant="destructive" class="mt-1 px-2 py-1.5 text-xs">
                  <AlertTriangle class="size-3.5" />
                  <AlertDescription>No season number was found. Enter the season to use.</AlertDescription>
                </Alert>
              {/if}
            </Item.Content>
          </Item.Root>
        {/each}
      </div>
    </section>
  {/if}
</div>
