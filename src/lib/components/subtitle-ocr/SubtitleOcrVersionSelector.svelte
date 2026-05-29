<script lang="ts">
  import { useId } from 'bits-ui';

  import * as Select from '$lib/components/ui/select';
  import type { SubtitleOcrVersion } from '$lib/types';
  import { cn } from '$lib/utils';

  interface SubtitleOcrVersionSelectorProps {
    versions: SubtitleOcrVersion[];
    activeVersionId: string | null;
    compact?: boolean;
    onSelectVersion: (versionId: string) => void;
  }

  let {
    versions,
    activeVersionId,
    compact = false,
    onSelectVersion,
  }: SubtitleOcrVersionSelectorProps = $props();

  const selectId = `${useId()}-subtitle-ocr-version`;
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const activeVersionLabel = $derived(
    versions.find((version) => version.id === activeVersionId)?.name ?? 'Select version',
  );
  const activeCompactVersionLabel = $derived(toCompactVersionLabel(activeVersionLabel));
  const triggerClass = $derived(cn(
    'max-w-full overflow-hidden transition-[width,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none',
    compact ? 'w-20' : 'w-28',
  ));
  const triggerLabel = $derived(compact ? activeCompactVersionLabel : activeVersionLabel);

  function getVersionModeLabel(version: SubtitleOcrVersion): string {
    return version.mode === 'ai_cleanup_only' ? 'AI cleanup' : 'Full OCR';
  }

  function formatVersionDate(createdAt: string): string {
    const timestamp = Date.parse(createdAt);
    if (!Number.isFinite(timestamp)) {
      return 'Unknown date';
    }

    return dateFormatter.format(new Date(timestamp));
  }

  function toCompactVersionLabel(label: string): string {
    const match = /^Version\s+(.+)$/i.exec(label.trim());
    return match ? `V${match[1]}` : label;
  }

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
  disabled={versions.length === 0}
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
      {#each versions as version (version.id)}
        <Select.Item value={version.id}>
          <span class="min-w-0 flex-1 truncate">{version.name}</span>
          <span class="text-xs text-muted-foreground">
            {getVersionModeLabel(version)} · {formatVersionDate(version.createdAt)}
          </span>
        </Select.Item>
      {/each}
    </Select.Group>
  </Select.Content>
</Select.Root>
