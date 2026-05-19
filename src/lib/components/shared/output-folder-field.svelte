<script lang="ts" module>
  let nextOutputFolderFieldId = 0;
</script>

<script lang="ts">
  import { FolderOpen } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import type { OutputFolderFieldState } from '$lib/utils/output-folder';

  interface OutputFolderFieldProps {
    label: string;
    displayText?: string;
    state: OutputFolderFieldState;
    placeholder?: string;
    description?: string;
    disabled?: boolean;
    showReset?: boolean;
    resetLabel?: string;
    browseAriaLabel?: string;
    inputId?: string;
    onBrowse?: () => void | Promise<void>;
    onReset?: () => void;
  }

  let {
    label,
    displayText = '',
    state,
    placeholder = 'Select output folder...',
    description,
    disabled = false,
    showReset = false,
    resetLabel = 'Reset',
    browseAriaLabel = 'Select output folder',
    inputId = `output-folder-field-${nextOutputFolderFieldId += 1}`,
    onBrowse,
    onReset,
  }: OutputFolderFieldProps = $props();

  const normalizedDisplayText = $derived(displayText.trim());
  const inputValue = $derived(state === 'empty' ? '' : normalizedDisplayText);
  const displayTitle = $derived(state === 'empty' ? undefined : normalizedDisplayText);
</script>

<Field.Field>
  <Field.Label for={inputId}>{label}</Field.Label>

  <div class="flex gap-2">
    <Input
      id={inputId}
      value={inputValue}
      readonly
      placeholder={placeholder}
      class="text-xs"
      title={displayTitle}
    />
    <Button variant="outline" size="icon" onclick={onBrowse} disabled={disabled || !onBrowse} aria-label={browseAriaLabel}>
      <FolderOpen />
    </Button>
  </div>

  {#if description}
    <Field.Description class="text-xs">
      {description}
    </Field.Description>
  {/if}

  {#if showReset && onReset}
    <div>
      <Button
        variant="ghost"
        class="h-6 text-xs text-muted-foreground hover:text-foreground"
        onclick={onReset}
        disabled={disabled}
      >
        {resetLabel}
      </Button>
    </div>
  {/if}
</Field.Field>
