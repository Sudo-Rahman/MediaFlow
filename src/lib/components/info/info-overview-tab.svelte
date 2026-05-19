<script lang="ts">
  import { Film, Layers, Subtitles, Video, Volume2 } from '@lucide/svelte';

  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import * as Item from '$lib/components/ui/item';

  import type { FileInfo } from '$lib/stores/info.svelte';

  import type { InfoTrackGroups } from './info-utils';
  import { formatBitrate, formatDuration, formatFileSize } from './info-utils';

  interface Props {
    file: FileInfo;
    trackGroups: InfoTrackGroups;
  }

  let { file, trackGroups }: Props = $props();
</script>

<div class="p-4 space-y-4">
  <Card.Root>
    <Card.Header class="pb-2">
      <Card.Title class="text-sm flex items-center gap-2">
        <Film class="size-4" />
        General Information
      </Card.Title>
    </Card.Header>
    <Card.Content class="space-y-3">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-xs text-muted-foreground">Format</p>
          <p class="text-sm font-medium">{file.format || 'Unknown'}</p>
        </div>
        <div>
          <p class="text-xs text-muted-foreground">Size</p>
          <p class="text-sm font-medium">{formatFileSize(file.size)}</p>
        </div>
        {#if file.duration}
          <div>
            <p class="text-xs text-muted-foreground">Duration</p>
            <p class="text-sm font-medium">{formatDuration(file.duration)}</p>
          </div>
        {/if}
        {#if file.bitrate}
          <div>
            <p class="text-xs text-muted-foreground">Overall Bitrate</p>
            <p class="text-sm font-medium">{formatBitrate(file.bitrate)}</p>
          </div>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header class="pb-2">
      <Card.Title class="text-sm flex items-center gap-2">
        <Layers class="size-4" />
        Track Summary
      </Card.Title>
    </Card.Header>
    <Card.Content>
      <div class="flex gap-4">
        {#if trackGroups.video.length > 0}
          <div class="flex items-center gap-2">
            <Video class="size-4 text-blue-500" />
            <span class="text-sm">{trackGroups.video.length} Video</span>
          </div>
        {/if}
        {#if trackGroups.audio.length > 0}
          <div class="flex items-center gap-2">
            <Volume2 class="size-4 text-green-500" />
            <span class="text-sm">{trackGroups.audio.length} Audio</span>
          </div>
        {/if}
        {#if trackGroups.subtitle.length > 0}
          <div class="flex items-center gap-2">
            <Subtitles class="size-4 text-yellow-500" />
            <span class="text-sm">{trackGroups.subtitle.length} Subtitle</span>
          </div>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>

  {#if trackGroups.video.length > 0}
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm flex items-center gap-2">
          <Video class="size-4 text-blue-500" />
          Video
        </Card.Title>
      </Card.Header>
      <Card.Content class="space-y-3">
        {#each trackGroups.video as track (track.id)}
          <Item.Root variant="muted" size="sm" class="items-start">
            <Item.Content class="gap-2">
              <div class="flex items-center gap-2">
                <Badge variant="outline" class="font-mono">#{track.index}</Badge>
                <span class="font-medium">{track.codec.toUpperCase()}</span>
                {#if track.codecLong}
                  <span class="text-xs text-muted-foreground">({track.codecLong})</span>
                {/if}
              </div>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                {#if track.width && track.height}
                  <div>
                    <p class="text-xs text-muted-foreground">Resolution</p>
                    <p>{track.width}×{track.height}</p>
                  </div>
                {/if}
                {#if track.frameRate}
                  <div>
                    <p class="text-xs text-muted-foreground">Frame Rate</p>
                    <p>{track.frameRate} fps</p>
                  </div>
                {/if}
                {#if track.bitrate}
                  <div>
                    <p class="text-xs text-muted-foreground">Bitrate</p>
                    <p>{formatBitrate(track.bitrate)}</p>
                  </div>
                {/if}
                {#if track.size}
                  <div>
                    <p class="text-xs text-muted-foreground">Size</p>
                    <p>{formatFileSize(track.size)}</p>
                  </div>
                {/if}
                {#if track.pixelFormat}
                  <div>
                    <p class="text-xs text-muted-foreground">Pixel Format</p>
                    <p>{track.pixelFormat}</p>
                  </div>
                {/if}
                {#if track.colorRange}
                  <div>
                    <p class="text-xs text-muted-foreground">Color Range</p>
                    <p>{track.colorRange}</p>
                  </div>
                {/if}
              </div>
            </Item.Content>
          </Item.Root>
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if trackGroups.audio.length > 0}
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm flex items-center gap-2">
          <Volume2 class="size-4 text-green-500" />
          Audio ({trackGroups.audio.length})
        </Card.Title>
      </Card.Header>
      <Card.Content class="space-y-2">
        {#each trackGroups.audio as track (track.id)}
          <Item.Root variant="muted" size="sm" class="items-start">
            <Item.Content>
              <div class="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" class="font-mono">#{track.index}</Badge>
                <span class="font-medium">{track.codec.toUpperCase()}</span>
                {#if track.language}
                  <Badge variant="secondary">{track.language}</Badge>
                {/if}
                {#if track.title}
                  <span class="text-sm text-muted-foreground">"{track.title}"</span>
                {/if}
                {#if track.default}
                  <Badge>Default</Badge>
                {/if}
              </div>

              <div class="flex gap-4 mt-2 text-sm text-muted-foreground">
                {#if track.channels}
                  <span>{track.channels} channels</span>
                {/if}
                {#if track.sampleRate}
                  <span>{track.sampleRate} Hz</span>
                {/if}
                {#if track.bitrate}
                  <span>{formatBitrate(track.bitrate)}</span>
                {/if}
                {#if track.size}
                  <span>{formatFileSize(track.size)}</span>
                {/if}
              </div>
            </Item.Content>
          </Item.Root>
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if trackGroups.subtitle.length > 0}
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm flex items-center gap-2">
          <Subtitles class="size-4 text-yellow-500" />
          Subtitles ({trackGroups.subtitle.length})
        </Card.Title>
      </Card.Header>
      <Card.Content class="space-y-2">
        {#each trackGroups.subtitle as track (track.id)}
          <Item.Root variant="muted" size="sm" class="items-start">
            <Item.Content>
              <div class="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" class="font-mono">#{track.index}</Badge>
                <span class="font-medium">{track.codec.toUpperCase()}</span>
                {#if track.language}
                  <Badge variant="secondary">{track.language}</Badge>
                {/if}
                {#if track.title}
                  <span class="text-sm text-muted-foreground">"{track.title}"</span>
                {/if}
                {#if track.default}
                  <Badge>Default</Badge>
                {/if}
                {#if track.forced}
                  <Badge variant="destructive">Forced</Badge>
                {/if}
              </div>

              <div class="flex gap-4 mt-2 text-sm text-muted-foreground">
                {#if track.bitrate}
                  <span>{formatBitrate(track.bitrate)}</span>
                {/if}
                {#if track.size}
                  <span>{formatFileSize(track.size)}</span>
                {/if}
                {#if track.numberOfFrames}
                  <span>{track.numberOfFrames} frames</span>
                {/if}
              </div>
            </Item.Content>
          </Item.Root>
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
