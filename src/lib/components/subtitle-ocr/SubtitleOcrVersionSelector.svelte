<script lang="ts">
  import { useId } from 'bits-ui';

  import * as Select from '$lib/components/ui/select';
  import type { SubtitleOcrVersion } from '$lib/types';

  interface SubtitleOcrVersionSelectorProps {
    versions: SubtitleOcrVersion[];
    activeVersionId: string | null;
    onSelectVersion: (versionId: string) => void;
  }

  let {
    versions,
    activeVersionId,
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
  <Select.Trigger id={selectId} class="w-56 max-w-full" aria-label="Subtitle OCR version">
    {activeVersionLabel}
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
