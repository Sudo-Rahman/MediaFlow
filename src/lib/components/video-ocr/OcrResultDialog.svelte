<script lang="ts">
  import { Calendar, Clock, Info } from '@lucide/svelte';
  import { onDestroy, untrack } from 'svelte';
  import { save } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import { toast } from 'svelte-sonner';

  import type { OcrOutputFormat, OcrVideoFile, OcrVersion } from '$lib/types/video-ocr';
  import { OCR_OUTPUT_FORMATS } from '$lib/types/video-ocr';
  import { getFileName } from '$lib/utils/format';
  import { normalizeOcrSubtitles, toRustOcrSubtitles } from '$lib/utils/ocr-subtitle-adapter';
  import { Badge } from '$lib/components/ui/badge';
  import { VersionBrowserDialog } from '$lib/components/shared';
  import {
    buildOcrResultVersionLoadKey,
    createOcrResultVersionSnapshot,
  } from './ocr-result-dialog-state';
  import { buildFormattedOcrPreview } from './ocr-preview-format';
  import { getOcrResultVersionAllowedFormats } from './ocr-versioned-export';

  interface OcrResultDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    file: OcrVideoFile | null;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    file,
  }: OcrResultDialogProps = $props();

  let currentVersionIndex = $state(0);
  let selectedFormat = $state<OcrOutputFormat>('srt');
  let isPreviewPending = $state(false);
  let versionsLoading = $state(false);
  let loadedVersions = $state.raw<OcrVersion[]>([]);
  let previewText = $state('');
  let lastVersionLoadKey: string | null = null;
  let loadVersionsTimeoutId: ReturnType<typeof window.setTimeout> | null = null;
  let loadVersionsFrameId: number | null = null;
  let loadVersionsRunId = 0;
  const previewCache = new Map<string, string>();
  const DIALOG_OPEN_SETTLE_MS = 320;
  const versionLoadKey = $derived(buildOcrResultVersionLoadKey(file));

  function clearDeferredVersionLoad(): void {
    loadVersionsRunId += 1;

    if (loadVersionsTimeoutId !== null) {
      clearTimeout(loadVersionsTimeoutId);
      loadVersionsTimeoutId = null;
    }

    if (loadVersionsFrameId !== null) {
      cancelAnimationFrame(loadVersionsFrameId);
      loadVersionsFrameId = null;
    }
  }

  // Deferred version loading — same pattern as before to avoid jank on dialog open
  $effect(() => {
    if (!open) {
      clearDeferredVersionLoad();
      previewCache.clear();
      versionsLoading = false;
      loadedVersions = [];
      currentVersionIndex = 0;
      lastVersionLoadKey = null;
      return;
    }

    const loadKey = versionLoadKey;
    if (!loadKey) {
      clearDeferredVersionLoad();
      versionsLoading = true;
      loadedVersions = [];
      currentVersionIndex = 0;
      lastVersionLoadKey = null;
      return;
    }

    if (loadKey === lastVersionLoadKey) {
      return;
    }

    lastVersionLoadKey = loadKey;
    clearDeferredVersionLoad();
    previewCache.clear();
    versionsLoading = true;
    loadedVersions = [];
    currentVersionIndex = 0;
    const versionSnapshot = untrack(() => createOcrResultVersionSnapshot(file?.ocrVersions ?? []));
    const runId = loadVersionsRunId;

    loadVersionsTimeoutId = window.setTimeout(() => {
      loadVersionsTimeoutId = null;
      loadVersionsFrameId = requestAnimationFrame(() => {
        loadVersionsFrameId = null;
        if (runId !== loadVersionsRunId) {
          return;
        }

        loadedVersions = versionSnapshot;
        currentVersionIndex = loadedVersions.length > 0 ? loadedVersions.length - 1 : 0;
        versionsLoading = false;
      });
    }, DIALOG_OPEN_SETTLE_MS);
  });

  onDestroy(clearDeferredVersionLoad);

  const currentVersion = $derived(loadedVersions[currentVersionIndex] ?? null);
  const currentAllowedFormats = $derived(getOcrResultVersionAllowedFormats(currentVersion));
  const normalizedSubtitles = $derived.by(() => {
    if (!open || versionsLoading || !currentVersion) {
      return [];
    }
    return normalizeOcrSubtitles(currentVersion.finalSubtitles);
  });
  const baseName = $derived((file?.name ?? 'video').replace(/\.[^/.]+$/, ''));
  const currentPreviewCacheKey = $derived(
    file && currentVersion ? `${file.path}:${currentVersion.id}:${selectedFormat}` : null
  );

  $effect(() => {
    if (!currentAllowedFormats.includes(selectedFormat)) {
      selectedFormat = currentAllowedFormats[0] ?? 'srt';
    }
  });

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

  function getModeLabel(mode: OcrVersion['mode']): string {
    switch (mode) {
      case 'full_pipeline':
        return 'Full pipeline';
      case 'cleanup_only':
        return 'Cleanup only';
      case 'cleanup_and_ai':
        return 'Cleanup + AI';
      case 'ai_only':
        return 'AI only';
    }
  }

  // Preview generation with caching
  $effect(() => {
    if (!open || versionsLoading || !currentVersion || !currentPreviewCacheKey) {
      previewText = '';
      isPreviewPending = false;
      return;
    }

    const cacheKey = currentPreviewCacheKey;
    const cachedPreview = previewCache.get(cacheKey);
    if (cachedPreview !== undefined) {
      previewText = cachedPreview;
      isPreviewPending = false;
      return;
    }

    isPreviewPending = true;
    previewText = '';
    const subtitles = normalizedSubtitles;
    const format = selectedFormat;
    let cancelled = false;

    const frameId = requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }

      const generatedPreview = buildFormattedOcrPreview(format, subtitles);
      previewCache.set(cacheKey, generatedPreview);
      previewText = generatedPreview;
      isPreviewPending = false;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  });

  function sanitizeVersionName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }

  async function handleExport(): Promise<void> {
    const exportFile = file;
    const exportVersion = currentVersion;
    const exportFormat = selectedFormat;
    const exportSubtitles = normalizedSubtitles;
    const exportBaseName = baseName;

    if (!exportFile || !exportVersion) {
      return;
    }

    const versionSuffix = sanitizeVersionName(exportVersion.name);
    const outputPath = await save({
      title: 'Export subtitles',
      defaultPath: `${exportBaseName}_${versionSuffix}.${exportFormat}`,
      filters: [{
        name: OCR_OUTPUT_FORMATS.find((f) => f.value === exportFormat)?.label ?? 'Subtitle file',
        extensions: [exportFormat],
      }],
    });

    if (!outputPath) {
      return;
    }

    try {
      await invoke('export_ocr_subtitles', {
        subtitles: toRustOcrSubtitles(exportSubtitles),
        outputPath,
        format: exportFormat,
      });
      toast.success(`Exported ${getFileName(outputPath)}`);
    } catch (error) {
      console.error('Export failed:', error);
      toast.error(error instanceof Error ? error.message : 'Export failed');
    }
  }
