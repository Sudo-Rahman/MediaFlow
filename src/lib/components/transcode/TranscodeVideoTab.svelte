<script lang="ts">
  import type {
    Track,
    TranscodeFile,
    TranscodeQualityMode,
    TranscodeVideoEncoderCapability,
    TranscodeVideoMode,
    TranscodeVideoResolutionSelection,
  } from '$lib/types';
  import {
    getDefaultVideoPresetValue,
    getEffectiveVideoResolution,
    getVideoResolutionPairedDimension,
    getVideoResolutionPresetOptions,
    getVideoResolutionPresetValue,
    hasManualVideoQualityControls,
    normalizeVideoResolutionSettings,
    type TranscodeVideoResolutionDimension,
    type TranscodeModeOption,
    type TranscodePresetOption,
  } from '$lib/services/transcode';
  import { formatResolution } from '$lib/utils/format';
  import * as Empty from '$lib/components/ui/empty';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as InputGroup from '$lib/components/ui/input-group';
  import * as Item from '$lib/components/ui/item';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';

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

  function getSourceVideoDimensions(currentFile: TranscodeFile): { width: number; height: number } {
    const sourceTrack = selectedVideoTrack ?? currentFile.tracks.find((track) => track.type === 'video');
    return {
      width: sourceTrack?.width ?? 1920,
      height: sourceTrack?.height ?? 1080,
    };
  }

  function selectVideoResolution(value: TranscodeVideoResolutionSelection): void {
    const selectedOption = videoResolutionPresetOptions.find((option) => option.value === value);
    if (!selectedOption) return;

    updateProfile((profile, currentFile) => {
      if (selectedOption.resolution) {
        profile.video.resolution = normalizeVideoResolutionSettings({
          ...selectedOption.resolution,
          selection: selectedOption.value,
        });
        return;
      }

      const { width, height } = getSourceVideoDimensions(currentFile);
      profile.video.resolution = normalizeVideoResolutionSettings({
        mode: 'fit',
        maxWidth: width,
        maxHeight: height,
        selection: 'custom',
        keepRatio: true,
      });
    });
  }

  function updateCustomVideoResolution(
    changedDimension: TranscodeVideoResolutionDimension,
    value: number | undefined,
  ): void {
    updateProfile((profile, currentFile) => {
      const keepRatio = profile.video.resolution.keepRatio !== false;
      const sourceDimensions = getSourceVideoDimensions(currentFile);
      const pairedDimension = keepRatio
        ? getVideoResolutionPairedDimension(changedDimension, value, sourceDimensions)
        : undefined;
      profile.video.resolution = normalizeVideoResolutionSettings({
        ...profile.video.resolution,
        mode: 'fit',
        selection: 'custom',
        keepRatio,
        maxWidth: changedDimension === 'width'
          ? value
          : pairedDimension ?? profile.video.resolution.maxWidth,
        maxHeight: changedDimension === 'height'
          ? value
          : pairedDimension ?? profile.video.resolution.maxHeight,
      });
    });
  }

  function updateCustomVideoKeepRatio(keepRatio: boolean): void {
    updateProfile((profile, currentFile) => {
      const sourceDimensions = getSourceVideoDimensions(currentFile);
      const pairedHeight = keepRatio
        ? getVideoResolutionPairedDimension('width', profile.video.resolution.maxWidth, sourceDimensions)
        : undefined;
      const pairedWidth = keepRatio && !pairedHeight
        ? getVideoResolutionPairedDimension('height', profile.video.resolution.maxHeight, sourceDimensions)
        : undefined;

      profile.video.resolution = normalizeVideoResolutionSettings({
        ...profile.video.resolution,
        mode: 'fit',
        selection: 'custom',
        keepRatio,
        maxWidth: pairedWidth ?? profile.video.resolution.maxWidth,
        maxHeight: pairedHeight ?? profile.video.resolution.maxHeight,
      });
    });
  }

  function getVideoResolutionTriggerLabel(value: TranscodeVideoResolutionSelection): string {
    return videoResolutionPresetOptions.find((option) => option.value === value)?.label ?? 'Custom fit';
  }

  const selectedPresetValue = $derived(
    file.profile.video.preset ?? getDefaultVideoPresetValue(selectedVideoEncoder?.id) ?? '',
  );
  const videoResolutionPresetOptions = getVideoResolutionPresetOptions();
  const selectedResolutionPresetValue = $derived(getVideoResolutionPresetValue(file.profile.video.resolution));
  const effectiveVideoResolution = $derived(getEffectiveVideoResolution(file.profile.video.resolution, selectedVideoTrack));
  const customVideoKeepRatioEnabled = $derived(file.profile.video.resolution.keepRatio !== false);
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
  const videoResolutionId = `${controlId}-video-resolution`;
  const videoMaxWidthId = `${controlId}-video-max-width`;
  const videoMaxHeightId = `${controlId}-video-max-height`;
  const videoKeepRatioId = `${controlId}-video-keep-ratio`;
</script>

