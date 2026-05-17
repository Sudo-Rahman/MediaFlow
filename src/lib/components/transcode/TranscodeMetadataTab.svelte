<script lang="ts">
  import { Layers, RotateCcw } from '@lucide/svelte';

  import type {
    Track,
    TranscodeCapabilities,
    TranscodeContainerCapability,
    TranscodeFile,
    TranscodeOutputTrackPlan,
  } from '$lib/types';
  import { COMMON_LANGUAGES } from '$lib/types';
  import {
    applyTranscodeMetadataBatch,
    buildTranscodeOutputTrackPlan,
    getMetadataSchemaForContainer,
    updateTranscodeMetadataTrack,
  } from '$lib/services/transcode';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Empty from '$lib/components/ui/empty';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { formatBitrate, formatLanguage, formatResolution } from '$lib/utils/format';

  import type { TranscodeMetadataUpdater } from './types';

  interface Props {
    file: TranscodeFile;
    capabilities: TranscodeCapabilities | null;
    selectedContainer: TranscodeContainerCapability | null;
    isProcessing: boolean;
    onUpdateMetadata: TranscodeMetadataUpdater;
    onResetMetadata?: () => void;
  }

  let {
    file,
    capabilities,
    selectedContainer,
    isProcessing,
    onUpdateMetadata,
    onResetMetadata,
  }: Props = $props();

  let selectedTracks = $state<{ fileId: string | null; trackIds: number[] }>({
    fileId: null,
    trackIds: [],
  });
  let batchLanguage = $state('und');
  let batchTitlePattern = $state('');

  const schema = $derived(getMetadataSchemaForContainer(capabilities, file.profile.containerId));
  const outputTracks = $derived.by(() => buildTranscodeOutputTrackPlan(file, capabilities));
  const availableTrackIds = $derived.by(() => new Set(outputTracks.map((track) => track.sourceTrackId)));
  const selectedTrackIds = $derived.by(() => {
    const trackIds = selectedTracks.fileId === file.id ? selectedTracks.trackIds : [];
    return trackIds.filter((trackId) => availableTrackIds.has(trackId));
  });
  const selectedCount = $derived(selectedTrackIds.length);
  const groupedTracks = $derived.by(() => {
    const groups: Record<'video' | 'audio' | 'subtitle', TranscodeOutputTrackPlan[]> = {
      video: [],
      audio: [],
      subtitle: [],
    };

    for (const track of outputTracks) {
      if (track.type === 'video' || track.type === 'audio' || track.type === 'subtitle') {
        groups[track.type].push(track);
      }
    }

    return Object.entries(groups).filter(([, tracks]) => tracks.length > 0) as Array<[
      'video' | 'audio' | 'subtitle',
      TranscodeOutputTrackPlan[],
    ]>;
  });

  function formatTypeLabel(type: Track['type']): string {
    if (type === 'video') return 'Video';
    if (type === 'audio') return 'Audio';
    if (type === 'subtitle') return 'Subtitles';
    return 'Data';
  }

  function formatModeLabel(track: TranscodeOutputTrackPlan): string {
    if (track.mode === 'copy') return 'Copied';
    if (track.mode === 'convert_text') return 'Converted';
    return 'Transcoded';
  }

  function getSourceLabel(track: TranscodeOutputTrackPlan): string {
    const title = track.sourceTrack.title?.trim();
    const base = `${formatTypeLabel(track.type)} #${track.sourceTrack.index}`;
    return title ? `${base} · ${title}` : base;
  }

  function formatSourceChannels(track: Track): string | null {
    const layout = track.channelLayout?.trim();
    if (layout && layout !== 'unknown') {
      if (layout === 'mono') return '1.0';
      if (layout === 'stereo') return '2.0';
      return layout;
    }

    if (track.channels === 1) return '1.0';
    if (track.channels === 2) return '2.0';
    if (track.channels === 6) return '5.1';
    if (track.channels === 8) return '7.1';
    return track.channels ? `${track.channels}ch` : null;
  }

  function formatSourceSampleRate(value?: number): string | null {
    if (!value) return null;
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz`;
  }

  function formatSourceFrameRate(value?: string): string | null {
    if (!value) return null;

    const [numeratorValue, denominatorValue] = value.split('/');
    const numerator = Number(numeratorValue);
    const denominator = Number(denominatorValue);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
      return `${(numerator / denominator).toFixed(3)} fps`;
    }

    return value;
  }

  function maybeBitrate(value?: number): string | null {
    const formatted = formatBitrate(value);
    return formatted === 'N/A' ? null : formatted;
  }

  function getSourceDetails(track: TranscodeOutputTrackPlan): string[] {
    const source = track.sourceTrack;
    const details = [`Source ${source.codec.toUpperCase()}`];

    if (source.language && source.language !== 'und') {
      details.push(formatLanguage(source.language));
    }

    if (source.type === 'audio') {
      const channels = formatSourceChannels(source);
      if (channels) details.push(channels);

      const sampleRate = formatSourceSampleRate(source.sampleRate);
      if (sampleRate) details.push(sampleRate);
    }

    if (source.type === 'video') {
      if (source.width && source.height) {
        details.push(formatResolution(source.width, source.height));
      }

      const frameRate = formatSourceFrameRate(source.frameRate);
      if (frameRate) details.push(frameRate);

      if (source.derivedBitDepth) {
        details.push(`${source.derivedBitDepth}-bit`);
      }
    }

    const bitrate = maybeBitrate(source.bitrate);
    if (bitrate) details.push(bitrate);

    return details;
  }

  function isTrackSelected(trackId: number): boolean {
    return selectedTrackIds.includes(trackId);
  }

  function setTrackSelected(trackId: number, selected: boolean): void {
    if (selected) {
      selectedTracks = {
        fileId: file.id,
        trackIds: selectedTrackIds.includes(trackId) ? selectedTrackIds : [...selectedTrackIds, trackId],
      };
      return;
    }

    selectedTracks = {
      fileId: file.id,
      trackIds: selectedTrackIds.filter((item) => item !== trackId),
    };
  }

  function setAllSelected(selected: boolean): void {
    selectedTracks = {
      fileId: file.id,
      trackIds: selected ? outputTracks.map((track) => track.sourceTrackId) : [],
    };
  }

  function updateTrack(trackId: number, updates: Parameters<typeof updateTranscodeMetadataTrack>[2]): void {
    onUpdateMetadata(updateTranscodeMetadataTrack(file.metadata, trackId, updates));
  }

  function updateContainerTitle(title: string): void {
    onUpdateMetadata({
      ...file.metadata,
      containerTitle: title.trim() ? title : undefined,
    });
  }

  function applyBatchLanguage(): void {
    if (selectedTrackIds.length === 0) return;
    onUpdateMetadata(applyTranscodeMetadataBatch(file.metadata, selectedTrackIds, {
      language: batchLanguage || 'und',
    }));
  }

  function applyBatchTitlePattern(): void {
    if (selectedTrackIds.length === 0) return;
    const pattern = batchTitlePattern.trim();
    if (!pattern) return;

    onUpdateMetadata(applyTranscodeMetadataBatch(file.metadata, selectedTrackIds, {}, pattern));
  }

  function clearBatchTitle(): void {
    if (selectedTrackIds.length === 0) return;
    onUpdateMetadata(applyTranscodeMetadataBatch(file.metadata, selectedTrackIds, {}, ''));
  }

  function applyBatchFlag(flag: 'default' | 'forced', value: boolean): void {
    if (selectedTrackIds.length === 0) return;
    onUpdateMetadata(applyTranscodeMetadataBatch(file.metadata, selectedTrackIds, {
      [flag]: value,
    }));
  }
</script>

<div class="space-y-4">
  <Card.Root>
    <Card.Content>
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <Layers class="size-4 text-muted-foreground" />
            <p class="text-sm font-medium">Output metadata</p>
            <Badge variant="outline">{selectedContainer?.label ?? file.profile.containerId.toUpperCase()}</Badge>
            <Badge variant="secondary">{outputTracks.length} output track{outputTracks.length === 1 ? '' : 's'}</Badge>
            {#if schema.clearsMatroskaStatistics}
              <Badge variant="outline">Matroska stale stats cleared</Badge>
            {/if}
          </div>
          <p class="text-xs text-muted-foreground">
            Edit the metadata that will be written to the transcoded output.
          </p>
        </div>

        <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
          {#if schema.supportsContainerTitle}
            <div class="min-w-56 space-y-1">
              <Label for="metadata-container-title" class="text-xs">Output title</Label>
              <Input
                id="metadata-container-title"
                value={file.metadata.containerTitle ?? ''}
                placeholder="Optional file title"
                disabled={isProcessing}
                oninput={(event) => updateContainerTitle(event.currentTarget.value)}
                class="h-8"
              />
            </div>
          {/if}

          <Button
            variant="outline"
            size="sm"
            onclick={onResetMetadata}
            disabled={isProcessing || !onResetMetadata}
          >
            <RotateCcw class="mr-2 size-3.5" />
            Reset from source
          </Button>
        </div>
      </div>
    </Card.Content>
  </Card.Root>

  {#if outputTracks.length > 0}
    <Card.Root class={selectedCount > 0 ? 'border-primary/50' : undefined}>
      <Card.Content>
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label class="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={selectedCount === outputTracks.length}
              indeterminate={selectedCount > 0 && selectedCount < outputTracks.length}
              onCheckedChange={(checked) => setAllSelected(Boolean(checked))}
              disabled={isProcessing}
            />
            <span>{selectedCount > 0 ? `${selectedCount} selected` : 'Select tracks for batch editing'}</span>
          </label>

          {#if selectedCount > 0}
            <div class="flex flex-col gap-2 xl:flex-row xl:items-end">
              {#if schema.supportsLanguage}
                <div class="space-y-1">
                  <Label class="text-xs">Batch language</Label>
                  <div class="flex gap-2">
                    <Select.Root
                      type="single"
                      value={batchLanguage}
                      onValueChange={(value) => batchLanguage = value}
                      disabled={isProcessing}
                    >
                      <Select.Trigger class="h-8 w-36">
                        {formatLanguage(batchLanguage)}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          {#each COMMON_LANGUAGES as language (language.code)}
                            <Select.Item value={language.code}>{language.label}</Select.Item>
                          {/each}
                        </Select.Group>
                      </Select.Content>
                    </Select.Root>
                    <Button variant="outline" size="sm" onclick={applyBatchLanguage} disabled={isProcessing}>
                      Apply
                    </Button>
                  </div>
                </div>
              {/if}

              {#if schema.supportsTrackTitle}
                <div class="space-y-1">
                  <Label for="metadata-title-pattern" class="text-xs">Title pattern</Label>
                  <div class="flex gap-2">
                    <Input
                      id="metadata-title-pattern"
                      value={batchTitlePattern}
                      placeholder={'English Audio {n}'}
                      oninput={(event) => batchTitlePattern = event.currentTarget.value}
                      disabled={isProcessing}
                      class="h-8 w-44"
                    />
                    <Button variant="outline" size="sm" onclick={applyBatchTitlePattern} disabled={isProcessing}>
                      Apply
                    </Button>
                    <Button variant="ghost" size="sm" onclick={clearBatchTitle} disabled={isProcessing}>
                      Clear
                    </Button>
                  </div>
                </div>
              {/if}

              {#if schema.supportsDefault || schema.supportsForced}
                <div class="flex flex-wrap gap-2">
                  {#if schema.supportsDefault}
                    <Button variant="outline" size="sm" onclick={() => applyBatchFlag('default', true)} disabled={isProcessing}>
                      Set default
                    </Button>
                    <Button variant="ghost" size="sm" onclick={() => applyBatchFlag('default', false)} disabled={isProcessing}>
                      Clear default
                    </Button>
                  {/if}
                  {#if schema.supportsForced}
                    <Button variant="outline" size="sm" onclick={() => applyBatchFlag('forced', true)} disabled={isProcessing}>
                      Set forced
                    </Button>
                    <Button variant="ghost" size="sm" onclick={() => applyBatchFlag('forced', false)} disabled={isProcessing}>
                      Clear forced
                    </Button>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </Card.Content>
    </Card.Root>

    <div class="space-y-3">
      {#each groupedTracks as [type, tracks] (type)}
        <Card.Root>
          <Card.Header class="border-b pb-3">
            <Card.Title>{formatTypeLabel(type)}</Card.Title>
            <Card.Action>
              <Badge variant="secondary">{tracks.length}</Badge>
            </Card.Action>
          </Card.Header>

          <Card.Content class="divide-y p-0">
            {#each tracks as track (track.key)}
              <div class="grid gap-3 p-3 xl:grid-cols-[minmax(14rem,1fr)_minmax(13rem,1.2fr)_9rem_10rem] xl:items-center">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <Checkbox
                      checked={isTrackSelected(track.sourceTrackId)}
                      onCheckedChange={(checked) => setTrackSelected(track.sourceTrackId, Boolean(checked))}
                      disabled={isProcessing}
                    />
                    <Badge variant="outline">#{track.outputIndex}</Badge>
                    <p class="truncate text-sm font-medium">{track.codec.toUpperCase()}</p>
                    <Badge variant={track.mode === 'copy' ? 'secondary' : 'default'}>{formatModeLabel(track)}</Badge>
                    {#if schema.supportsDefault && track.metadata.default}
                      <Badge>Default</Badge>
                    {/if}
                    {#if schema.supportsForced && track.metadata.forced}
                      <Badge variant="destructive">Forced</Badge>
                    {/if}
                  </div>
                  <p class="mt-1 truncate text-xs text-muted-foreground">{getSourceLabel(track)}</p>
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    {#each getSourceDetails(track) as detail (detail)}
                      <Badge variant="outline" class="px-1.5 py-0 text-[11px] font-normal text-muted-foreground">
                        {detail}
                      </Badge>
                    {/each}
                  </div>
                </div>

                {#if schema.supportsTrackTitle}
                  <div class="space-y-1">
                    <Label for={`metadata-title-${track.sourceTrackId}`} class="text-xs">Title</Label>
                    <Input
                      id={`metadata-title-${track.sourceTrackId}`}
                      value={track.metadata.title ?? ''}
                      placeholder="Track title"
                      disabled={isProcessing}
                      oninput={(event) => updateTrack(track.sourceTrackId, { title: event.currentTarget.value })}
                      class="h-8"
                    />
                  </div>
                {/if}

                {#if schema.supportsLanguage}
                  <div class="space-y-1">
                    <Label class="text-xs">Language</Label>
                    <Select.Root
                      type="single"
                      value={track.metadata.language ?? 'und'}
                      onValueChange={(value) => updateTrack(track.sourceTrackId, { language: value })}
                      disabled={isProcessing}
                    >
                      <Select.Trigger class="h-8">
                        {formatLanguage(track.metadata.language ?? 'und')}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          {#each COMMON_LANGUAGES as language (language.code)}
                            <Select.Item value={language.code}>{language.label}</Select.Item>
                          {/each}
                        </Select.Group>
                      </Select.Content>
                    </Select.Root>
                  </div>
                {/if}

                {#if schema.supportsDefault || schema.supportsForced}
                  <div class="flex flex-wrap gap-3">
                    {#if schema.supportsDefault}
                      <label class="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={track.metadata.default ?? false}
                          onCheckedChange={(checked) => updateTrack(track.sourceTrackId, { default: Boolean(checked) })}
                          disabled={isProcessing}
                        />
                        <span>Default</span>
                      </label>
                    {/if}

                    {#if schema.supportsForced}
                      <label class="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={track.metadata.forced ?? false}
                          onCheckedChange={(checked) => updateTrack(track.sourceTrackId, { forced: Boolean(checked) })}
                          disabled={isProcessing}
                        />
                        <span>Forced</span>
                      </label>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  {:else}
    <Empty.Root class="border p-4">
      <Empty.Description>No output tracks are enabled for the current transcode profile.</Empty.Description>
    </Empty.Root>
  {/if}
</div>
