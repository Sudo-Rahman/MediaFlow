<script lang="ts">
  import { Calendar, Clock, Info } from '@lucide/svelte';
  import { save } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import { toast } from 'svelte-sonner';

  import type { OcrOutputFormat, OcrSubtitle, OcrVideoFile, OcrVersion } from '$lib/types/video-ocr';
  import { OCR_OUTPUT_FORMATS } from '$lib/types/video-ocr';
  import { normalizeOcrSubtitles, toRustOcrSubtitles } from '$lib/utils/ocr-subtitle-adapter';
  import { Badge } from '$lib/components/ui/badge';
  import { VersionBrowserDialog } from '$lib/components/shared';

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
  const previewCache = new Map<string, string>();
  const DIALOG_OPEN_SETTLE_MS = 320;

  // Deferred version loading — same pattern as before to avoid jank on dialog open
  $effect(() => {
    if (!open) {
      versionsLoading = false;
      loadedVersions = [];
      currentVersionIndex = 0;
      return;
    }

    if (!file) {
      versionsLoading = true;
      loadedVersions = [];
      currentVersionIndex = 0;
      return;
    }

    versionsLoading = true;
    loadedVersions = [];
    currentVersionIndex = 0;
    let cancelled = false;
    let frameId: number | null = null;

    const timeoutId = window.setTimeout(() => {
      frameId = requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }

        loadedVersions = file.ocrVersions.map((version) => ({
          ...version,
          rawOcr: [],
        }));
        currentVersionIndex = loadedVersions.length > 0 ? loadedVersions.length - 1 : 0;
        versionsLoading = false;
      });
    }, DIALOG_OPEN_SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  });

  const currentVersion = $derived(loadedVersions[currentVersionIndex] ?? null);
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

  function formatSrtTime(ms: number): string {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    const millis = ms % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
  }

  function formatVttTime(ms: number): string {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    const millis = ms % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }

  function buildFormattedPreview(format: OcrOutputFormat, subtitles: OcrSubtitle[]): string {
    if (subtitles.length === 0) {
      return '';
    }

    if (format === 'txt') {
      return subtitles.map((sub) => sub.text).join('\n');
    }

    if (format === 'vtt') {
      const body = subtitles
        .map((sub) =>
          `${formatVttTime(sub.startTime)} --> ${formatVttTime(sub.endTime)}\n${sub.text}\n`
        )
        .join('\n');
      return `WEBVTT\n\n${body}`;
    }

    return subtitles
      .map((sub, i) =>
        `${i + 1}\n${formatSrtTime(sub.startTime)} --> ${formatSrtTime(sub.endTime)}\n${sub.text}\n`
      )
      .join('\n');
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

      const generatedPreview = buildFormattedPreview(format, subtitles);
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
    if (!file || !currentVersion) {
      return;
    }

    const versionSuffix = sanitizeVersionName(currentVersion.name);
    const outputPath = await save({
      title: 'Export subtitles',
      defaultPath: `${baseName}_${versionSuffix}.${selectedFormat}`,
      filters: [{
        name: OCR_OUTPUT_FORMATS.find((f) => f.value === selectedFormat)?.label ?? 'Subtitle file',
        extensions: [selectedFormat],
      }],
    });

    if (!outputPath) {
      return;
    }

    try {
      await invoke('export_ocr_subtitles', {
        subtitles: toRustOcrSubtitles(normalizedSubtitles),
        outputPath,
        format: selectedFormat,
      });
      toast.success(`Exported ${outputPath.split('/').pop()}`);
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
  formats={['srt', 'vtt', 'txt']}
  selectedFormat={selectedFormat}
  onFormatChange={(f) => { selectedFormat = f as OcrOutputFormat; }}
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