{#if !file.hasVideo}
  <Empty.Root class="border p-4">
    <Empty.Description>This file is audio-only, so video transcoding is disabled.</Empty.Description>
  </Empty.Root>
{:else}
  <div class="space-y-4">
    <div class="grid gap-4 lg:grid-cols-2 lg:items-start">
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
      {:else}
        <Item.Root variant="outline" size="sm">
          <Item.Description>This encoder manages quality automatically.</Item.Description>
        </Item.Root>
      {/if}

      <Field.Group class="gap-3 @container/resolution">
        <Item.Root
          variant="outline"
          size="sm"
          class="flex-col items-stretch gap-4"
        >
          <div class="flex min-w-0 flex-col gap-3 @lg/resolution:flex-row @lg/resolution:items-start">
            <Item.Content class="min-w-0">
              <Item.Title>Output resolution</Item.Title>
              <Item.Description>
                {effectiveVideoResolution
                  ? formatResolution(effectiveVideoResolution.width, effectiveVideoResolution.height)
                  : 'N/A'}
              </Item.Description>
            </Item.Content>

            <Item.Actions class="w-full @lg/resolution:w-64">
              <Field.Field class="gap-2">
                <Field.Label for={videoResolutionId}>Resolution</Field.Label>
                <Select.Root
                  type="single"
                  value={selectedResolutionPresetValue}
                  onValueChange={(value) => selectVideoResolution(value as TranscodeVideoResolutionSelection)}
                >
                  <Select.Trigger id={videoResolutionId} class="w-full">
                    {getVideoResolutionTriggerLabel(selectedResolutionPresetValue)}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      {#each videoResolutionPresetOptions as option (option.value)}
                        <Select.Item value={option.value}>{option.label}</Select.Item>
                      {/each}
                    </Select.Group>
                  </Select.Content>
                </Select.Root>
              </Field.Field>
            </Item.Actions>
          </div>

          {#if selectedResolutionPresetValue === 'custom' && file.profile.video.resolution.mode === 'fit'}
            <Field.Group class="gap-3">
              <Field.Field orientation="horizontal" class="items-center">
                <Field.Content>
                  <Field.Label for={videoKeepRatioId}>Keep ratio</Field.Label>
                </Field.Content>
                <Switch
                  id={videoKeepRatioId}
                  size="sm"
                  checked={customVideoKeepRatioEnabled}
                  onCheckedChange={(checked) => updateCustomVideoKeepRatio(checked)}
                />
              </Field.Field>

              <div class="grid gap-4 md:grid-cols-2">
                <Field.Field>
                  <Field.Label for={videoMaxWidthId}>Width</Field.Label>
                  <InputGroup.Root>
                    <InputGroup.Input
                      id={videoMaxWidthId}
                      type="number"
                      min="1"
                      step="1"
                      value={file.profile.video.resolution.maxWidth?.toString() ?? ''}
                      oninput={(event) => {
                        const value = parseOptionalInt(event.currentTarget.value);
                        updateCustomVideoResolution('width', value);
                      }}
                    />
                    <InputGroup.Addon align="inline-end">px</InputGroup.Addon>
                  </InputGroup.Root>
                </Field.Field>

                <Field.Field>
                  <Field.Label for={videoMaxHeightId}>Height</Field.Label>
                  <InputGroup.Root>
                    <InputGroup.Input
                      id={videoMaxHeightId}
                      type="number"
                      min="1"
                      step="1"
                      value={file.profile.video.resolution.maxHeight?.toString() ?? ''}
                      oninput={(event) => {
                        const value = parseOptionalInt(event.currentTarget.value);
                        updateCustomVideoResolution('height', value);
                      }}
                    />
                    <InputGroup.Addon align="inline-end">px</InputGroup.Addon>
                  </InputGroup.Root>
                </Field.Field>
              </div>
            </Field.Group>
          {/if}
        </Item.Root>
      </Field.Group>

      {#if hasManualQualityControls}
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
      {/if}

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

      <Item.Root variant="outline" size="sm">
        <Item.Description>
          Encoder quality settings are not used while video mode is {file.profile.video.mode}.
        </Item.Description>
      </Item.Root>

      {/if}
    </div>

    <Item.Group class="gap-2 sm:grid sm:grid-cols-2">
      <Item.Root variant="outline" size="xs" class="min-w-0 justify-between" role="listitem">
        <Item.Title>Source codec</Item.Title>
        <Item.Description>{selectedVideoTrack?.codec.toUpperCase() ?? 'N/A'}</Item.Description>
      </Item.Root>
      <Item.Root variant="outline" size="xs" class="min-w-0 justify-between" role="listitem">
        <Item.Title>Source resolution</Item.Title>
        <Item.Description>{formatResolution(selectedVideoTrack?.width, selectedVideoTrack?.height)}</Item.Description>
      </Item.Root>
      <Item.Root variant="outline" size="xs" class="min-w-0 justify-between" role="listitem">
        <Item.Title>Source bit depth</Item.Title>
        <Item.Description>{formatBitDepth(selectedVideoTrack)}</Item.Description>
      </Item.Root>
      <Item.Root variant="outline" size="xs" class="min-w-0 justify-between" role="listitem">
        <Item.Title>Source color</Item.Title>
        <Item.Description class="text-right">
          {selectedVideoTrack?.colorSpace ?? 'N/A'} / {selectedVideoTrack?.colorTransfer ?? 'N/A'} / {selectedVideoTrack?.colorPrimaries ?? 'N/A'}
        </Item.Description>
      </Item.Root>
    </Item.Group>
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
