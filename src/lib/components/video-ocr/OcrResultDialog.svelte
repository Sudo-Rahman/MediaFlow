<script lang="ts">
  import { Calendar, Clock, Info } from '@lucide/svelte';
  import { onDestroy, untrack } from 'svelte';
  import { save } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import { toast } from 'svelte-sonner';

  import type { OcrOutputFormat, OcrSubtitle, OcrVideoFile, OcrVersion } from '$lib/types/video-ocr';
  import { OCR_OUTPUT_FORMATS } from '$lib/types/video-ocr';
  import { normalizeOcrSubtitles, toRustOcrSubtitles } from '$lib/utils/ocr-subtitle-adapter';
  import { Badge } from '$lib/components/ui/badge';
  import { VersionBrowserDialog } from '$lib/components/shared';
  import {
    buildOcrResultVersionLoadKey,
    createOcrResultVersionSnapshot,
  } from './ocr-result-dialog-state';

  interface OcrResultDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    file: OcrVideoFile | null;
    allowedFormats?: OcrOutputFormat[];
  }

  let {
    open = $bindable(false),
    onOpenChange,
    file,
    allowedFormats = ['srt', 'vtt'],
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
    if (!allowedFormats.includes(selectedFormat)) {
      selectedFormat = allowedFormats[0] ?? 'srt';
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

  function formatAssTime(ms: number): string {
    const centiseconds = Math.floor((ms % 1000) / 10);
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
  }

  function formatAssText(text: string): string {
    return text
      .replace(/\r\n|\r|\n/g, '\\N')
      .replace(/{/g, '\\{')
      .replace(/}/g, '\\}');
  }

  function buildFormattedPreview(format: OcrOutputFormat, subtitles: OcrSubtitle[]): string {
    if (subtitles.length === 0) {
      return '';
    }

    if (format === 'vtt') {
      const body = subtitles
        .map((sub) =>
          `${formatVttTime(sub.startTime)} --> ${formatVttTime(sub.endTime)}\n${sub.text}\n`
        )
        .join('\n');
      return `WEBVTT\n\n${body}`;
    }

    if (format === 'ass') {
      const events = subtitles
        .map((sub) =>
          `Dialogue: 0,${formatAssTime(sub.startTime)},${formatAssTime(sub.endTime)},Default,,0,0,0,,${formatAssText(sub.text)}`
        )
        .join('\n');
      return [
        '[Script Info]',
        'ScriptType: v4.00+',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,40,1',
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        events,
      ].join('\n');
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
  formats={allowedFormats}
  selectedFormat={selectedFormat}
  onFormatChange={(f) => {
    const nextFormat = f as OcrOutputFormat;
    if (allowedFormats.includes(nextFormat)) {
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
