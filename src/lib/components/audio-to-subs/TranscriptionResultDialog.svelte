<script lang="ts">
  import { FileText, ChevronLeft, ChevronRight, Download, Copy, Check, Trash2, Calendar, Clock } from '@lucide/svelte';
  import { save } from '@tauri-apps/plugin-dialog';
  import { writeTextFile } from '@tauri-apps/plugin-fs';
  import type { AudioFile, TranscriptionVersion, TranscriptionOutputFormat } from '$lib/types';
  import { formatToSRT, formatToVTT, formatToJSON } from '$lib/services/deepgram';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { Badge } from '$lib/components/ui/badge';
  import * as Select from '$lib/components/ui/select';
  import { Separator } from '$lib/components/ui/separator';
  import { cn } from '$lib/utils';
  import { formatDuration } from '$lib/utils/format';
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
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
    onDeleteVersion
  }: TranscriptionResultDialogProps = $props();

  let currentVersionIndex = $state(0);
  let copied = $state(false);
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
  const hasMultipleVersions = $derived(versions.length > 1);

  function formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
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

  function getPreviewContent(): string {
    if (!currentVersion) return '';
    // Show content in the selected export format
    return getFormattedContent(currentVersion, exportFormat);
  }

  async function handleCopy() {
    if (!currentVersion) return;
    try {
      const content = getFormattedContent(currentVersion, exportFormat);
      await navigator.clipboard.writeText(content);
      copied = true;
      toast.success('Copied to clipboard');
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      toast.error('Copy failed');
    }
  }

  function sanitizeVersionName(name: string): string {
    // Remove special characters, keep alphanumeric and spaces, replace spaces with underscores
    return name
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }

  async function handleExport() {
    if (!currentVersion || !file) return;
    
    const extensions: Record<TranscriptionOutputFormat, string> = {
      srt: 'srt',
      vtt: 'vtt',
      json: 'json'
    };
    
    const ext = extensions[exportFormat];
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const versionSuffix = sanitizeVersionName(currentVersion.name);
    const defaultName = `${baseName}_${versionSuffix}.${ext}`;
    
    const savePath = await save({
      defaultPath: defaultName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    });
    
    if (!savePath) return;
    
    try {
      const content = getFormattedContent(currentVersion, exportFormat);
      await writeTextFile(savePath, content);
      toast.success(`Exported to ${savePath.split('/').pop()}`);
    } catch (err) {
      toast.error('Export failed');
    }
  }

  function handleDelete() {
    if (!file || !currentVersion || !onDeleteVersion) return;
    
    onDeleteVersion(file.id, currentVersion.id);
    
    // Adjust index if we're at the end
    if (currentVersionIndex >= versions.length - 1 && currentVersionIndex > 0) {
      currentVersionIndex = currentVersionIndex - 1;
    }
    
    toast.success('Version deleted');
    
    // Close dialog if no more versions
    if (versions.length <= 1) {
      onOpenChange(false);
    }
  }

  function goToPreviousVersion() {
    if (currentVersionIndex > 0) {
      currentVersionIndex--;
    }
  }

  function goToNextVersion() {
    if (currentVersionIndex < versions.length - 1) {
      currentVersionIndex++;
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content class="max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <FileText class="size-5" />
        Transcription Result
      </Dialog.Title>
      <Dialog.Description>
        {file?.name ?? 'Unknown file'}
      </Dialog.Description>
    </Dialog.Header>

    {#if currentVersion}
      <!-- Version navigation -->
      {#if hasMultipleVersions}
        <div class="flex items-center justify-between py-2">
          <Button 
            variant="ghost" 
            size="icon"
            disabled={currentVersionIndex === 0}
            onclick={goToPreviousVersion}
          >
            <ChevronLeft class="size-4" />
          </Button>
          
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium">{currentVersion.name}</span>
            <Badge variant="secondary" class="text-xs">
              {currentVersionIndex + 1} / {versions.length}
            </Badge>
          </div>
          
          <Button 
            variant="ghost" 
            size="icon"
            disabled={currentVersionIndex === versions.length - 1}
            onclick={goToNextVersion}
          >
            <ChevronRight class="size-4" />
          </Button>
        </div>
      {:else}
        <div class="py-2">
          <span class="text-sm font-medium">{currentVersion.name}</span>
        </div>
      {/if}

      <!-- Version metadata -->
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

      <Separator />

      <!-- Format selector -->
      <div class="flex items-center gap-4 py-3">
        <span class="text-sm text-muted-foreground">Format:</span>
        <Select.Root
          type="single"
          value={exportFormat}
          onValueChange={(v) => v && (exportFormat = v as TranscriptionOutputFormat)}
        >
          <Select.Trigger class="w-24">
            <span>{exportFormat.toUpperCase()}</span>
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="srt" label="SRT">SRT</Select.Item>
            <Select.Item value="vtt" label="VTT">VTT</Select.Item>
            <Select.Item value="json" label="JSON">JSON</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>

      <!-- Transcript preview in selected format -->
      <div class="flex-1">
        <ScrollArea class="overflow-scroll h-[calc(50vh-200px)] rounded-md border bg-muted/30">
          <pre class="p-4 text-xs whitespace-pre-wrap leading-relaxed font-mono">{getPreviewContent()}</pre>
        </ScrollArea>
      </div>
    {:else}
      <div class="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p>No transcription available</p>
      </div>
    {/if}

    <Dialog.Footer class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        {#if currentVersion && onDeleteVersion}
          <Button 
            variant="ghost" 
            size="sm" 
            class="text-destructive hover:text-destructive hover:bg-destructive/10"
            onclick={handleDelete}
          >
            <Trash2 class="size-4 mr-2" />
            Delete
          </Button>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <Button 
          variant="outline" 
          size="sm" 
          onclick={handleCopy}
          disabled={!currentVersion}
        >
          {#if copied}
            <Check class="size-4 mr-2" />
            Copied
          {:else}
            <Copy class="size-4 mr-2" />
            Copy
          {/if}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onclick={handleExport}
          disabled={!currentVersion}
        >
          <Download class="size-4 mr-2" />
          Export
        </Button>
        <Button variant="default" size="sm" onclick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
