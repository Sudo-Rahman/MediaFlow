<script lang="ts">
  import { Film } from '@lucide/svelte';
  import * as Empty from '$lib/components/ui/empty';
</script>

<div class="flex-1 flex items-center justify-center">
  <Empty.Root class="border-0">
    <Empty.Header>
      <Empty.Media class="opacity-30">
        <Film class="size-16 text-muted-foreground" />
      </Empty.Media>
      <Empty.Title class="text-lg text-muted-foreground">No file selected</Empty.Title>
      <Empty.Description>Select a file from the list or add new files</Empty.Description>
    </Empty.Header>
  </Empty.Root>
</div>
