<script lang="ts">
  import { Download } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';

  interface HeaderUpdateButtonProps {
    version: string;
    compact?: boolean;
    onOpen: () => void;
  }

  let {
    version,
    compact = false,
    onOpen,
  }: HeaderUpdateButtonProps = $props();

  const label = $derived(`Update available: v${version}`);
</script>

<Button
  variant="outline"
  size={compact ? 'icon-xs' : 'sm'}
  onclick={onOpen}
  title={label}
  aria-label={label}
  class={compact ? 'relative size-7' : 'relative h-7 gap-1.5 px-2.5 text-xs'}
>
  {#if compact}
    <Download class="size-3.5" />
  {:else}
    Update
    <Badge class="h-4 px-1.5 text-[10px] leading-none">
      v{version}
    </Badge>
  {/if}
</Button>
