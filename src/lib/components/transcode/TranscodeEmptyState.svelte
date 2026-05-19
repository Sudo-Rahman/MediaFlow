<script lang="ts">
  import { FileVideo } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Empty from '$lib/components/ui/empty';

  interface Props {
    onAddFiles?: () => void | Promise<void>;
  }

  let { onAddFiles }: Props = $props();
</script>

<div class="flex-1 p-6">
  <Empty.Root class="h-full border">
    <Empty.Header>
      <Empty.Media variant="icon">
        <FileVideo />
      </Empty.Media>
      <Empty.Title>Transcode media files</Empty.Title>
      <Empty.Description>
        Import video or audio-only files to configure AI-assisted or advanced FFmpeg transcoding.
      </Empty.Description>
    </Empty.Header>
    <Empty.Content>
      <Button onclick={onAddFiles}>
        <FileVideo class="size-4 mr-2" />
        Add Files
      </Button>
    </Empty.Content>
  </Empty.Root>
</div>