</script>

<VersionBrowserDialog
  bind:open
  {onOpenChange}
  title="OCR Results"
  description={file?.name ?? 'Unknown video'}
  versions={loadedVersions}
  currentIndex={currentVersionIndex}
  onIndexChange={(i) => { currentVersionIndex = i; }}
  isLoading={versionsLoading || !file}
  formats={currentAllowedFormats}
  selectedFormat={selectedFormat}
  onFormatChange={(f) => {
    const nextFormat = f as OcrOutputFormat;
    if (currentAllowedFormats.includes(nextFormat)) {
      selectedFormat = nextFormat;
    }
  }}
  previewContent={previewText}
  isPreviewLoading={isPreviewPending}
  onExport={handleExport}
>
  {#snippet metadata()}
    {#if currentVersion}
      <div class="flex items-center gap-4 text-xs text-muted-foreground pb-2 flex-wrap">
        <span class="flex items-center gap-1">
          <Calendar class="size-3" />
          {formatDate(currentVersion.createdAt)}
        </span>
        <span class="flex items-center gap-1">
          <Info class="size-3" />
          {getModeLabel(currentVersion.mode)}
        </span>
        <span class="flex items-center gap-1">
          <Clock class="size-3" />
          {normalizedSubtitles.length} subtitle{normalizedSubtitles.length > 1 ? 's' : ''}
        </span>
        <Badge variant="outline" class="text-[10px]">
          {currentVersion.configSnapshot.language}
        </Badge>
        <Badge variant="outline" class="text-[10px]">
          {currentVersion.configSnapshot.frameRate} fps
        </Badge>
      </div>
    {/if}
  {/snippet}
</VersionBrowserDialog>
