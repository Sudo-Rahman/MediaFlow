<script lang="ts">
  import type {
    Track,
    TranscodeFile,
    TranscodeQualityMode,
    TranscodeVideoEncoderCapability,
    TranscodeVideoMode,
  } from '$lib/types';
  import {
    getDefaultVideoPresetValue,
    hasManualVideoQualityControls,
    type TranscodeModeOption,
    type TranscodePresetOption,
  } from '$lib/services/transcode';
  import { formatResolution } from '$lib/utils/format';
  import * as Empty from '$lib/components/ui/empty';
  import { Input } from '$lib/components/ui/input';
  import * as Item from '$lib/components/ui/item';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';

  import TranscodeAdditionalOverrides from './TranscodeAdditionalOverrides.svelte';
  import type { TranscodeProfileUpdater } from './types';

  interface Props {
    file: TranscodeFile;
    selectedVideoTrack: Track | null;
    selectedVideoEncoder: TranscodeVideoEncoderCapability | null;
    availableVideoModeOptions: TranscodeModeOption<TranscodeVideoMode>[];
    availableVideoEncoders: TranscodeVideoEncoderCapability[];
    videoProfileOptions: string[];
    videoLevelOptions: string[];
    videoPixelFormatOptions: string[];
    videoPresetOptions: TranscodePresetOption[];
    updateProfile: TranscodeProfileUpdater;
    createId: (prefix: string) => string;
  }

  let {
    file,
    selectedVideoTrack,
    selectedVideoEncoder,
    availableVideoModeOptions,
    availableVideoEncoders,
    videoProfileOptions,
    videoLevelOptions,
    videoPixelFormatOptions,
    videoPresetOptions,
    updateProfile,
    createId,
  }: Props = $props();

  function parseOptionalInt(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function parseOptionalFloat(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function formatBitDepth(track?: Track | null): string {
    if (!track?.derivedBitDepth) return 'N/A';
    return `${track.derivedBitDepth}-bit`;
  }

  const selectedPresetValue = $derived(
    file.profile.video.preset ?? getDefaultVideoPresetValue(selectedVideoEncoder?.id) ?? '',
  );
  const hasManualQualityControls = $derived(hasManualVideoQualityControls(selectedVideoEncoder));
  const controlId = $props.id();
  const videoModeId = `${controlId}-video-mode`;
  const videoEncoderId = `${controlId}-video-encoder`;
  const videoProfileId = `${controlId}-video-profile`;
  const videoLevelId = `${controlId}-video-level`;
  const videoPixelFormatId = `${controlId}-video-pixel-format`;
  const qualityModeId = `${controlId}-quality-mode`;
  const crfId = `${controlId}-crf`;
  const qpId = `${controlId}-qp`;
  const videoBitrateId = `${controlId}-video-bitrate`;
  const videoPresetId = `${controlId}-video-preset`;
</script>

{#if !file.hasVideo}
  <Empty.Root class="border p-4">
    <Empty.Description>This file is audio-only, so video transcoding is disabled.</Empty.Description>
  </Empty.Root>
{:else}
  <div class="grid gap-4 lg:grid-cols-2">
    <div class="space-y-4">
      <div class="space-y-2">
        <Label for={videoModeId}>Video mode</Label>
        <Select.Root
          type="single"
          value={file.profile.video.mode}
          onValueChange={(value) => {
            updateProfile((profile) => {
              profile.video.mode = value as TranscodeVideoMode;
            });
          }}
        >
          <Select.Trigger id={videoModeId} class="w-full">{file.profile.video.mode}</Select.Trigger>
          <Select.Content>
            <Select.Group>
              {#each availableVideoModeOptions as option (option.value)}
                <Select.Item value={option.value}>{option.label}</Select.Item>
              {/each}
            </Select.Group>
          </Select.Content>
        </Select.Root>
      </div>

      {#if file.profile.video.mode === 'transcode'}
        <div class="space-y-2">
          <Label for={videoEncoderId}>Video encoder</Label>
          <Select.Root
            type="single"
            value={file.profile.video.encoderId}
            onValueChange={(value) => {
              updateProfile((profile) => {
                profile.video.encoderId = value;
                profile.video.preset = getDefaultVideoPresetValue(value);
              });
            }}
          >
            <Select.Trigger id={videoEncoderId} class="w-full">{selectedVideoEncoder?.label ?? 'Select encoder'}</Select.Trigger>
            <Select.Content>
              <Select.Group>
                {#each availableVideoEncoders as encoder (encoder.id)}
                  <Select.Item value={encoder.id}>{encoder.label}</Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
        </div>

        {#if videoProfileOptions.length > 0 || videoLevelOptions.length > 0}
          <div class="grid gap-4 md:grid-cols-2">
            {#if videoProfileOptions.length > 0}
              <div class="space-y-2">
                <Label for={videoProfileId}>Profile</Label>
                <Select.Root
                  type="single"
                  value={file.profile.video.profile}
                  onValueChange={(value) => {
                    updateProfile((profile) => {
                      profile.video.profile = value;
                    });
                  }}
                >
                  <Select.Trigger id={videoProfileId} class="w-full">{file.profile.video.profile ?? 'Auto'}</Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      {#each videoProfileOptions as profile (profile)}
                        <Select.Item value={profile}>{profile}</Select.Item>
                      {/each}
                    </Select.Group>
                  </Select.Content>
                </Select.Root>
              </div>
            {/if}

            {#if videoLevelOptions.length > 0}
              <div class="space-y-2">
                <Label for={videoLevelId}>Level</Label>
                <Select.Root
                  type="single"
                  value={file.profile.video.level}
                  onValueChange={(value) => {
                    updateProfile((profile) => {
                      profile.video.level = value;
                    });
                  }}
                >
                  <Select.Trigger id={videoLevelId} class="w-full">{file.profile.video.level ?? 'Auto'}</Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      {#each videoLevelOptions as level (level)}
                        <Select.Item value={level}>{level}</Select.Item>
                      {/each}
                    </Select.Group>
                  </Select.Content>
                </Select.Root>
              </div>
            {/if}
          </div>
        {/if}

        {#if videoPixelFormatOptions.length > 0}
          <div class="space-y-2">
            <Label for={videoPixelFormatId}>Pixel format</Label>
            <Select.Root
              type="single"
              value={file.profile.video.pixelFormat}
              onValueChange={(value) => {
                updateProfile((profile) => {
                  profile.video.pixelFormat = value;
                });
              }}
            >
              <Select.Trigger id={videoPixelFormatId} class="w-full">{file.profile.video.pixelFormat ?? 'Auto'}</Select.Trigger>
              <Select.Content>
                <Select.Group>
                  {#each videoPixelFormatOptions as pixelFormat (pixelFormat)}
                    <Select.Item value={pixelFormat}>{pixelFormat}</Select.Item>
                  {/each}
                </Select.Group>
              </Select.Content>
            </Select.Root>
            {#if selectedVideoEncoder?.supportedBitDepths?.length}
              <p class="text-xs text-muted-foreground">
                Supported bit depths: {selectedVideoEncoder.supportedBitDepths.join(', ')}-bit
              </p>
            {/if}
          </div>
        {/if}
      {:else}
        <Item.Root variant="outline" size="sm">
          <Item.Description>
            {file.profile.video.mode === 'copy'
              ? 'Video streams will be copied without re-encoding.'
              : 'Video streams are disabled for this output.'}
          </Item.Description>
        </Item.Root>
      {/if}
    </div>

    <div class="space-y-4">
      {#if file.profile.video.mode === 'transcode'}
        {#if hasManualQualityControls}
          <div class="space-y-2">
            <Label for={qualityModeId}>Quality mode</Label>
            <Select.Root
              type="single"
              value={file.profile.video.qualityMode}
              onValueChange={(value) => {
                updateProfile((profile) => {
                  profile.video.qualityMode = value as TranscodeQualityMode;
                });
              }}
            >
              <Select.Trigger id={qualityModeId} class="w-full">{file.profile.video.qualityMode}</Select.Trigger>
              <Select.Content>
                <Select.Group>
                  {#if selectedVideoEncoder?.supportsCrf}
                    <Select.Item value="crf">crf</Select.Item>
                  {/if}
                  {#if selectedVideoEncoder?.supportsQp}
                    <Select.Item value="qp">qp</Select.Item>
                  {/if}
                  {#if selectedVideoEncoder?.supportsBitrate}
                    <Select.Item value="bitrate">bitrate</Select.Item>
                  {/if}
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </div>

          {#if file.profile.video.qualityMode === 'crf'}
            <div class="space-y-2">
              <Label for={crfId}>CRF</Label>
              <Input
                id={crfId}
                type="number"
                value={file.profile.video.crf?.toString() ?? ''}
                oninput={(event) => {
                  const value = parseOptionalFloat(event.currentTarget.value);
                  updateProfile((profile) => {
                    profile.video.crf = value;
                  });
                }}
              />
            </div>
          {:else if file.profile.video.qualityMode === 'qp'}
            <div class="space-y-2">
              <Label for={qpId}>QP</Label>
              <Input
                id={qpId}
                type="number"
                value={file.profile.video.qp?.toString() ?? ''}
                oninput={(event) => {
                  const value = parseOptionalInt(event.currentTarget.value);
                  updateProfile((profile) => {
                    profile.video.qp = value;
                  });
                }}
              />
            </div>
          {:else}
            <div class="space-y-2">
              <Label for={videoBitrateId}>Bitrate (kbps)</Label>
              <Input
                id={videoBitrateId}
                type="number"
                value={file.profile.video.bitrateKbps?.toString() ?? ''}
                oninput={(event) => {
                  const value = parseOptionalInt(event.currentTarget.value);
                  updateProfile((profile) => {
                    profile.video.bitrateKbps = value;
                  });
                }}
              />
            </div>
          {/if}
        {:else}
          <Item.Root variant="outline" size="sm">
            <Item.Description>This encoder manages quality automatically.</Item.Description>
          </Item.Root>
        {/if}

        {#if videoPresetOptions.length > 0}
          <div class="space-y-2">
            <Label for={videoPresetId}>Preset</Label>
            <Select.Root
              type="single"
              value={selectedPresetValue}
              onValueChange={(value) => {
                updateProfile((profile) => {
                  profile.video.preset = value || undefined;
                });
              }}
            >
              <Select.Trigger id={videoPresetId} class="w-full">
                {videoPresetOptions.find((option) => option.value === selectedPresetValue)?.label ?? 'Select preset'}
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  {#each videoPresetOptions as option (option.value)}
                    <Select.Item value={option.value}>{option.label}</Select.Item>
                  {/each}
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </div>
        {/if}
      {:else}
        <Item.Root variant="outline" size="sm">
          <Item.Description>
            Encoder quality settings are not used while video mode is {file.profile.video.mode}.
          </Item.Description>
        </Item.Root>
      {/if}

      <Item.Group class="gap-2">
        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
          <Item.Title>Source codec</Item.Title>
          <Item.Description>{selectedVideoTrack?.codec.toUpperCase() ?? 'N/A'}</Item.Description>
        </Item.Root>
        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
          <Item.Title>Source resolution</Item.Title>
          <Item.Description>{formatResolution(selectedVideoTrack?.width, selectedVideoTrack?.height)}</Item.Description>
        </Item.Root>
        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
          <Item.Title>Source bit depth</Item.Title>
          <Item.Description>{formatBitDepth(selectedVideoTrack)}</Item.Description>
        </Item.Root>
        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
          <Item.Title>Source color</Item.Title>
          <Item.Description>
            {selectedVideoTrack?.colorSpace ?? 'N/A'} / {selectedVideoTrack?.colorTransfer ?? 'N/A'} / {selectedVideoTrack?.colorPrimaries ?? 'N/A'}
          </Item.Description>
        </Item.Root>
      </Item.Group>
    </div>
  </div>
{/if}

{#if file.hasVideo && file.profile.video.mode === 'transcode'}
  <TranscodeAdditionalOverrides
    tab="video"
    title="Additional Overrides"
    description="Optional safe FFmpeg flags for the current video encoder."
    emptyMessage="No video overrides added."
    encoderOptions={selectedVideoEncoder?.options ?? []}
    args={file.profile.video.additionalArgs}
    createId={createId}
    updateProfile={updateProfile}
  />
{/if}
