<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { OcrZoneRole } from '$lib/types';
  import * as ContextMenu from '$lib/components/ui/context-menu';

  interface OcrZoneContextMenuProps {
    segmentId: string;
    zoneId: string;
    children: Snippet;
    role?: OcrZoneRole;
    onSetRole?: (segmentId: string, zoneId: string, role: OcrZoneRole) => void;
    onDeleteZone?: (segmentId: string, zoneId: string) => void;
  }

  let {
    segmentId,
    zoneId,
    children,
    role,
    onSetRole,
    onDeleteZone,
  }: OcrZoneContextMenuProps = $props();
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content class="w-52">
    <ContextMenu.Item
      disabled={role === 'main_subtitle'}
      onclick={() => onSetRole?.(segmentId, zoneId, 'main_subtitle')}
    >
      Set as Main subtitle
    </ContextMenu.Item>
    <ContextMenu.Item
      disabled={role === 'on_screen_text'}
      onclick={() => onSetRole?.(segmentId, zoneId, 'on_screen_text')}
    >
      Set as On-screen text
    </ContextMenu.Item>
    <ContextMenu.Separator />
    <ContextMenu.Item
      variant="destructive"
      onclick={() => onDeleteZone?.(segmentId, zoneId)}
    >
      Delete zone
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
