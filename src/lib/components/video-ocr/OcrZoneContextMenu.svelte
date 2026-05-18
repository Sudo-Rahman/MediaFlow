<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { OcrZoneRole } from '$lib/types';
  import * as ContextMenu from '$lib/components/ui/context-menu';

  interface OcrZoneContextMenuProps {
    segmentId: string;
    zoneId: string;
    children: Snippet;
    role?: OcrZoneRole;
    onEdit?: (segmentId: string, zoneId: string) => void;
    onSetRole?: (segmentId: string, zoneId: string, role: OcrZoneRole) => void;
    onDeleteZone?: (segmentId: string, zoneId: string) => void;
  }

  let {
    segmentId,
    zoneId,
    children,
    role,
    onEdit,
    onSetRole,
    onDeleteZone,
  }: OcrZoneContextMenuProps = $props();
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content class="w-52">
    {#if onEdit}
      <ContextMenu.Item onclick={() => onEdit(segmentId, zoneId)}>
        Modify zone
      </ContextMenu.Item>
    {/if}
    {#if role !== 'main_subtitle'}
      <ContextMenu.Item onclick={() => onSetRole?.(segmentId, zoneId, 'main_subtitle')}>
        Set as Main subtitle
      </ContextMenu.Item>
    {/if}
    {#if role !== 'on_screen_text'}
      <ContextMenu.Item onclick={() => onSetRole?.(segmentId, zoneId, 'on_screen_text')}>
        Set as On-screen text
      </ContextMenu.Item>
    {/if}
    <ContextMenu.Separator />
    <ContextMenu.Item
      variant="destructive"
      onclick={() => onDeleteZone?.(segmentId, zoneId)}
    >
      Delete zone
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
