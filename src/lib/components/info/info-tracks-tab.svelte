<script lang="ts">
  import * as Empty from '$lib/components/ui/empty';
  import * as Item from '$lib/components/ui/item';
  import { Badge } from '$lib/components/ui/badge';

  import type { Track } from '$lib/types';

  import { formatBitrate, formatFileSize, getTrackIcon, getTrackTypeColor } from './info-utils';

  interface Props {
    tracks: Track[];
  }

  let { tracks }: Props = $props();
</script>

<div class="p-4 space-y-2">
  {#each tracks as track (track.id)}
    {@const Icon = getTrackIcon(track.type)}
    <Item.Root variant="outline" size="sm" class="items-start">
      <Item.Media variant="image" class="bg-muted">
        <Icon class={`size-4 ${getTrackTypeColor(track.type)}`} />
      </Item.Media>
      <Item.Content>
        <div class="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" class="font-mono">#{track.index}</Badge>
          <span class="font-semibold capitalize">{track.type}</span>
          <span class="font-medium">{track.codec.toUpperCase()}</span>
          {#if track.language}
            <Badge variant="secondary">{track.language}</Badge>
          {/if}
          {#if track.default}
            <Badge>Default</Badge>
          {/if}
          {#if track.forced}
            <Badge variant="destructive">Forced</Badge>
          {/if}
        </div>

        {#if track.title}
          <p class="text-sm text-muted-foreground mt-1">"{track.title}"</p>
        {/if}

        <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
          {#if track.codecLong}
            <span>Codec: {track.codecLong}</span>
          {/if}
          {#if track.bitrate}
            <span>Bitrate: {formatBitrate(track.bitrate)}</span>
          {/if}
          {#if track.size}
            <span>Size: {formatFileSize(track.size)}</span>
          {/if}

          {#if track.type === 'video'}
            {#if track.width && track.height}
              <span>Resolution: {track.width}×{track.height}</span>
            {/if}
            {#if track.frameRate}
              <span>FPS: {track.frameRate}</span>
            {/if}
            {#if track.pixelFormat}
              <span>Format: {track.pixelFormat}</span>
            {/if}
            {#if track.colorRange}
              <span>Range: {track.colorRange}</span>
            {/if}
            {#if track.aspectRatio}
              <span>AR: {track.aspectRatio}</span>
            {/if}
          {/if}

          {#if track.type === 'audio'}
            {#if track.channels}
              <span>Channels: {track.channels}</span>
            {/if}
            {#if track.sampleRate}
              <span>Sample Rate: {track.sampleRate} Hz</span>
            {/if}
          {/if}

          {#if track.numberOfFrames}
            <span>Frames: {track.numberOfFrames}</span>
          {/if}
        </div>
      </Item.Content>
    </Item.Root>
  {:else}
    <Empty.Root class="border-0 py-8">
      <Empty.Description>No tracks found</Empty.Description>
    </Empty.Root>
  {/each}
</div>
