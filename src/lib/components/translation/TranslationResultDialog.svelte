<script lang="ts">
  import { Calendar } from '@lucide/svelte';
  import { save } from '@tauri-apps/plugin-dialog';
  import { writeTextFile } from '@tauri-apps/plugin-fs';
  import { toast } from 'svelte-sonner';

  import type { TranslationVersion } from '$lib/types';
  import { Badge } from '$lib/components/ui/badge';
  import { VersionBrowserDialog } from '$lib/components/shared';

  interface TranslationResultDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    fileName: string;
    fileFormat: string;
    versions: TranslationVersion[];
    onDeleteVersion?: (versionId: string) => void;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    fileName,
    fileFormat,
    versions,
    onDeleteVersion,
  }: TranslationResultDialogProps = $props();

  let currentVersionIndex = $state(0);

  const currentVersion = $derived(versions[currentVersionIndex] ?? null);

  // Reset to last version when versions change or dialog opens
  $effect(() => {
    if (open && versions.length > 0) {
      currentVersionIndex = versions.length - 1;
    }
  });

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function getLanguageName(code: string): string {
    const names: Record<string, string> = {
      auto: 'Auto', en: 'English', fr: 'French', es: 'Spanish', de: 'German',
      it: 'Italian', pt: 'Portuguese', ru: 'Russian', ja: 'Japanese',
      ko: 'Korean', zh: 'Chinese', 'zh-TW': 'Chinese (Traditional)',
      ar: 'Arabic', hi: 'Hindi', nl: 'Dutch', pl: 'Polish', tr: 'Turkish',
      vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', sv: 'Swedish',
      da: 'Danish', no: 'Norwegian', fi: 'Finnish', cs: 'Czech',
      ro: 'Romanian', hu: 'Hungarian', el: 'Greek', he: 'Hebrew', uk: 'Ukrainian',
    };
    return names[code] ?? code.toUpperCase();
  }

  function sanitizeVersionName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  }

  const previewContent = $derived(currentVersion?.translatedContent ?? '');

  async function handleExport(): Promise<void> {
    if (!currentVersion) return;
    try {
      const baseName = fileName.replace(/\.[^/.]+$/, '');
      const versionSuffix = sanitizeVersionName(currentVersion.name);
      const ext = fileFormat;
      const defaultFileName = `${baseName}_${versionSuffix}.${ext}`;

      const savePath = await save({
        defaultPath: defaultFileName,
        filters: [{ name: 'Subtitle files', extensions: [ext] }],
      });

      if (savePath) {
        await writeTextFile(savePath, currentVersion.translatedContent);
        toast.success('File saved successfully');
      }
    } catch {
      toast.error('Failed to save file');
    }
  }

  function handleDeleteVersion(versionId: string): void {
    if (!onDeleteVersion) return;
    onDeleteVersion(versionId);
  }
</script>

<VersionBrowserDialog
  bind:open
  {onOpenChange}
  title="Translation Results"
  description={fileName}
  {versions}
  currentIndex={currentVersionIndex}
  onIndexChange={(i) => { currentVersionIndex = i; }}
  {previewContent}
  onExport={handleExport}
  onDelete={onDeleteVersion ? handleDeleteVersion : undefined}
>
  {#snippet metadata()}
    {#if currentVersion}
      <div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pb-2">
        <span class="flex items-center gap-1">
          <Calendar class="size-3" />
          {formatDate(currentVersion.createdAt)}
        </span>
        <Badge variant="outline" class="text-[10px]">
          {currentVersion.model}
        </Badge>
        <Badge variant="outline" class="text-[10px]">
          {getLanguageName(currentVersion.sourceLanguage)} &rarr; {getLanguageName(currentVersion.targetLanguage)}
        </Badge>
        {#if currentVersion.batchCount > 1}
          <Badge variant="outline" class="text-[10px]">
            {currentVersion.batchCount} batches
          </Badge>
        {/if}
        {#if currentVersion.usage}
          <Badge variant="outline" class="text-[10px]">
            {currentVersion.usage.totalTokens.toLocaleString()} tokens
          </Badge>
        {/if}
        {#if currentVersion.truncated}
          <Badge variant="destructive" class="text-[10px]">Truncated</Badge>
        {/if}
      </div>
    {/if}
  {/snippet}
</VersionBrowserDialog>
