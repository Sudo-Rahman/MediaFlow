<script lang="ts">
  import { Check, ScanText } from '@lucide/svelte';

  import type { SubtitleOcrModelOverride, SubtitleOcrSourceItem } from '$lib/types';
  import { OCR_LANGUAGES } from '$lib/types/video-ocr';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Field from '$lib/components/ui/field';
  import * as Item from '$lib/components/ui/item';
  import * as Select from '$lib/components/ui/select';
  import { cn } from '$lib/utils';

  import {
    buildSubtitleOcrTrackItem,
    resolveImportButtonLabel,
    toggleTrackSelection,
    type SubtitleOcrImportTrack,
  } from './subtitle-ocr-import-dialog-state';

  interface SubtitleOcrImportTracksDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sourcePath: string;
    tracks: SubtitleOcrImportTrack[];
    onImport: (items: SubtitleOcrSourceItem[]) => void | Promise<void>;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    sourcePath,
    tracks,
    onImport,
    onCancel,
  }: SubtitleOcrImportTracksDialogProps = $props();

  type SelectedTrackState = Record<string, number[]>;
  type OcrModelOverrideState = Record<string, Record<number, SubtitleOcrModelOverride>>;

  let selectedTrackIndicesByKey = $state.raw<SelectedTrackState>({});
  let ocrModelOverridesByKey = $state.raw<OcrModelOverrideState>({});
  let isImporting = $state(false);

  const dialogInstanceId = `subtitle-ocr-import-${Math.random().toString(36).slice(2)}`;

  const trackKey = $derived(`${sourcePath}|${tracks.map((track) => track.streamIndex).join(',')}`);
  const defaultTrackIndices = $derived(tracks.map((track) => track.streamIndex));
  const selectedTrackIndices = $derived.by(() => new Set(selectedTrackIndicesByKey[trackKey] ?? defaultTrackIndices));
  const selectedCount = $derived(selectedTrackIndices.size);
  const importButtonLabel = $derived(resolveImportButtonLabel(selectedCount));

  function getTrackOverride(streamIndex: number): SubtitleOcrModelOverride {
    return ocrModelOverridesByKey[trackKey]?.[streamIndex] ?? 'default';
  }

  function getModelLabel(value: SubtitleOcrModelOverride): string {
    if (value === 'default') {
      return 'Default';
    }

    return OCR_LANGUAGES.find((language) => language.value === value)?.label ?? value;
  }

  function setTrackOverride(streamIndex: number, value: string | undefined) {
    if (!value) return;
    ocrModelOverridesByKey = {
      ...ocrModelOverridesByKey,
      [trackKey]: {
        ...ocrModelOverridesByKey[trackKey],
        [streamIndex]: value as SubtitleOcrModelOverride,
      },
    };
  }

  function toggleTrack(streamIndex: number) {
    const nextSelection = toggleTrackSelection(selectedTrackIndices, streamIndex);
    selectedTrackIndicesByKey = {
      ...selectedTrackIndicesByKey,
      [trackKey]: [...nextSelection],
    };
  }

  function clearDialogState() {
    const { [trackKey]: _selected, ...nextSelectedTrackIndicesByKey } = selectedTrackIndicesByKey;
    const { [trackKey]: _overrides, ...nextOcrModelOverridesByKey } = ocrModelOverridesByKey;
    selectedTrackIndicesByKey = nextSelectedTrackIndicesByKey;
    ocrModelOverridesByKey = nextOcrModelOverridesByKey;
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      clearDialogState();
      isImporting = false;
    }

    onOpenChange(nextOpen);
  }

  function handleCancel() {
    onCancel?.();
    handleOpenChange(false);
  }

  async function handleImport() {
    if (selectedCount === 0 || isImporting) return;

    isImporting = true;
    const items = tracks
      .filter((track) => selectedTrackIndices.has(track.streamIndex))
      .map((track) => buildSubtitleOcrTrackItem(
        sourcePath,
        track,
        getTrackOverride(track.streamIndex),
      ));

    try {
      await onImport(items);
      handleOpenChange(false);
    } finally {
      isImporting = false;
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
    <Dialog.Header class="shrink-0">
      <Dialog.Title class="flex items-center gap-2">
        <ScanText class="size-5" />
        Import Subtitle Tracks
      </Dialog.Title>
      <Dialog.Description>
        Select embedded bitmap subtitle tracks and choose an OCR model override per track.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-scroll-body flex flex-col gap-3 py-4">
      {#each tracks as track (track.streamIndex)}
        {@const isSelected = selectedTrackIndices.has(track.streamIndex)}
        {@const modelSelectId = `${dialogInstanceId}-model-${track.streamIndex}`}
        <Item.Root
          variant={isSelected ? 'outline' : 'default'}
          size="sm"
          class={cn(
            'relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 hover:bg-muted/50 sm:grid-cols-[auto_minmax(0,1fr)_14rem]',
            isSelected && 'border-primary bg-card ring-1 ring-primary/20 hover:bg-card',
          )}
        >
          <button
            type="button"
            class="absolute inset-0 z-0 rounded-[inherit] text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-pressed={isSelected}
            aria-label={`Select track ${track.streamIndex}`}
            onclick={() => toggleTrack(track.streamIndex)}
          ></button>

          <Item.Media class="relative z-10 col-start-1 row-start-1 mt-0.5 pointer-events-none">
            <span
              class={cn(
                'flex size-5 items-center justify-center rounded-full border-2',
                isSelected ? 'border-primary bg-primary' : 'border-muted-foreground',
              )}
            >
              {#if isSelected}
                <Check class="size-3 text-primary-foreground" />
              {/if}
            </span>
          </Item.Media>

          <Item.Content class="relative z-10 col-start-2 row-start-1 min-w-0 pointer-events-none">
            <Item.Title>
              Track {track.streamIndex}
            </Item.Title>
            <Item.Description class="text-xs">
              {track.codecLabel} bitmap subtitle track
            </Item.Description>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline" class="text-[10px] px-1.5 py-0">
                Stream {track.streamIndex}
              </Badge>
              <Badge variant="outline" class="text-[10px] px-1.5 py-0">
                {track.codec}
              </Badge>
              {#if track.language}
                <Badge variant="secondary" class="text-[10px] px-1.5 py-0">
                  {track.language}
                </Badge>
              {/if}
              {#if track.title}
                <Badge variant="secondary" class="text-[10px] px-1.5 py-0">
                  {track.title}
                </Badge>
              {/if}
              {#if track.forced}
                <Badge class="text-[10px] px-1.5 py-0">
                  Forced
                </Badge>
              {/if}
              {#if track.default}
                <Badge variant="secondary" class="text-[10px] px-1.5 py-0">
                  Default
                </Badge>
              {/if}
            </div>
          </Item.Content>

          <Field.Field class="relative z-20 col-start-2 row-start-2 mt-3 sm:col-start-3 sm:row-start-1 sm:mt-0">
            <Field.FieldLabel for={modelSelectId} class="text-xs">OCR model</Field.FieldLabel>
            <Select.Root
              type="single"
              value={getTrackOverride(track.streamIndex)}
              onValueChange={(value) => setTrackOverride(track.streamIndex, value)}
            >
              <Select.Trigger id={modelSelectId} class="w-full">
                {getModelLabel(getTrackOverride(track.streamIndex))}
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  <Select.Item value="default">Default</Select.Item>
                  {#each OCR_LANGUAGES as language (language.value)}
                    <Select.Item value={language.value}>
                      <span>{language.label}</span>
                      <span class="ml-2 text-xs text-muted-foreground">{language.description}</span>
                    </Select.Item>
                  {/each}
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </Field.Field>
        </Item.Root>
      {/each}
    </div>

    <Dialog.Footer class="shrink-0">
      <Button variant="outline" onclick={handleCancel} disabled={isImporting}>
        Cancel
      </Button>
      <Button onclick={() => void handleImport()} disabled={selectedCount === 0 || isImporting}>
        {importButtonLabel}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
