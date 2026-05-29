<script lang="ts">
  import {
    AlertCircle,
    CheckCircle,
    FileText,
    Loader2,
    MoreVertical,
    RotateCw,
    ScanText,
    Trash2,
    Upload,
  } from '@lucide/svelte';

  import type { SubtitleOcrSourceItem, SubtitleOcrStatus } from '$lib/types';
  import { buildSubtitleOcrSourceLabel } from '$lib/types';
  import { OCR_LANGUAGES } from '$lib/types/video-ocr';
  import { FileItemCard } from '$lib/components/shared';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import { Progress } from '$lib/components/ui/progress';
  import {
    FILE_ITEM_CARD_ACTION_BUTTON_CLASS,
    FILE_ITEM_CARD_ACTION_ICON_CLASS,
    FILE_ITEM_CARD_META_CLASS,
    FILE_ITEM_CARD_PRIMARY_ACTION_CLASS,
    FILE_ITEM_CARD_REMOVE_ACTION_CLASS,
    FILE_ITEM_CARD_RETRY_ACTION_CLASS,
    FILE_ITEM_CARD_STATUS_ICON_CLASS,
  } from '$lib/utils/file-item-card-visuals';

  interface SubtitleOcrSidebarProps {
    items: SubtitleOcrSourceItem[];
    selectedItemId: string | null;
    isProcessing: boolean;
    onImport: () => void | Promise<void>;
    onSelectItem: (itemId: string) => void;
    onOpenVersions: (itemId: string) => void;
    onRetry: (itemId: string) => void;
    onRetryAiCleanupOnly: (itemId: string) => void;
    onRemove: (itemId: string) => void;
  }

  let {
    items,
    selectedItemId,
    isProcessing,
    onImport,
    onSelectItem,
    onOpenVersions,
    onRetry,
    onRetryAiCleanupOnly,
    onRemove,
  }: SubtitleOcrSidebarProps = $props();

  const SUPPORTED_FORMATS = 'MKV, M2TS, VOB, SUP, IDX/SUB';
  const PROCESSING_STATUSES = new Set<SubtitleOcrStatus>([
    'scanning',
    'extracting',
    'decoding',
    'ocr_processing',
    'ai_cleaning',
  ]);

  function isItemProcessing(status: SubtitleOcrStatus): boolean {
    return PROCESSING_STATUSES.has(status);
  }

  function getStatusLabel(status: SubtitleOcrStatus): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'scanning':
        return 'Scanning';
      case 'ready':
        return 'Ready';
      case 'extracting':
        return 'Extracting';
      case 'decoding':
        return 'Decoding';
      case 'ocr_processing':
        return 'OCR';
      case 'ai_cleaning':
        return 'AI cleanup';
      case 'completed':
        return 'Completed';
      case 'error':
        return 'Error';
    }
  }

  function getStatusBadgeVariant(status: SubtitleOcrStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (status === 'completed') return 'default';
    if (status === 'error') return 'destructive';
    if (isItemProcessing(status)) return 'secondary';
    return 'outline';
  }

  function getProgressLabel(item: SubtitleOcrSourceItem): string {
    if (item.progress?.message) {
      return item.progress.message;
    }

    switch (item.progress?.phase) {
      case 'extracting':
        return 'Extracting subtitle track...';
      case 'decoding':
        return 'Decoding subtitle bitmaps...';
      case 'ocr':
        return 'Running OCR...';
      case 'ai_cleaning':
        return 'Cleaning subtitles with AI...';
      default:
        return 'Processing...';
    }
  }

  function getProgressPercentage(item: SubtitleOcrSourceItem): number {
    return Math.max(0, Math.min(100, Math.round(item.progress?.percentage ?? 0)));
  }

  function getModelOverrideLabel(item: SubtitleOcrSourceItem): string {
    if (item.ocrModelOverride === 'default') {
      return 'Default';
    }

    return OCR_LANGUAGES.find((language) => language.value === item.ocrModelOverride)?.label
      ?? item.ocrModelOverride;
  }
</script>

