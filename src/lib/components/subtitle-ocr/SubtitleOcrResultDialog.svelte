<script lang="ts">
  import { Calendar, Clock, Info } from '@lucide/svelte';
  import { save } from '@tauri-apps/plugin-dialog';
  import { toast } from 'svelte-sonner';

  import { VersionBrowserDialog } from '$lib/components/shared';
  import { Badge } from '$lib/components/ui/badge';
  import {
    buildSubtitleOcrPreview,
    countExportableSubtitleOcrCues,
    exportSubtitleOcrVersion,
    SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS,
    type SubtitleOcrExportFormat,
  } from '$lib/services/subtitle-ocr-export';
  import type { SubtitleOcrSourceItem, SubtitleOcrVersion } from '$lib/types';
  import { SUBTITLE_OCR_OUTPUT_FORMATS } from '$lib/types';
  import { getFileName } from '$lib/utils/format';

  interface SubtitleOcrResultDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: SubtitleOcrSourceItem | null;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    item,
  }: SubtitleOcrResultDialogProps = $props();

  let currentVersionIndex = $state(0);
  let selectedFormat = $state<SubtitleOcrExportFormat>('srt');
  let lastDialogKey = '';

  const versions = $derived(item?.versions ?? []);
  const currentVersion = $derived(versions[currentVersionIndex] ?? null);
  const dialogKey = $derived(
    open && item
      ? `${item.id}:${item.activeVersionId ?? 'none'}:${item.versions.map((version) => version.id).join(',')}`
      : '',
  );
  const previewContent = $derived(
    currentVersion ? buildSubtitleOcrPreview(currentVersion.finalCues, selectedFormat) : '',
  );
  const exportableCueCount = $derived(
    currentVersion ? countExportableSubtitleOcrCues(currentVersion.finalCues) : 0,
  );

  $effect(() => {
    if (dialogKey === lastDialogKey) {
      return;
    }

    lastDialogKey = dialogKey;
    selectedFormat = 'srt';
    currentVersionIndex = getInitialVersionIndex(versions, item?.activeVersionId ?? null);
  });

  function getInitialVersionIndex(
    nextVersions: readonly SubtitleOcrVersion[],
    activeVersionId: string | null,
  ): number {
    if (nextVersions.length === 0) {
      return 0;
    }

    const activeIndex = activeVersionId
      ? nextVersions.findIndex((version) => version.id === activeVersionId)
      : -1;

    return activeIndex >= 0 ? activeIndex : nextVersions.length - 1;
  }

  function formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getModeLabel(version: SubtitleOcrVersion): string {
    return version.mode === 'ai_cleanup_only' ? 'AI cleanup only' : 'Full OCR';
  }

  function sanitizeVersionName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }

  async function handleExport(): Promise<void> {
    const exportItem = item;
    const exportVersion = currentVersion;
    const exportFormat = selectedFormat;
    if (!exportItem || !exportVersion) {
      return;
    }

    const baseName = exportItem.displayName.replace(/\.[^/.]+$/, '');
    const versionSuffix = sanitizeVersionName(exportVersion.name);
    const outputPath = await save({
      title: 'Export Subtitle OCR version',
      defaultPath: `${baseName}_${versionSuffix}.${exportFormat}`,
      filters: [{
        name: SUBTITLE_OCR_OUTPUT_FORMATS.find((format) => format.value === exportFormat)?.label
          ?? 'Subtitle file',
        extensions: [exportFormat],
      }],
    });

    if (!outputPath) {
      return;
    }

    try {
      await exportSubtitleOcrVersion({
        cues: exportVersion.finalCues,
        outputPath,
        format: exportFormat,
      });
      toast.success(`Exported ${getFileName(outputPath)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    }
  }
</script>

<VersionBrowserDialog
  bind:open
  {onOpenChange}
  title="Subtitle OCR Versions"
  description={item?.displayName ?? 'Unknown source'}
  {versions}
  currentIndex={currentVersionIndex}
  onIndexChange={(index) => { currentVersionIndex = index; }}
  isLoading={!item}
  formats={[...SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS]}
  selectedFormat={selectedFormat}
  onFormatChange={(format) => {
    if (SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS.includes(format as SubtitleOcrExportFormat)) {
      selectedFormat = format as SubtitleOcrExportFormat;
    }
  }}
  {previewContent}
  onExport={handleExport}
>
  {#snippet metadata()}
    {#if currentVersion}
      <div class="flex flex-wrap items-center gap-4 pb-2 text-xs text-muted-foreground">
        <span class="flex items-center gap-1">
          <Calendar class="size-3" />
          {formatDate(currentVersion.createdAt)}
        </span>
        <span class="flex items-center gap-1">
          <Info class="size-3" />
          {getModeLabel(currentVersion)}
        </span>
        <span class="flex items-center gap-1">
          <Clock class="size-3" />
          {exportableCueCount} cue{exportableCueCount === 1 ? '' : 's'}
        </span>
        <Badge variant="outline" class="text-[10px]">
          {currentVersion.effectiveOcrModel}
        </Badge>
        {#if currentVersion.aiCleanupApplied}
          <Badge variant="secondary" class="text-[10px]">
            AI cleanup
          </Badge>
        {/if}
      </div>
    {/if}
  {/snippet}
</VersionBrowserDialog>
