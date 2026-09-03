<script lang="ts">
  import { FileVideo } from '@lucide/svelte';

  import * as Empty from '$lib/components/ui/empty';
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
      <p class="text-sm text-muted-foreground">Use the Import menu in the sidebar to get started.</p>
    </Empty.Content>
  </Empty.Root>
</div>
