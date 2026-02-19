<script lang="ts">
  import { ChevronLeft, ChevronRight, Copy, Download, Check, Trash2, Loader2 } from '@lucide/svelte';
  import type { Snippet } from 'svelte';

  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { Badge } from '$lib/components/ui/badge';
  import * as Select from '$lib/components/ui/select';
  import { Separator } from '$lib/components/ui/separator';

  import { toast } from 'svelte-sonner';

  interface VersionInfo {
    id: string;
    name: string;
    createdAt: string;
  }

  interface VersionBrowserDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title?: string;
    description?: string;

    versions: VersionInfo[];
    currentIndex: number;
    onIndexChange: (index: number) => void;
    isLoading?: boolean;

    formats?: string[];
    selectedFormat?: string;
    onFormatChange?: (format: string) => void;

    previewContent: string;
    isPreviewLoading?: boolean;

    onCopy?: () => void;
    onExport?: () => void;
    onDelete?: (versionId: string) => void;

    metadata?: Snippet;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    title = 'Results',
    description = '',
    versions,
    currentIndex,
    onIndexChange,
    isLoading = false,
    formats,
    selectedFormat,
    onFormatChange,
    previewContent,
    isPreviewLoading = false,
    onCopy,
    onExport,
    onDelete,
    metadata,
  }: VersionBrowserDialogProps = $props();

  let copied = $state(false);

  const currentVersion = $derived(versions[currentIndex] ?? null);
  const hasMultipleVersions = $derived(versions.length > 1);
  const showFormatSelector = $derived(formats && formats.length > 0 && selectedFormat && onFormatChange);

  function goToPreviousVersion(): void {
    if (currentIndex > 0) {
      onIndexChange(currentIndex - 1);
    }
  }

  function goToNextVersion(): void {
    if (currentIndex < versions.length - 1) {
      onIndexChange(currentIndex + 1);
    }
  }

  async function handleCopy(): Promise<void> {
    if (onCopy) {
      onCopy();
      return;
    }

    if (!previewContent) return;
    try {
      await navigator.clipboard.writeText(previewContent);
      copied = true;
      toast.success('Copied to clipboard');
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      toast.error('Copy failed');
    }
  }

  function handleDelete(): void {
    if (!currentVersion || !onDelete) return;
    const versionId = currentVersion.id;
    const versionName = currentVersion.name;

    onDelete(versionId);

    // Adjust index after deletion
    if (versions.length <= 1) {
      onOpenChange(false);
    } else if (currentIndex >= versions.length - 1) {
      onIndexChange(Math.max(0, versions.length - 2));
    }

    toast.success(`Deleted: ${versionName}`);
  }
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content class="max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>
        {description}
      </Dialog.Description>
    </Dialog.Header>

    {#if isLoading}
      <div class="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
        <Loader2 class="size-5 animate-spin" />
        <p class="text-sm">Loading versions...</p>
      </div>
    {:else if currentVersion}
      <!-- Version navigation -->
      {#if hasMultipleVersions}
        <div class="flex items-center justify-between py-2">
          <Button
            variant="ghost"
            size="icon"
            disabled={currentIndex === 0}
            onclick={goToPreviousVersion}
          >
            <ChevronLeft class="size-4" />
          </Button>

          <div class="flex items-center gap-2">
            <span class="text-sm font-medium">{currentVersion.name}</span>
            <Badge variant="secondary" class="text-xs">
              {currentIndex + 1} / {versions.length}
            </Badge>
          </div>

          <Button
            variant="ghost"
            size="icon"
            disabled={currentIndex === versions.length - 1}
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

      <!-- Tool-specific metadata -->
      {#if metadata}
        {@render metadata()}
      {/if}

      <Separator />

      <!-- Format selector (only shown when formats are provided) -->
      {#if showFormatSelector}
        <div class="flex items-center gap-4 py-3">
          <span class="text-sm text-muted-foreground">Format:</span>
          <Select.Root
            type="single"
            value={selectedFormat}
            onValueChange={(v) => v && onFormatChange?.(v)}
          >
            <Select.Trigger class="w-36">
              <span>{selectedFormat?.toUpperCase()}</span>
            </Select.Trigger>
            <Select.Content>
              {#each formats ?? [] as fmt (fmt)}
                <Select.Item value={fmt} label={fmt.toUpperCase()}>{fmt.toUpperCase()}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}

      <!-- Preview -->
      <div class="flex-1">
        <ScrollArea orientation="both" class="h-[calc(50vh-200px)] rounded-md border bg-muted/30">
          {#if isPreviewLoading}
            <p class="p-6 text-sm text-muted-foreground text-center">Preparing preview...</p>
          {:else if previewContent}
            <div class="min-w-max">
              <pre class="p-4 text-xs whitespace-pre-wrap leading-relaxed font-mono">{previewContent}</pre>
            </div>
          {:else}
            <p class="p-6 text-sm text-muted-foreground text-center">No content in this version</p>
          {/if}
        </ScrollArea>
      </div>
    {:else}
      <div class="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p>No versions available</p>
      </div>
    {/if}

    <Dialog.Footer class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        {#if currentVersion && onDelete}
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
          disabled={!currentVersion || !previewContent || isPreviewLoading || isLoading}
        >
          {#if copied}
            <Check class="size-4 mr-2" />
            Copied
          {:else}
            <Copy class="size-4 mr-2" />
            Copy
          {/if}
        </Button>
        {#if onExport}
          <Button
            variant="outline"
            size="sm"
            onclick={onExport}
            disabled={!currentVersion || isLoading}
          >
            <Download class="size-4 mr-2" />
            Export
          </Button>
        {/if}
        <Button variant="default" size="sm" onclick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
