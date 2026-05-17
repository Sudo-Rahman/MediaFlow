<script lang="ts">
  import { Settings2 } from '@lucide/svelte';

  import type {
    Track,
    TranscodeAudioEncoderCapability,
    TranscodeAudioMode,
    TranscodeContainerCapability,
    TranscodeFile,
  } from '$lib/types';
  import type { TranscodeModeOption } from '$lib/services/transcode';
  import { Button } from '$lib/components/ui/button';
  import * as Empty from '$lib/components/ui/empty';
  import * as Item from '$lib/components/ui/item';

  import TranscodeAdditionalOverrides from './TranscodeAdditionalOverrides.svelte';
  import TranscodeAudioSettingsForm from './TranscodeAudioSettingsForm.svelte';
  import TranscodeAudioTrackOverridesDialog from './TranscodeAudioTrackOverridesDialog.svelte';
  import type { TranscodeProfileUpdater } from './types';

  interface Props {
    file: TranscodeFile;
    audioTracks: Track[];
    selectedAudioTrack: Track | null;
    selectedAudioEncoder: TranscodeAudioEncoderCapability | null;
    selectedContainer: TranscodeContainerCapability | null;
    availableAudioModeOptions: TranscodeModeOption<TranscodeAudioMode>[];
    availableAudioEncoders: TranscodeAudioEncoderCapability[];
    updateProfile: TranscodeProfileUpdater;
    createId: (prefix: string) => string;
  }

  let {
    file,
    audioTracks,
    selectedAudioTrack,
    selectedAudioEncoder,
    selectedContainer,
    availableAudioModeOptions,
    availableAudioEncoders,
    updateProfile,
    createId,
  }: Props = $props();

  let trackOverridesDialogOpen = $state(false);

  const hasMultipleAudioTracks = $derived(audioTracks.length > 1);
  const customOverrideCount = $derived(file.profile.audio.trackOverrides.length);
  const audioTrackCountLabel = $derived(`${audioTracks.length} audio track${audioTracks.length === 1 ? '' : 's'} detected`);
  const customOverrideLabel = $derived(
    customOverrideCount === 0
      ? 'All tracks currently inherit the global audio settings.'
      : `${customOverrideCount} custom override${customOverrideCount === 1 ? '' : 's'} configured.`,
  );
</script>

{#if !file.hasAudio}
  <Empty.Root class="border p-4">
    <Empty.Description>No audio stream was detected in this file.</Empty.Description>
  </Empty.Root>
{:else}
  <div class="space-y-4">
    {#if hasMultipleAudioTracks}
      <Item.Root variant="outline" class="items-start">
        <Item.Media variant="icon" class="text-primary">
          <Settings2 />
        </Item.Media>
        <Item.Content class="min-w-0">
          <Item.Title>Per-track audio overrides</Item.Title>
          <Item.Description>
            Adjust individual tracks without changing the global audio settings below.
          </Item.Description>
          <Item.Footer class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <p>{audioTrackCountLabel}</p>
            <p>{customOverrideLabel}</p>
          </Item.Footer>
        </Item.Content>
        <Item.Actions class="w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            class="w-full shrink-0 sm:w-auto"
            onclick={() => trackOverridesDialogOpen = true}
          >
            <Settings2 class="mr-2 size-4" />
            Open
          </Button>
        </Item.Actions>
      </Item.Root>
    {/if}

    <TranscodeAudioSettingsForm
      settings={file.profile.audio}
      sourceTrack={selectedAudioTrack}
      showSourceTrackDetails={!hasMultipleAudioTracks}
      selectedEncoder={selectedAudioEncoder}
      modeOptions={availableAudioModeOptions}
      availableAudioEncoders={availableAudioEncoders}
      copyMessage="Audio streams will be copied without re-encoding."
      disableMessage="Audio streams are disabled for this output."
      inactiveMessage={`Encoder bitrate and stream overrides are not used while audio mode is ${file.profile.audio.mode}.`}
      onModeChange={(mode) => {
        updateProfile((profile) => {
          profile.audio.mode = mode as TranscodeAudioMode;
        });
      }}
      onEncoderChange={(encoderId) => {
        updateProfile((profile) => {
          profile.audio.encoderId = encoderId;
        });
      }}
      onBitrateChange={(value) => {
        updateProfile((profile) => {
          profile.audio.bitrateKbps = value;
        });
      }}
      onChannelsChange={(value) => {
        updateProfile((profile) => {
          profile.audio.channels = value;
        });
      }}
      onSampleRateChange={(value) => {
        updateProfile((profile) => {
          profile.audio.sampleRate = value;
        });
      }}
    />
  </div>
{/if}

{#if file.hasAudio && file.profile.audio.mode === 'transcode'}
  <TranscodeAdditionalOverrides
    tab="audio"
    title="Additional Overrides"
    description="Optional safe FFmpeg flags for audio transcoding."
    emptyMessage="No audio overrides added."
    encoderOptions={selectedAudioEncoder?.options ?? []}
    args={file.profile.audio.additionalArgs}
    createId={createId}
    updateProfile={updateProfile}
  />
{/if}

<TranscodeAudioTrackOverridesDialog
  bind:open={trackOverridesDialogOpen}
  file={file}
  audioTracks={audioTracks}
  selectedContainer={selectedContainer}
  availableAudioEncoders={availableAudioEncoders}
  createId={createId}
  updateProfile={updateProfile}
/>
