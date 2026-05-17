<script lang="ts">
  import { Settings2 } from '@lucide/svelte';

  import type {
    Track,
    TranscodeAdditionalArg,
    TranscodeAudioEncoderCapability,
    TranscodeAudioTrackOverride,
    TranscodeContainerCapability,
    TranscodeFile,
    TranscodeAudioMode,
  } from '$lib/types';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Empty from '$lib/components/ui/empty';
  import * as Item from '$lib/components/ui/item';
  import { Switch } from '$lib/components/ui/switch';
  import {
    cloneAudioTrackOverride,
    cloneAudioTrackOverrides,
    getAvailableAudioTrackModeOptions,
    getEffectiveAudioSettingsForTrack,
  } from '$lib/services/transcode';
  import { formatLanguage } from '$lib/utils/format';
  import { cn } from '$lib/utils';

  import type { TranscodeProfileUpdater } from './types';
  import TranscodeAdditionalOverrides from './TranscodeAdditionalOverrides.svelte';
  import TranscodeAudioSettingsForm from './TranscodeAudioSettingsForm.svelte';

  interface Props {
    open: boolean;
    file: TranscodeFile | null;
    audioTracks: Track[];
    selectedContainer: TranscodeContainerCapability | null;
    availableAudioEncoders: TranscodeAudioEncoderCapability[];
    createId: (prefix: string) => string;
    updateProfile: TranscodeProfileUpdater;
  }

  let {
    open = $bindable(),
    file,
    audioTracks,
    selectedContainer,
    availableAudioEncoders,
    createId,
    updateProfile,
  }: Props = $props();

  let draftTrackOverrides = $state<TranscodeAudioTrackOverride[]>([]);
  let selectedTrackId = $state<number | null>(null);

  const selectedTrack = $derived.by(() =>
    audioTracks.find((track) => track.id === selectedTrackId) ?? audioTracks[0] ?? null,
  );
  const selectedTrackOverride = $derived.by(() =>
    selectedTrack ? draftTrackOverrides.find((trackOverride) => trackOverride.trackId === selectedTrack.id) ?? null : null,
  );
  const selectedTrackEffectiveSettings = $derived.by(() =>
    selectedTrack && file
      ? {
        ...getEffectiveAudioSettingsForTrack({
          ...file.profile.audio,
          trackOverrides: draftTrackOverrides,
        }, selectedTrack.id),
      }
      : null,
  );
  const selectedTrackEncoder = $derived.by(() =>
    selectedTrackEffectiveSettings
      ? availableAudioEncoders.find((encoder) => encoder.id === selectedTrackEffectiveSettings.encoderId) ?? null
      : null,
  );
  const selectedTrackModeOptions = $derived.by(() =>
    getAvailableAudioTrackModeOptions(selectedTrack, selectedContainer),
  );

  $effect(() => {
    if (!open) {
      return;
    }

    const initialTrackOverrides = cloneAudioTrackOverrides(file?.profile.audio.trackOverrides ?? []);
    const initialSelectedTrackId = initialTrackOverrides[0]?.trackId ?? audioTracks[0]?.id ?? null;

    draftTrackOverrides = initialTrackOverrides;
    selectedTrackId = initialSelectedTrackId;
  });

  function getTrackLabel(track: Track): string {
    const position = audioTracks.findIndex((item) => item.id === track.id);
    return position >= 0 ? `Track ${position + 1}` : 'Track';
  }

  function getTrackDescription(track: Track): string {
    const details = [track.codec.toUpperCase()];
    if (track.language) {
      details.push(formatLanguage(track.language));
    }
    return details.join(' · ');
  }

  function getTrackMeta(track: Track): string {
    const parts = [track.title?.trim() || 'Untitled'];
    if (track.default) {
      parts.push('default');
    }
    return parts.join(' · ');
  }

  function getDraftOverride(trackId: number): TranscodeAudioTrackOverride | undefined {
    return draftTrackOverrides.find((trackOverride) => trackOverride.trackId === trackId);
  }

  function hasDraftOverride(trackId: number): boolean {
    return Boolean(getDraftOverride(trackId));
  }

  function getDraftEffectiveSettings(trackId: number): TranscodeAudioTrackOverride | null {
    if (!file) {
      return null;
    }

    return cloneAudioTrackOverride(
      getEffectiveAudioSettingsForTrack({
        ...file.profile.audio,
        trackOverrides: draftTrackOverrides,
      }, trackId),
    );
  }

  function upsertTrackOverride(trackId: number, updates: Partial<TranscodeAudioTrackOverride>): void {
    const effectiveSettings = getDraftEffectiveSettings(trackId);
    if (!effectiveSettings) {
      return;
    }

    const nextOverride = {
      ...effectiveSettings,
      ...updates,
      trackId,
      source: 'user' as const,
      reason: undefined,
    };

    if (hasDraftOverride(trackId)) {
      draftTrackOverrides = draftTrackOverrides.map((trackOverride) =>
        trackOverride.trackId === trackId ? nextOverride : trackOverride,
      );
      return;
    }

    draftTrackOverrides = [...draftTrackOverrides, nextOverride];
  }

  function removeTrackOverride(trackId: number): void {
    draftTrackOverrides = draftTrackOverrides.filter((trackOverride) => trackOverride.trackId !== trackId);
  }

  function setCustomEnabled(trackId: number, enabled: boolean): void {
    if (!enabled) {
      removeTrackOverride(trackId);
      return;
    }

    const effectiveSettings = getDraftEffectiveSettings(trackId);
    if (!effectiveSettings) {
      return;
    }

    upsertTrackOverride(trackId, effectiveSettings);
  }

  function getTrackModeSummary(trackId: number): string {
    const settings = getDraftEffectiveSettings(trackId);
    if (!settings) {
      return 'No audio settings';
    }

    if (settings.mode !== 'transcode') {
      return settings.mode;
    }

    const encoder = availableAudioEncoders.find((item) => item.id === settings.encoderId);
    return encoder?.label ?? settings.encoderId ?? 'transcode';
  }

  function handleApply(): void {
    if (!file) {
      open = false;
      return;
    }

    updateProfile((profile) => {
      profile.audio.trackOverrides = cloneAudioTrackOverrides(draftTrackOverrides);
    });
    open = false;
  }

  function handleTrackModeChange(mode: TranscodeAudioMode): void {
    if (!selectedTrack) {
      return;
    }

    upsertTrackOverride(selectedTrack.id, { mode });
  }

  function handleTrackAdditionalOverrideAdd(flag?: string): string | void {
    if (!selectedTrack || !selectedTrackOverride) {
      return;
    }

    const argId = createId('transcode-arg-audio-track');
    const nextAdditionalArgs: TranscodeAdditionalArg[] = [
      ...(selectedTrackOverride.additionalArgs ?? []),
      {
        id: argId,
        flag: flag ?? '',
        value: '',
        enabled: true,
        source: 'user',
      },
    ];

    upsertTrackOverride(selectedTrack.id, { additionalArgs: nextAdditionalArgs });
    return argId;
  }

  function handleTrackAdditionalOverrideUpdate(
    argId: string,
    updates: Partial<TranscodeAdditionalArg>,
  ): void {
    if (!selectedTrack || !selectedTrackOverride) {
      return;
    }

    upsertTrackOverride(selectedTrack.id, {
      additionalArgs: (selectedTrackOverride.additionalArgs ?? []).map((arg) =>
        arg.id === argId ? { ...arg, ...updates } : arg,
      ),
    });
  }

  function handleTrackAdditionalOverrideRemove(argId: string): void {
    if (!selectedTrack || !selectedTrackOverride) {
      return;
    }

    upsertTrackOverride(selectedTrack.id, {
      additionalArgs: (selectedTrackOverride.additionalArgs ?? []).filter((arg) => arg.id !== argId),
    });
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-5xl flex h-[85vh] max-h-[85vh] flex-col overflow-hidden">
    <Dialog.Header class="shrink-0">
      <Dialog.Title class="flex items-center gap-2">
        <Settings2 class="size-5" />
        Track Overrides
      </Dialog.Title>
      <Dialog.Description>
        Override audio settings per track while keeping the current global audio profile as the default.
      </Dialog.Description>
    </Dialog.Header>

    {#if file && audioTracks.length > 0}
      <div class="flex min-h-0 flex-1 flex-col gap-4 py-2 lg:flex-row">
        <Card.Root class="flex min-h-0 flex-col overflow-hidden lg:w-72 lg:flex-none">
          <Card.Header class="pb-3">
            <Card.Title>Detected audio tracks</Card.Title>
            <Card.Action>
              <Badge variant="outline">{audioTracks.length}</Badge>
            </Card.Action>
          </Card.Header>

          <Card.Content class="min-h-0 flex-1 overflow-y-auto">
            <div class="flex flex-col gap-2" aria-label="Detected audio tracks">
              {#each audioTracks as track (track.id)}
                {@const isSelected = selectedTrack?.id === track.id}
                {@const isCustom = hasDraftOverride(track.id)}
                <Item.Root
                  variant="outline"
                  size="sm"
                  class={cn(
                    'cursor-pointer items-start text-left',
                    isSelected && 'border-primary bg-primary/5',
                  )}
                >
                  {#snippet child({ props })}
                    <button
                      {...props}
                      type="button"
                      aria-pressed={isSelected}
                      onclick={() => selectedTrackId = track.id}
                    >
                      <Item.Content class="min-w-0">
                        <Item.Title class="truncate">{getTrackLabel(track)} · {getTrackDescription(track)}</Item.Title>
                        <Item.Description class="truncate">{getTrackMeta(track)}</Item.Description>
                        <Item.Description class="truncate">{getTrackModeSummary(track.id)}</Item.Description>
                      </Item.Content>

                      <Item.Actions>
                        <Badge variant={isCustom ? 'default' : 'outline'}>
                          {isCustom ? 'Custom' : 'Global'}
                        </Badge>
                      </Item.Actions>
                    </button>
                  {/snippet}
                </Item.Root>
              {/each}
            </div>
          </Card.Content>
        </Card.Root>

        <div class="min-h-0 flex-1 overflow-auto">
          <div class="h-full min-h-0 px-4">
            {#if selectedTrack && selectedTrackEffectiveSettings}
              <div class="space-y-4 pb-1">
                <Card.Root>
                  <Card.Content class="space-y-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p class="text-sm font-medium">{getTrackLabel(selectedTrack)}</p>
                        <p class="text-sm text-muted-foreground">{getTrackDescription(selectedTrack)}</p>
                      </div>

                      <Badge variant={selectedTrackOverride ? 'default' : 'outline'}>
                        {selectedTrackOverride ? 'Custom' : 'Global'}
                      </Badge>
                    </div>

                    <div class="flex flex-wrap items-center gap-3">
                      <label class="flex items-center gap-2 text-sm">
                        <Switch
                          checked={Boolean(selectedTrackOverride)}
                          onCheckedChange={(checked) => setCustomEnabled(selectedTrack.id, checked)}
                        />
                        <span>Use custom settings for this track</span>
                      </label>

                      <Button
                        variant="outline"
                        size="sm"
                        onclick={() => removeTrackOverride(selectedTrack.id)}
                        disabled={!selectedTrackOverride}
                      >
                        Reset to global
                      </Button>
                    </div>
                  </Card.Content>
                </Card.Root>

                {#if selectedTrackOverride}
                  <TranscodeAudioSettingsForm
                    settings={selectedTrackEffectiveSettings}
                    sourceTrack={selectedTrack}
                    selectedEncoder={selectedTrackEncoder}
                    modeOptions={selectedTrackModeOptions}
                    availableAudioEncoders={availableAudioEncoders}
                    copyMessage="This track will be copied without re-encoding."
                    disableMessage="This track is disabled for this output."
                    inactiveMessage={`Encoder bitrate and stream overrides are not used while this track is ${selectedTrackEffectiveSettings.mode}.`}
                    onModeChange={handleTrackModeChange}
                    onEncoderChange={(encoderId) => upsertTrackOverride(selectedTrack.id, { encoderId })}
                    onBitrateChange={(value) => upsertTrackOverride(selectedTrack.id, { bitrateKbps: value })}
                    onChannelsChange={(value) => upsertTrackOverride(selectedTrack.id, { channels: value })}
                    onSampleRateChange={(value) => upsertTrackOverride(selectedTrack.id, { sampleRate: value })}
                  />

                  {#if selectedTrackEffectiveSettings.mode === 'transcode'}
                    <TranscodeAdditionalOverrides
                      title="Additional Overrides"
                      description="Optional safe FFmpeg flags applied only to this track."
                      emptyMessage="No per-track audio overrides added."
                      encoderOptions={selectedTrackEncoder?.options ?? []}
                      args={selectedTrackOverride.additionalArgs ?? []}
                      onAddOverride={handleTrackAdditionalOverrideAdd}
                      onUpdateOverride={handleTrackAdditionalOverrideUpdate}
                      onRemoveOverride={handleTrackAdditionalOverrideRemove}
                    />
                  {/if}
                {:else}
                  <Card.Root>
                    <Card.Header class="pb-3">
                      <Card.Description>
                        This track currently inherits the global audio settings from the Audio tab.
                      </Card.Description>
                    </Card.Header>
                    <Card.Content>
                      <Item.Group class="gap-2 sm:grid sm:grid-cols-2">
                        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
                          <Item.Title>Mode</Item.Title>
                          <Item.Description>{selectedTrackEffectiveSettings.mode}</Item.Description>
                        </Item.Root>
                        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
                          <Item.Title>Encoder</Item.Title>
                          <Item.Description>{selectedTrackEncoder?.label ?? selectedTrackEffectiveSettings.encoderId ?? 'N/A'}</Item.Description>
                        </Item.Root>
                        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
                          <Item.Title>Bitrate</Item.Title>
                          <Item.Description>{selectedTrackEffectiveSettings.bitrateKbps ? `${selectedTrackEffectiveSettings.bitrateKbps} kbps` : 'Source / automatic'}</Item.Description>
                        </Item.Root>
                        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
                          <Item.Title>Channels</Item.Title>
                          <Item.Description>{selectedTrackEffectiveSettings.channels ?? 'Source / automatic'}</Item.Description>
                        </Item.Root>
                        <Item.Root variant="outline" size="xs" class="justify-between sm:col-span-2" role="listitem">
                          <Item.Title>Sample rate</Item.Title>
                          <Item.Description>{selectedTrackEffectiveSettings.sampleRate ? `${selectedTrackEffectiveSettings.sampleRate} Hz` : 'Source / automatic'}</Item.Description>
                        </Item.Root>
                      </Item.Group>
                    </Card.Content>
                  </Card.Root>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <Dialog.Footer class="shrink-0">
        <Button variant="outline" onclick={() => open = false}>
          Cancel
        </Button>
        <Button onclick={handleApply}>
          Apply
        </Button>
      </Dialog.Footer>
    {:else}
      <Empty.Root class="border p-4">
        <Empty.Description>No audio tracks were detected in this file.</Empty.Description>
      </Empty.Root>
    {/if}
  </Dialog.Content>
</Dialog.Root>
