<script lang="ts">
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import * as Field from '$lib/components/ui/field';
  import { OutputFolderField } from '$lib/components/shared';
  import type { RenameMode } from '$lib/types/rename';
  import type { ResolvedOutputFolderDisplay } from '$lib/utils';

  interface RenameModePanelProps {
    mode: RenameMode;
    outputFolderDisplay: ResolvedOutputFolderDisplay;
    onModeChange: (mode: RenameMode) => void;
    onSelectOutputDir: () => void | Promise<void>;
  }

  let {
    mode,
    outputFolderDisplay,
    onModeChange,
    onSelectOutputDir,
  }: RenameModePanelProps = $props();

  function handleModeChange(value: string): void {
    onModeChange(value as RenameMode);
  }

  const controlId = $props.id();
  const renameModeId = `${controlId}-rename-mode`;
  const copyModeId = `${controlId}-copy-mode`;
</script>

<div class="space-y-4">
  <Field.FieldSet class="gap-2">
    <Field.FieldLegend variant="label" class="mb-0 text-xs uppercase tracking-wide text-muted-foreground">
      Mode
    </Field.FieldLegend>
    <RadioGroup.Root value={mode} onValueChange={handleModeChange} class="flex gap-4">
      <Field.Field orientation="horizontal" class="w-auto items-center gap-2">
        <RadioGroup.Item id={renameModeId} value="rename" />
        <Field.FieldLabel for={renameModeId} class="cursor-pointer text-sm">Rename</Field.FieldLabel>
      </Field.Field>
      <Field.Field orientation="horizontal" class="w-auto items-center gap-2">
        <RadioGroup.Item id={copyModeId} value="copy" />
        <Field.FieldLabel for={copyModeId} class="cursor-pointer text-sm">Copy</Field.FieldLabel>
      </Field.Field>
    </RadioGroup.Root>
  </Field.FieldSet>

  {#if mode === 'copy'}
    <OutputFolderField
      label="Output folder"
      displayText={outputFolderDisplay.displayText}
      state={outputFolderDisplay.state}
      onBrowse={onSelectOutputDir}
    />
  {/if}
</div>
