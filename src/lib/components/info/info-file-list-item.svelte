<script lang="ts">
  import { FileVideo, Loader2, Trash2, XCircle } from '@lucide/svelte';

  import { FileItemCard } from '$lib/components/shared';
  import { Button } from '$lib/components/ui/button';
  import {
    FILE_ITEM_CARD_ACTION_BUTTON_CLASS,
    FILE_ITEM_CARD_ACTION_ICON_CLASS,
    FILE_ITEM_CARD_META_CLASS,
    FILE_ITEM_CARD_REMOVE_ACTION_CLASS,
    FILE_ITEM_CARD_STATUS_ICON_CLASS,
  } from '$lib/utils/file-item-card-visuals';

  import type { FileInfo } from '$lib/stores/info.svelte';

  import { formatFileSize } from './info-utils';

  interface Props {
    file: FileInfo;
    selected: boolean;
    onSelect: () => void;
    onRemove: (fileId: string) => void;
  }

  let { file, selected, onSelect, onRemove }: Props = $props();

  function handleRemoveClick(event: MouseEvent): void {
    event.stopPropagation();
    onRemove(file.id);
  }
</script>

<FileItemCard title={file.name} {selected} onclick={onSelect} selectionLabel={`Select ${file.name}`}>
  {#snippet icon()}
    {#if file.status === 'scanning'}
      <Loader2 class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} animate-spin text-muted-foreground`} />
    {:else if file.status === 'error'}
      <XCircle class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} text-destructive`} />
    {:else}
      <FileVideo class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} text-primary`} />
    {/if}
  {/snippet}

  {#snippet details()}
    {#if file.status === 'ready'}
      <p class={FILE_ITEM_CARD_META_CLASS}>
        {formatFileSize(file.size)} • {file.tracks.length} tracks
      </p>
    {:else if file.status === 'error'}
      <p class="mt-1 truncate text-xs text-destructive">{file.error}</p>
    {:else}
      <p class={FILE_ITEM_CARD_META_CLASS}>Scanning...</p>
    {/if}
  {/snippet}

  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon"
      class={`${FILE_ITEM_CARD_ACTION_BUTTON_CLASS} ${FILE_ITEM_CARD_REMOVE_ACTION_CLASS}`}
      onclick={handleRemoveClick}
    >
      <Trash2 class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
      <span class="sr-only">Remove</span>
    </Button>
  {/snippet}
</FileItemCard>
