<script lang="ts">
  import type { Track, TranscodeFile, TranscodeSubtitleEncoderCapability, TranscodeSubtitleMode } from '$lib/types';
  import type { TranscodeModeOption } from '$lib/services/transcode';
  import { formatLanguage } from '$lib/utils/format';
  import * as Card from '$lib/components/ui/card';
  import * as Empty from '$lib/components/ui/empty';
  import * as Item from '$lib/components/ui/item';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';

  import TranscodeAdditionalOverrides from './TranscodeAdditionalOverrides.svelte';
  import type { TranscodeProfileUpdater } from './types';

  interface Props {
    file: TranscodeFile;
    selectedSubtitleTracks: Track[];
    selectedSubtitleEncoder: TranscodeSubtitleEncoderCapability | null;
    availableSubtitleModeOptions: TranscodeModeOption<TranscodeSubtitleMode>[];
    availableSubtitleEncoders: TranscodeSubtitleEncoderCapability[];
    updateProfile: TranscodeProfileUpdater;
    createId: (prefix: string) => string;
  }

  let {
    file,
    selectedSubtitleTracks,
    selectedSubtitleEncoder,
    availableSubtitleModeOptions,
    availableSubtitleEncoders,
    updateProfile,
    createId,
  }: Props = $props();

  const controlId = $props.id();
  const subtitleModeId = `${controlId}-subtitle-mode`;
  const subtitleEncoderId = `${controlId}-subtitle-encoder`;
</script>

{#if selectedSubtitleTracks.length === 0}
  <Empty.Root class="border p-4">
    <Empty.Description>No subtitle tracks were detected in this file.</Empty.Description>
  </Empty.Root>
{:else}
  <div class="grid gap-4 lg:grid-cols-2">
    <div class="space-y-4">
      <div class="space-y-2">
        <Label for={subtitleModeId}>Subtitle mode</Label>
        <Select.Root
          type="single"
          value={file.profile.subtitles.mode}
          onValueChange={(value) => {
            updateProfile((profile) => {
              profile.subtitles.mode = value as TranscodeSubtitleMode;
            });
          }}
        >
          <Select.Trigger id={subtitleModeId} class="w-full">{file.profile.subtitles.mode}</Select.Trigger>
          <Select.Content>
            <Select.Group>
              {#each availableSubtitleModeOptions as option (option.value)}
                <Select.Item value={option.value}>{option.label}</Select.Item>
              {/each}
            </Select.Group>
          </Select.Content>
        </Select.Root>
      </div>

      {#if file.profile.subtitles.mode === 'convert_text'}
        <div class="space-y-2">
          <Label for={subtitleEncoderId}>Subtitle encoder</Label>
          <Select.Root
            type="single"
            value={file.profile.subtitles.encoderId}
            onValueChange={(value) => {
              updateProfile((profile) => {
                profile.subtitles.encoderId = value;
              });
            }}
          >
            <Select.Trigger id={subtitleEncoderId} class="w-full">{selectedSubtitleEncoder?.label ?? 'Select encoder'}</Select.Trigger>
            <Select.Content>
              <Select.Group>
                {#each availableSubtitleEncoders as encoder (encoder.id)}
                  <Select.Item value={encoder.id}>{encoder.label}</Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
        </div>
      {:else}
        <Item.Root variant="outline" size="sm">
          <Item.Description>
            {file.profile.subtitles.mode === 'copy'
              ? 'Subtitle tracks will be copied without conversion.'
              : 'Subtitles are disabled for this output.'}
          </Item.Description>
        </Item.Root>
      {/if}
    </div>

    <Card.Root class="max-h-48 min-h-0 overflow-hidden">
      <Card.Header class="shrink-0 pb-3">
        <Card.Title>Detected subtitle tracks</Card.Title>
      </Card.Header>
      <Card.Content class="min-h-0 flex-1 overflow-y-auto">
        <Item.Group class="gap-2">
          {#each selectedSubtitleTracks as track (track.id)}
            <Item.Root variant="outline" size="sm" role="listitem">
              <Item.Content>
                <Item.Title>{track.codec.toUpperCase()} {track.language ? `· ${formatLanguage(track.language)}` : ''}</Item.Title>
                <Item.Description>
                  {track.title ?? 'Untitled'} {track.default ? '· default' : ''} {track.forced ? '· forced' : ''}
                </Item.Description>
              </Item.Content>
            </Item.Root>
          {/each}
        </Item.Group>
      </Card.Content>
    </Card.Root>
  </div>
{/if}

{#if selectedSubtitleTracks.length > 0 && file.profile.subtitles.mode === 'convert_text'}
  <TranscodeAdditionalOverrides
    tab="subtitles"
    title="Additional Overrides"
    description="Optional safe FFmpeg flags for subtitle handling."
    emptyMessage="No subtitle overrides added."
    encoderOptions={selectedSubtitleEncoder?.options ?? []}
    args={file.profile.subtitles.additionalArgs}
    createId={createId}
    updateProfile={updateProfile}
  />
{/if}
