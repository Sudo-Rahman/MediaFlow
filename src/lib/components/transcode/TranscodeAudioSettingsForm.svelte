<script lang="ts">
  import type {
    Track,
    TranscodeAudioEncoderCapability,
    TranscodeAudioMode,
    TranscodeAudioSettings,
    TranscodeAudioTrackOverride,
  } from '$lib/types';
  import type { TranscodeModeOption } from '$lib/services/transcode';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as Item from '$lib/components/ui/item';
  import { Switch } from '$lib/components/ui/switch';
  import * as Select from '$lib/components/ui/select';
  import { formatChannels } from '$lib/utils/format';

  interface Props {
    settings: Pick<TranscodeAudioSettings, 'mode' | 'encoderId' | 'bitrateKbps' | 'channels' | 'sampleRate'>
      | Pick<TranscodeAudioTrackOverride, 'mode' | 'encoderId' | 'bitrateKbps' | 'channels' | 'sampleRate'>;
    sourceTrack: Track | null;
    showSourceTrackDetails?: boolean;
    selectedEncoder: TranscodeAudioEncoderCapability | null;
    modeOptions: TranscodeModeOption<TranscodeAudioMode>[];
    availableAudioEncoders: TranscodeAudioEncoderCapability[];
    copyMessage: string;
    disableMessage: string;
    inactiveMessage: string;
    onModeChange: (mode: TranscodeAudioMode) => void;
    onEncoderChange: (encoderId: string) => void;
    onBitrateChange: (value: number | undefined) => void;
    onChannelsChange: (value: number | undefined) => void;
    onSampleRateChange: (value: number | undefined) => void;
  }

  let {
    settings,
    sourceTrack,
    showSourceTrackDetails = true,
    selectedEncoder,
    modeOptions,
    availableAudioEncoders,
    copyMessage,
    disableMessage,
    inactiveMessage,
    onModeChange,
    onEncoderChange,
    onBitrateChange,
    onChannelsChange,
    onSampleRateChange,
  }: Props = $props();

  function parseOptionalInt(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function formatSampleRate(value?: number): string {
    if (!value) return 'N/A';
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz`;
  }

  const isBitrateDisabled = $derived(!selectedEncoder?.supportsBitrate || selectedEncoder?.codec === 'flac');
  const channelsDefaultLabel = $derived(
    showSourceTrackDetails ? `Default: As source (${formatChannels(sourceTrack?.channels)})` : 'Default: As source',
  );
  const sampleRateDefaultLabel = $derived(
    showSourceTrackDetails ? `Default: As source (${formatSampleRate(sourceTrack?.sampleRate)})` : 'Default: As source',
  );
  const controlId = $props.id();
  const audioModeId = `${controlId}-audio-mode`;
  const audioEncoderId = `${controlId}-audio-encoder`;
  const bitrateId = `${controlId}-bitrate`;
  const channelsSwitchId = `${controlId}-channels-override`;
  const channelsLabelId = `${controlId}-channels-label`;
  const channelsInputId = `${controlId}-channels`;
  const sampleRateSwitchId = `${controlId}-sample-rate-override`;
  const sampleRateLabelId = `${controlId}-sample-rate-label`;
  const sampleRateInputId = `${controlId}-sample-rate`;
</script>

<div class="grid gap-4 lg:grid-cols-2">
  <div class="space-y-4">
    <Field.Field class="gap-2">
      <Field.Label for={audioModeId}>Audio mode</Field.Label>
      <Select.Root
        type="single"
        value={settings.mode}
        onValueChange={(value) => onModeChange(value as TranscodeAudioMode)}
        >
        <Select.Trigger id={audioModeId} class="w-full">{settings.mode}</Select.Trigger>
        <Select.Content>
          <Select.Group>
            {#each modeOptions as option (option.value)}
              <Select.Item value={option.value}>{option.label}</Select.Item>
            {/each}
          </Select.Group>
        </Select.Content>
      </Select.Root>
    </Field.Field>

    {#if settings.mode === 'transcode'}
      <Field.Field class="gap-2">
        <Field.Label for={audioEncoderId}>Audio encoder</Field.Label>
        <Select.Root
          type="single"
          value={settings.encoderId}
          onValueChange={(value) => onEncoderChange(value)}
        >
          <Select.Trigger id={audioEncoderId} class="w-full">{selectedEncoder?.label ?? 'Select encoder'}</Select.Trigger>
          <Select.Content>
            <Select.Group>
              {#each availableAudioEncoders as encoder (encoder.id)}
                <Select.Item value={encoder.id}>{encoder.label}</Select.Item>
              {/each}
            </Select.Group>
          </Select.Content>
        </Select.Root>
      </Field.Field>
    {:else}
      <Item.Root variant="outline" size="sm">
        <Item.Description>{settings.mode === 'copy' ? copyMessage : disableMessage}</Item.Description>
      </Item.Root>
    {/if}
  </div>

  <div class="space-y-4">
    {#if settings.mode === 'transcode'}
      <Field.Field class="gap-2">
        <Field.Label for={bitrateId}>Bitrate (kbps)</Field.Label>
        <Input
          id={bitrateId}
          type="number"
          value={settings.bitrateKbps?.toString() ?? ''}
          oninput={(event) => onBitrateChange(parseOptionalInt(event.currentTarget.value))}
          disabled={isBitrateDisabled}
        />
      </Field.Field>

      <div class="grid gap-4 xl:grid-cols-2">
        {#if selectedEncoder?.supportsChannels}
          <Field.Field class="gap-2">
            <Field.Field class="min-w-0" orientation="horizontal">
              <Field.Content>
                <Field.Label id={channelsLabelId} for={channelsSwitchId}>Channels</Field.Label>
                <Field.Description class="break-words text-xs">
                  {channelsDefaultLabel}
                </Field.Description>
              </Field.Content>
              <div class="flex items-center gap-3">
                <span class="text-xs text-muted-foreground">Override</span>
                <Switch
                  id={channelsSwitchId}
                  checked={settings.channels !== undefined}
                  onCheckedChange={(checked) => onChannelsChange(
                    checked ? (settings.channels ?? (showSourceTrackDetails ? sourceTrack?.channels : undefined) ?? 2) : undefined,
                  )}
                />
              </div>
            </Field.Field>

            {#if settings.channels !== undefined}
              <Input
                id={channelsInputId}
                type="number"
                aria-labelledby={channelsLabelId}
                value={settings.channels?.toString() ?? ''}
                oninput={(event) => onChannelsChange(parseOptionalInt(event.currentTarget.value))}
              />
            {/if}
          </Field.Field>
        {/if}

        {#if selectedEncoder?.supportsSampleRate}
          <Field.Field class="gap-2">
            <Field.Field class="min-w-0" orientation="horizontal">
              <Field.Content>
                <Field.Label id={sampleRateLabelId} for={sampleRateSwitchId}>Sample rate</Field.Label>
                <Field.Description class="break-words text-xs">
                  {sampleRateDefaultLabel}
                </Field.Description>
              </Field.Content>
              <div class="flex items-center gap-3">
                <span class="text-xs text-muted-foreground">Override</span>
                <Switch
                  id={sampleRateSwitchId}
                  checked={settings.sampleRate !== undefined}
                  onCheckedChange={(checked) => onSampleRateChange(
                    checked ? (settings.sampleRate ?? (showSourceTrackDetails ? sourceTrack?.sampleRate : undefined) ?? 48000) : undefined,
                  )}
                />
              </div>
            </Field.Field>

            {#if settings.sampleRate !== undefined}
              <Input
                id={sampleRateInputId}
                type="number"
                aria-labelledby={sampleRateLabelId}
                value={settings.sampleRate?.toString() ?? ''}
                oninput={(event) => onSampleRateChange(parseOptionalInt(event.currentTarget.value))}
              />
            {/if}
          </Field.Field>
        {/if}
      </div>
    {:else}
      <Item.Root variant="outline" size="sm">
        <Item.Description>{inactiveMessage}</Item.Description>
      </Item.Root>
    {/if}

    {#if showSourceTrackDetails}
      <Item.Group class="gap-2">
        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
          <Item.Title>Source codec</Item.Title>
          <Item.Description>{sourceTrack?.codec.toUpperCase() ?? 'N/A'}</Item.Description>
        </Item.Root>
        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
          <Item.Title>Channels</Item.Title>
          <Item.Description>{formatChannels(sourceTrack?.channels)}</Item.Description>
        </Item.Root>
        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
          <Item.Title>Sample rate</Item.Title>
          <Item.Description>{formatSampleRate(sourceTrack?.sampleRate)}</Item.Description>
        </Item.Root>
        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
          <Item.Title>Layout</Item.Title>
          <Item.Description>{sourceTrack?.channelLayout ?? 'N/A'}</Item.Description>
        </Item.Root>
      </Item.Group>
    {:else}
      <Item.Root variant="outline" size="sm">
        <Item.Description>
          Source codec, channels, sample rate, and layout vary across the detected audio tracks. Open Track Overrides to inspect per-track details.
        </Item.Description>
      </Item.Root>
    {/if}
  </div>
</div>
