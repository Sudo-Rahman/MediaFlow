<script lang="ts">
  import { Download, FolderOpen, Loader2, CheckCircle } from '@lucide/svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { writeTextFile } from '@tauri-apps/plugin-fs';
  import { join } from '@tauri-apps/api/path';
  import type { AudioFile, TranscriptionOutputFormat } from '$lib/types';
  import { formatToSRT, formatToVTT, formatToJSON } from '$lib/services/deepgram';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { Input } from '$lib/components/ui/input';
  import { toast } from 'svelte-sonner';
  ;
  ;
  ;
  ;

  interface ExportAllPanelProps {
    files: AudioFile[];
    class?: string;
  }

  let { files, class: className = '' }: ExportAllPanelProps = $props();

  let exportFormat = $state<TranscriptionOutputFormat>('srt');
  let outputDir = $state('');
  let isExporting = $state(false);

  // Only show files that have completed transcriptions
  const completedFiles = $derived(
    files.filter(f => f.status === 'completed' && f.transcriptionVersions.length > 0)
  );

  const canExport = $derived(completedFiles.length > 0 && outputDir.length > 0 && !isExporting);

  const totalVersions = $derived(
    completedFiles.reduce((sum, f) => sum + f.transcriptionVersions.length, 0)
  );

  async function handleBrowseOutput() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select output folder'
    });
    if (selected && typeof selected === 'string') {
      outputDir = selected;
    }
  }

  function sanitizeVersionName(name: string): string {
    // Remove special characters, keep alphanumeric and spaces, replace spaces with underscores
    return name
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }

  async function handleExportAll() {
    if (!canExport) return;

    isExporting = true;
    let successCount = 0;
    let failCount = 0;

    const extensions: Record<TranscriptionOutputFormat, string> = {
      srt: 'srt',
      vtt: 'vtt',
      json: 'json'
    };
    const ext = extensions[exportFormat];

    try {
      for (const file of completedFiles) {
        const baseName = file.name.replace(/\.[^/.]+$/, '');

        for (const version of file.transcriptionVersions) {
          try {
            // Generate content based on format
            let content: string;
            switch (exportFormat) {
              case 'srt':
                content = formatToSRT(version.result);
                break;
              case 'vtt':
                content = formatToVTT(version.result);
                break;
              case 'json':
                content = JSON.stringify(formatToJSON(version.result), null, 2);
                break;
            }

            // Build filename with version name
            const versionSuffix = sanitizeVersionName(version.name);
            const fileName = `${baseName}_${versionSuffix}.${ext}`;
            const filePath = await join(outputDir, fileName);

            await writeTextFile(filePath, content);
            successCount++;
          } catch (error) {
            console.error(`Failed to export ${file.name} - ${version.name}:`, error);
            failCount++;
          }
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} file(s) exported`);
      }
      if (failCount > 0) {
        toast.error(`${failCount} file(s) failed`);
      }
    } finally {
      isExporting = false;
    }
  }
</script>

<Card.Root class={cn("", className)}>
  <Card.Header class="pb-3">
    <Card.Title class="text-sm flex items-center gap-2">
      <CheckCircle class="size-4 text-green-500" />
      Export All
    </Card.Title>
    <Card.Description class="text-xs">
      {completedFiles.length} file(s), {totalVersions} version(s)
    </Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <!-- Format -->
    <div class="space-y-2">
      <Label class="text-sm">Format</Label>
      <Select.Root
        type="single"
        value={exportFormat}
        onValueChange={(v) => v && (exportFormat = v as TranscriptionOutputFormat)}
        disabled={isExporting}
      >
        <Select.Trigger class="w-full">
          <span>{exportFormat.toUpperCase()}</span>
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="srt" label="SRT">SRT - SubRip</Select.Item>
          <Select.Item value="vtt" label="VTT">VTT - WebVTT</Select.Item>
          <Select.Item value="json" label="JSON">JSON - Structured data</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>

    <!-- Output directory -->
    <div class="space-y-2">
      <Label class="text-sm">Output folder</Label>
      <div class="flex gap-2">
        <Input
          value={outputDir}
          placeholder="Select..."
          readonly
          class="flex-1 text-xs"
        />
        <Button 
          variant="outline" 
          size="icon"
          onclick={handleBrowseOutput}
          disabled={isExporting}
        >
          <FolderOpen class="size-4" />
        </Button>
      </div>
    </div>

    <!-- Export button -->
    <Button
      class="w-full"
      disabled={!canExport}
      onclick={handleExportAll}
    >
      {#if isExporting}
        <Loader2 class="size-4 mr-2 animate-spin" />
        Exporting...
      {:else}
        <Download class="size-4 mr-2" />
        Export ({totalVersions})
      {/if}
    </Button>
  </Card.Content>
</Card.Root>
