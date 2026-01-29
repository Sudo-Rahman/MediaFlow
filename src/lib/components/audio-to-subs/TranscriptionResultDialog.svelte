<script lang="ts">
  import { readTextFile } from '@tauri-apps/plugin-fs';
  import { invoke } from '@tauri-apps/api/core';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { cn } from '$lib/utils';
  import FileText from 'lucide-svelte/icons/file-text';
  import FolderOpen from 'lucide-svelte/icons/folder-open';
  import Copy from 'lucide-svelte/icons/copy';
  import Check from 'lucide-svelte/icons/check';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import { toast } from 'svelte-sonner';

  interface TranscriptionResultDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    outputPath: string | null;
    fileName: string;
  }

  let { 
    open = $bindable(false), 
    onOpenChange,
    outputPath,
    fileName
  }: TranscriptionResultDialogProps = $props();

  let content = $state<string>('');
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let copied = $state(false);

  // Load content when dialog opens
  $effect(() => {
    if (open && outputPath) {
      loadContent(outputPath);
    } else {
      content = '';
      error = null;
    }
  });

  async function loadContent(path: string) {
    isLoading = true;
    error = null;
    try {
      content = await readTextFile(path);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load file';
      content = '';
    } finally {
      isLoading = false;
    }
  }

  async function handleCopy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
      toast.success('Copied to clipboard');
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      toast.error('Failed to copy');
    }
  }

  async function handleOpenFolder() {
    if (!outputPath) return;
    const folder = outputPath.substring(0, outputPath.lastIndexOf('/'));
    try {
      await invoke('open_folder', { path: folder });
    } catch (err) {
      toast.error('Failed to open folder');
    }
  }

  function getOutputFormat(): string {
    if (!outputPath) return 'txt';
    const ext = outputPath.split('.').pop()?.toLowerCase() || 'txt';
    return ext.toUpperCase();
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
        {fileName} - {getOutputFormat()} format
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 my-4">
      {#if isLoading}
        <div class="flex items-center justify-center h-64">
          <Loader2 class="size-8 animate-spin text-muted-foreground" />
        </div>
      {:else if error}
        <div class="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <p class="text-destructive">{error}</p>
        </div>
      {:else if content}
        <ScrollArea class="overflow-scroll h-[calc(60vh-100px)] rounded-md border bg-muted/30">
          <pre class="p-4 text-sm font-mono whitespace-pre-wrap break-words">{content}</pre>
        </ScrollArea>
      {:else}
        <div class="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <p>No content available</p>
        </div>
      {/if}
    </div>

    <Dialog.Footer class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" onclick={handleOpenFolder}>
          <FolderOpen class="size-4 mr-2" />
          Open Folder
        </Button>
      </div>
      <div class="flex items-center gap-2">
        <Button 
          variant="outline" 
          size="sm" 
          onclick={handleCopy}
          disabled={!content}
        >
          {#if copied}
            <Check class="size-4 mr-2" />
            Copied
          {:else}
            <Copy class="size-4 mr-2" />
            Copy
          {/if}
        </Button>
        <Button variant="default" size="sm" onclick={() => onOpenChange(false)}>Close</Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
