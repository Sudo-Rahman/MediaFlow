<script lang="ts">
  import { FileVideo, Subtitles, Volume2 } from '@lucide/svelte';

  import type { Track, TranscodeFile } from '$lib/types';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Item from '$lib/components/ui/item';
  import { Textarea } from '$lib/components/ui/textarea';
  import {
    buildReadableProbeSummary,
    getPrimaryVideoTrack,
    getTracksByType,
  } from '$lib/services/transcode';
  import {
    formatBitrate,
    formatChannels,
    formatDuration,
    formatFileSize,
    formatLanguage,
    formatResolution,
  } from '$lib/utils/format';

  interface Props {
    open: boolean;
    file: TranscodeFile | null;
  }

  let {
    open = $bindable(),
    file,
  }: Props = $props();

  function formatFrameRate(value?: string): string {
    if (!value) return 'N/A';
    const parts = value.split('/');
    if (parts.length === 2) {
      const numerator = Number(parts[0]);
      const denominator = Number(parts[1]);
      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
        return `${(numerator / denominator).toFixed(3)} fps`;
      }
    }
    return value;
  }

  function formatSampleRate(value?: number): string {
    if (!value) return 'N/A';
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz`;
  }

  function formatBitDepth(track?: Track | null): string {
    if (!track?.derivedBitDepth) return 'N/A';
    return `${track.derivedBitDepth}-bit`;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
    onOpenAutoFocus={(event) => {
      event.preventDefault();
    }}
  >
    <Dialog.Header>
      <Dialog.Title>{file?.name ?? 'File information'}</Dialog.Title>
      <Dialog.Description>Important stream details detected by FFprobe.</Dialog.Description>
    </Dialog.Header>

    {#if file}
      <div class="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-2">
        <div class="grid min-w-0 gap-4 md:grid-cols-2">
          <Card.Root class="min-w-0">
            <Card.Header class="pb-3">
              <Card.Title>Overview</Card.Title>
            </Card.Header>
            <Card.Content class="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Container</p>
                <p>{file.format ?? 'Unknown'}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Size</p>
                <p>{formatFileSize(file.size)}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Duration</p>
                <p>{formatDuration(file.duration)}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Overall bitrate</p>
                <p>{formatBitrate(file.bitrate)}</p>
              </div>
              <div class="sm:col-span-2">
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Path</p>
                <p class="break-all">{file.path}</p>
              </div>
            </Card.Content>
          </Card.Root>

          <Card.Root class="min-w-0">
            <Card.Header class="pb-3">
              <Card.Title>Track Summary</Card.Title>
            </Card.Header>
            <Card.Content>
              <Item.Group class="gap-2">
                <Item.Root variant="outline" size="sm" role="listitem">
                  <Item.Media class="text-primary">
                    <FileVideo class="size-4" />
                  </Item.Media>
                  <Item.Title>Video</Item.Title>
                  <Item.Actions>
                    <Badge>{getTracksByType(file, 'video').length}</Badge>
                  </Item.Actions>
                </Item.Root>
                <Item.Root variant="outline" size="sm" role="listitem">
                  <Item.Media class="text-emerald-500">
                    <Volume2 class="size-4" />
                  </Item.Media>
                  <Item.Title>Audio</Item.Title>
                  <Item.Actions>
                    <Badge>{getTracksByType(file, 'audio').length}</Badge>
                  </Item.Actions>
                </Item.Root>
                <Item.Root variant="outline" size="sm" role="listitem">
                  <Item.Media class="text-amber-500">
                    <Subtitles class="size-4" />
                  </Item.Media>
                  <Item.Title>Subtitles</Item.Title>
                  <Item.Actions>
                    <Badge>{getTracksByType(file, 'subtitle').length}</Badge>
                  </Item.Actions>
                </Item.Root>
              </Item.Group>
            </Card.Content>
          </Card.Root>
        </div>

        {#if getPrimaryVideoTrack(file)}
          {@const videoTrack = getPrimaryVideoTrack(file)}
          <Card.Root class="min-w-0">
            <Card.Header class="pb-3">
              <Card.Title>Primary Video</Card.Title>
            </Card.Header>
            <Card.Content class="grid gap-3 md:grid-cols-3 text-sm">
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Codec</p>
                <p>{videoTrack?.codec.toUpperCase()}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Profile</p>
                <p>{videoTrack?.profile ?? 'N/A'}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Level</p>
                <p>{videoTrack?.level ?? 'N/A'}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Resolution</p>
                <p>{formatResolution(videoTrack?.width, videoTrack?.height)}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Frame rate</p>
                <p>{formatFrameRate(videoTrack?.frameRate)}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Bitrate</p>
                <p>{formatBitrate(videoTrack?.bitrate)}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Pixel format</p>
                <p>{videoTrack?.pixelFormat ?? 'N/A'}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Bit depth</p>
                <p>{formatBitDepth(videoTrack)}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Aspect ratio</p>
                <p>{videoTrack?.aspectRatio ?? 'N/A'}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Color range</p>
                <p>{videoTrack?.colorRange ?? 'N/A'}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Color space</p>
                <p>{videoTrack?.colorSpace ?? 'N/A'}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-muted-foreground">Transfer / Primaries</p>
                <p>{videoTrack?.colorTransfer ?? 'N/A'} / {videoTrack?.colorPrimaries ?? 'N/A'}</p>
              </div>
            </Card.Content>
          </Card.Root>
        {/if}

        {#if getTracksByType(file, 'audio').length > 0}
          <Card.Root class="min-w-0">
            <Card.Header class="pb-3">
              <Card.Title>Audio Tracks</Card.Title>
            </Card.Header>
            <Card.Content>
              <Item.Group class="gap-2">
                {#each getTracksByType(file, 'audio') as track, index (track.id)}
                  <Item.Root variant="outline" class="items-start" role="listitem">
                    <Item.Content class="min-w-0">
                      <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                          <Item.Title>Track {index + 1} · {track.codec.toUpperCase()}</Item.Title>
                          <Item.Description>
                            {track.title ?? 'Untitled'} {track.language ? `· ${formatLanguage(track.language)}` : ''}
                          </Item.Description>
                        </div>

                        {#if track.default}
                          <Badge variant="outline">default</Badge>
                        {/if}
                      </div>

                      <div class="mt-3 grid gap-3 md:grid-cols-3">
                        <div>
                          <p class="text-xs uppercase tracking-wide text-muted-foreground">Language</p>
                          <p>{formatLanguage(track.language)}</p>
                        </div>
                        <div>
                          <p class="text-xs uppercase tracking-wide text-muted-foreground">Bitrate</p>
                          <p>{formatBitrate(track.bitrate)}</p>
                        </div>
                        <div>
                          <p class="text-xs uppercase tracking-wide text-muted-foreground">Channels</p>
                          <p>{formatChannels(track.channels)}</p>
                        </div>
                        <div>
                          <p class="text-xs uppercase tracking-wide text-muted-foreground">Sample rate</p>
                          <p>{formatSampleRate(track.sampleRate)}</p>
                        </div>
                        <div class="md:col-span-2">
                          <p class="text-xs uppercase tracking-wide text-muted-foreground">Format / Layout</p>
                          <p>{track.sampleFormat ?? 'N/A'} / {track.channelLayout ?? 'N/A'}</p>
                        </div>
                      </div>
                    </Item.Content>
                  </Item.Root>
                {/each}
              </Item.Group>
            </Card.Content>
          </Card.Root>
        {/if}

        {#if getTracksByType(file, 'subtitle').length > 0}
          <Card.Root class="min-w-0">
            <Card.Header class="pb-3">
              <Card.Title>Subtitles</Card.Title>
            </Card.Header>
            <Card.Content>
              <Item.Group class="gap-2">
                {#each getTracksByType(file, 'subtitle') as track (track.id)}
                  <Item.Root variant="outline" size="sm" role="listitem">
                    <Item.Content class="min-w-0">
                      <Item.Title>{track.codec.toUpperCase()}</Item.Title>
                      <Item.Description>
                        {track.title ?? 'Untitled'} {track.language ? `· ${formatLanguage(track.language)}` : ''}
                      </Item.Description>
                    </Item.Content>
                    <Item.Actions>
                      <div class="flex items-center gap-2">
                        {#if track.default}
                          <Badge variant="outline">default</Badge>
                        {/if}
                        {#if track.forced}
                          <Badge variant="outline">forced</Badge>
                        {/if}
                      </div>
                    </Item.Actions>
                  </Item.Root>
                {/each}
              </Item.Group>
            </Card.Content>
          </Card.Root>
        {/if}

        <Card.Root class="min-w-0">
          <Card.Header class="pb-3">
            <Card.Title>Readable FFprobe Summary</Card.Title>
          </Card.Header>
          <Card.Content>
            <Textarea value={buildReadableProbeSummary(file)} readonly class="min-h-40 text-xs font-mono" />
          </Card.Content>
        </Card.Root>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