<div class="w-[max(20rem,25vw)] max-w-lg border-r flex flex-col overflow-hidden">
  <div class="p-3 border-b shrink-0 flex items-center justify-between">
    <h2 class="font-semibold">Subtitle Sources ({items.length})</h2>
    <Button size="sm" onclick={() => void onImport()} disabled={isProcessing}>
      <Upload class="size-4" />
      Import
    </Button>
  </div>

  <div class="flex-1 min-h-0 overflow-auto p-2">
    {#if items.length === 0}
      <ImportDropZone
        icon={ScanText}
        title="Drop subtitle sources here"
        formats={SUPPORTED_FORMATS}
        onBrowse={() => void onImport()}
        disabled={isProcessing}
      />
    {:else}
      <div class="space-y-2">
        {#each items as item (item.id)}
          {@const isSelected = item.id === selectedItemId}
          {@const processing = isItemProcessing(item.status)}
          {@const versionCount = item.versions.length}
          {@const hasActiveVersion = versionCount > 0 && item.activeVersionId !== null}
          <FileItemCard
            title={item.displayName}
            selected={isSelected}
            onclick={() => onSelectItem(item.id)}
            selectionLabel={`Select ${item.displayName}`}
          >
            {#snippet icon()}
              {#if item.status === 'completed'}
                <CheckCircle class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} text-green-500`} />
              {:else if processing}
                <Loader2 class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} animate-spin text-primary`} />
              {:else if item.status === 'error'}
                <AlertCircle class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} text-destructive`} />
              {:else}
                <ScanText class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} text-muted-foreground`} />
              {/if}
            {/snippet}

            {#snippet meta()}
              <div class={FILE_ITEM_CARD_META_CLASS}>
                <Badge variant={getStatusBadgeVariant(item.status)} class="text-[10px] px-1.5 py-0">
                  {getStatusLabel(item.status)}
                </Badge>
                <Badge variant="secondary" class="text-[10px] px-1.5 py-0">
                  {versionCount} version{versionCount === 1 ? '' : 's'}
                </Badge>
                {#if item.ocrModelOverride !== 'default'}
                  <Badge variant="outline" class="text-[10px] px-1.5 py-0">
                    OCR {getModelOverrideLabel(item)}
                  </Badge>
                {/if}
              </div>
            {/snippet}

            {#snippet details()}
              <p class="mt-1 truncate text-xs text-muted-foreground" title={buildSubtitleOcrSourceLabel(item)}>
                {buildSubtitleOcrSourceLabel(item)}
              </p>

              {#if item.progress}
                <div class="mt-2">
                  <Progress value={getProgressPercentage(item)} class="h-1.5" />
                  <p class="mt-1 text-xs text-muted-foreground">
                    {getProgressLabel(item)} {getProgressPercentage(item)}%
                  </p>
                </div>
              {/if}

              {#if item.error}
                <p class="mt-1 truncate text-xs text-destructive" title={item.error}>
                  {item.error}
                </p>
              {/if}
            {/snippet}

            {#snippet actions()}
              <div class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  class={`${FILE_ITEM_CARD_ACTION_BUTTON_CLASS} ${FILE_ITEM_CARD_PRIMARY_ACTION_CLASS}`}
                  onclick={(event: MouseEvent) => {
                    event.stopPropagation();
                    onOpenVersions(item.id);
                  }}
                  disabled={versionCount === 0}
                  title="Versions"
                  aria-label={`Open versions for ${item.displayName}`}
                >
                  <FileText class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
                </Button>

                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon"
                        class={`${FILE_ITEM_CARD_ACTION_BUTTON_CLASS} ${FILE_ITEM_CARD_RETRY_ACTION_CLASS}`}
                        disabled={isProcessing}
                        title="Retry"
                        aria-label={`Retry ${item.displayName}`}
                      >
                        <MoreVertical class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" class="w-44">
                    <DropdownMenu.Item onclick={() => onRetry(item.id)} disabled={isProcessing}>
                      <RotateCw class="mr-2 size-4" />
                      Full OCR
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onclick={() => onRetryAiCleanupOnly(item.id)}
                      disabled={isProcessing || !hasActiveVersion}
                    >
                      <ScanText class="mr-2 size-4" />
                      AI cleanup only
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>

                <Button
                  variant="ghost"
                  size="icon"
                  class={`${FILE_ITEM_CARD_ACTION_BUTTON_CLASS} ${FILE_ITEM_CARD_REMOVE_ACTION_CLASS}`}
                  onclick={(event: MouseEvent) => {
                    event.stopPropagation();
                    onRemove(item.id);
                  }}
                  disabled={isProcessing}
                  title="Remove"
                  aria-label={`Remove ${item.displayName}`}
                >
                  <Trash2 class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
                </Button>
              </div>
            {/snippet}
          </FileItemCard>
        {/each}
      </div>
    {/if}
  </div>
</div>
