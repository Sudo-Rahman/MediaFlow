<script lang="ts">
  import { useId } from 'bits-ui';

  import * as Select from '$lib/components/ui/select';
  import type { SubtitleOcrProcessingDraft, SubtitleOcrVersion } from '$lib/types';
  import { cn } from '$lib/utils';
  import {
    buildSubtitleOcrVersionOptions,
    toCompactSubtitleOcrVersionLabel,
  } from './subtitle-ocr-version-selector';

  interface SubtitleOcrVersionSelectorProps {
    versions: SubtitleOcrVersion[];
    activeVersionId: string | null;
    processingDraft?: SubtitleOcrProcessingDraft;
    compact?: boolean;
    onSelectVersion: (versionId: string) => void;
  }

  let {
    versions,
    activeVersionId,
    processingDraft,
    compact = false,
    onSelectVersion,
  }: SubtitleOcrVersionSelectorProps = $props();

  const selectId = `${useId()}-subtitle-ocr-version`;
  const options = $derived(buildSubtitleOcrVersionOptions({ versions, processingDraft }));
  const activeVersionLabel = $derived(
    options.find((option) => option.id === activeVersionId)?.label ?? 'Select version',
  );
  const activeCompactVersionLabel = $derived(toCompactSubtitleOcrVersionLabel(activeVersionLabel));
  const triggerClass = $derived(cn(
    'max-w-full overflow-hidden transition-[width,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none',
    compact ? 'w-20' : 'w-28',
  ));
  const triggerLabel = $derived(compact ? activeCompactVersionLabel : activeVersionLabel);

  function handleValueChange(versionId: string): void {
    if (versionId) {
      onSelectVersion(versionId);
    }
  }
</script>

<Select.Root
  type="single"
  value={activeVersionId ?? undefined}
  onValueChange={handleValueChange}
  disabled={options.length === 0}
>
  <Select.Trigger
    id={selectId}
    size="sm"
    class={triggerClass}
    aria-label="Subtitle OCR version"
  >
    <span class="min-w-0 flex-1 truncate text-left">
      {triggerLabel}
    </span>
  </Select.Trigger>
  <Select.Content>
    <Select.Group>
      {#each options as option (option.id)}
        <Select.Item value={option.id}>
          <span class="min-w-0 flex-1 truncate">{option.label}</span>
          <span class="text-xs text-muted-foreground">
            {option.description}
          </span>
        </Select.Item>
      {/each}
    </Select.Group>
  </Select.Content>
</Select.Root>
