<script lang="ts">
  import { Calendar, Clock } from '@lucide/svelte';
  import { save } from '@tauri-apps/plugin-dialog';
  import { writeTextFile } from '@tauri-apps/plugin-fs';
  import type { AudioFile, TranscriptionVersion, TranscriptionOutputFormat } from '$lib/types';
  import { formatToSRT, formatToVTT, formatToJSON } from '$lib/services/deepgram';
  import { Badge } from '$lib/components/ui/badge';
  import { VersionBrowserDialog } from '$lib/components/shared';
  import { formatDuration } from '$lib/utils/format';

  import { toast } from 'svelte-sonner';

  interface TranscriptionResultDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    file: AudioFile | null;
    onDeleteVersion?: (fileId: string, versionId: string) => void;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    file,
    onDeleteVersion,
  }: TranscriptionResultDialogProps = $props();

  let currentVersionIndex = $state(0);
  let exportFormat = $state<TranscriptionOutputFormat>('srt');

  // Reset to last version when file changes
  $effect(() => {
    if (file && file.transcriptionVersions.length > 0) {
      currentVersionIndex = file.transcriptionVersions.length - 1;
    } else {
      currentVersionIndex = 0;
    }
  });

  const versions = $derived(file?.transcriptionVersions ?? []);
  const currentVersion = $derived(versions[currentVersionIndex] ?? null);

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

  function getFormattedContent(version: TranscriptionVersion, format: TranscriptionOutputFormat): string {
    switch (format) {
      case 'srt':
        return formatToSRT(version.result);
      case 'vtt':
        return formatToVTT(version.result);
      case 'json':
        return JSON.stringify(formatToJSON(version.result), null, 2);
    }
  }

  const previewContent = $derived(currentVersion ? getFormattedContent(currentVersion, exportFormat) : '');

  function sanitizeVersionName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }

  async function handleExport(): Promise<void> {
    if (!currentVersion || !file) return;

    const extensions: Record<TranscriptionOutputFormat, string> = {
      srt: 'srt',
      vtt: 'vtt',
      json: 'json',
    };

    const ext = extensions[exportFormat];
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const versionSuffix = sanitizeVersionName(currentVersion.name);
    const defaultName = `${baseName}_${versionSuffix}.${ext}`;

    const savePath = await save({
      defaultPath: defaultName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });

    if (!savePath) return;

    try {
      const content = getFormattedContent(currentVersion, exportFormat);
      await writeTextFile(savePath, content);
      toast.success(`Exported to ${savePath.split('/').pop()}`);
    } catch {
      toast.error('Export failed');
    }
  }

  function handleDeleteVersion(versionId: string): void {
    if (!file || !onDeleteVersion) return;
    onDeleteVersion(file.id, versionId);
  }
</script>

<VersionBrowserDialog
  bind:open
  {onOpenChange}
  title="Transcription Result"
  description={file?.name ?? 'Unknown file'}
  {versions}
  currentIndex={currentVersionIndex}
  onIndexChange={(i) => { currentVersionIndex = i; }}
  formats={['srt', 'vtt', 'json']}
  selectedFormat={exportFormat}
  onFormatChange={(f) => { exportFormat = f as TranscriptionOutputFormat; }}
  {previewContent}
  onExport={handleExport}
  onDelete={onDeleteVersion ? handleDeleteVersion : undefined}
>
  {#snippet metadata()}
    {#if currentVersion}
      <div class="flex items-center gap-4 text-xs text-muted-foreground pb-2">
        <span class="flex items-center gap-1">
          <Calendar class="size-3" />
          {formatDate(currentVersion.createdAt)}
        </span>
        <span class="flex items-center gap-1">
          <Clock class="size-3" />
          {formatDuration(currentVersion.result.duration)}
        </span>
        <Badge variant="outline" class="text-[10px]">
          {currentVersion.config.model}
        </Badge>
        {#if currentVersion.result.language}
          <Badge variant="outline" class="text-[10px]">
            {currentVersion.result.language}
          </Badge>
        {/if}
      </div>
    {/if}
  {/snippet}
</VersionBrowserDialog>
