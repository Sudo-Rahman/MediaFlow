<script lang="ts">
  import type { OcrSubtitle, OcrOutputFormat } from '$lib/types/video-ocr';
  import { OCR_OUTPUT_FORMATS } from '$lib/types/video-ocr';
  import { normalizeOcrSubtitles, toRustOcrSubtitles } from '$lib/utils/ocr-subtitle-adapter';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import * as Select from '$lib/components/ui/select';
  import { Copy, Download, X } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { save } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';

  interface OcrResultDialogProps {
    open: boolean;
    subtitles: OcrSubtitle[];
    videoName?: string;
    onClose: () => void;
  }

  let {
    open,
    subtitles,
    videoName = 'Video',
    onClose,
  }: OcrResultDialogProps = $props();

  let selectedFormat = $state<OcrOutputFormat>('srt');

  // Get base name without extension
  const baseName = $derived(videoName.replace(/\.[^/.]+$/, ''));

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

  function buildFormattedPreview(format: OcrOutputFormat, items: OcrSubtitle[]): string {
    if (items.length === 0) return '';

    if (format === 'txt') {
      return items.map((sub) => sub.text).join('\n');
    }

    if (format === 'vtt') {
      const body = items.map((sub) => 
        `${formatVttTime(sub.startTime)} --> ${formatVttTime(sub.endTime)}\n${sub.text}\n`
      ).join('\n');
      return `WEBVTT\n\n${body}`;
    }

    // Default: SRT
    return items.map((sub, i) => 
      `${i + 1}\n${formatSrtTime(sub.startTime)} --> ${formatSrtTime(sub.endTime)}\n${sub.text}\n`
    ).join('\n');
  }

  const normalizedSubtitles = $derived.by(() => normalizeOcrSubtitles(subtitles));
  const previewText = $derived.by(() => buildFormattedPreview(selectedFormat, normalizedSubtitles));

  async function copyToClipboard() {
    if (!previewText) return;
    await navigator.clipboard.writeText(previewText);
    toast.success('Copied to clipboard');
  }

  async function handleExport() {
    if (normalizedSubtitles.length === 0) return;

    try {
      // Open save dialog
      const outputPath = await save({
        title: 'Export subtitles',
        defaultPath: `${baseName}.${selectedFormat}`,
        filters: [{
          name: OCR_OUTPUT_FORMATS.find(f => f.value === selectedFormat)?.label ?? 'Subtitle file',
          extensions: [selectedFormat]
        }]
      });

      if (!outputPath) return; // User cancelled

      await invoke('export_ocr_subtitles', {
        subtitles: toRustOcrSubtitles(normalizedSubtitles),
        outputPath,
        format: selectedFormat,
      });

      toast.success(`Exported to ${outputPath}`);
      onClose();
    } catch (error) {
      console.error('Export failed:', error);
      toast.error(error instanceof Error ? error.message : 'Export failed');
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => !isOpen && onClose()}>
  <Dialog.Content class="max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
    <Dialog.Header class="px-2">
      <Dialog.Title >OCR Results - {videoName}</Dialog.Title>
      <Dialog.Description>
        {normalizedSubtitles.length} subtitle{normalizedSubtitles.length !== 1 ? 's' : ''} detected
      </Dialog.Description>
    </Dialog.Header>

    <!-- Subtitle preview -->
    <ScrollArea class="flex-1 h-[calc(80vh-200px)] border rounded-lg">
      <div class="p-4">
        {#if normalizedSubtitles.length === 0}
          <p class="text-center text-muted-foreground py-8">
            No subtitles detected in this video
          </p>
        {:else}
          <pre class="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{previewText}</pre>
        {/if}
      </div>
    </ScrollArea>

    <!-- Actions -->
    <div class="flex items-center justify-between pt-4 border-t">
      <div class="flex items-center gap-2">
        <Select.Root type="single" value={selectedFormat} onValueChange={(v) => selectedFormat = v as OcrOutputFormat}>
          <Select.Trigger class="w-35">
            {OCR_OUTPUT_FORMATS.find(f => f.value === selectedFormat)?.label}
          </Select.Trigger>
          <Select.Content>
            {#each OCR_OUTPUT_FORMATS as format}
              <Select.Item value={format.value}>{format.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        
        <Button onclick={handleExport} disabled={normalizedSubtitles.length === 0}>
          <Download class="size-4 mr-2" />
          Export
        </Button>
      </div>

      <div class="flex items-center gap-2 pl-2">
        <Button variant="outline" onclick={copyToClipboard} disabled={normalizedSubtitles.length === 0}>
          <Copy class="size-4 mr-2" />
          Copy {selectedFormat.toUpperCase()}
        </Button>
        
        <Button variant="ghost" onclick={onClose}>
          <X class="size-4 mr-2" />
          Close
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
