<script lang="ts">
  import { convertFileSrc } from '@tauri-apps/api/core';
  import { ChevronLeft, ChevronRight, ImageOff } from '@lucide/svelte';
  import { useId } from 'bits-ui';

  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Field from '$lib/components/ui/field';
  import * as Item from '$lib/components/ui/item';
  import { Progress } from '$lib/components/ui/progress';
  import { Textarea } from '$lib/components/ui/textarea';
  import type { SubtitleOcrCue, SubtitleOcrCueBitmap } from '$lib/types';
  import { cn } from '$lib/utils';

  interface SubtitleOcrCueCardProps {
    cue: SubtitleOcrCue | null;
    bitmap: SubtitleOcrCueBitmap | null;
    selected?: boolean;
    mode: 'compact' | 'wide';
    disabled?: boolean;
    cueIndex?: number;
    showNavigation?: boolean;
    onSelectCue?: (cueId: string) => void;
    onPreviousCue?: () => void;
    onNextCue?: () => void;
    onTextChange: (cueId: string, value: string) => void;
  }

  let {
    cue,
    bitmap,
    selected = false,
    mode,
    disabled = false,
    cueIndex,
    showNavigation = false,
    onSelectCue,
    onPreviousCue,
    onNextCue,
    onTextChange,
  }: SubtitleOcrCueCardProps = $props();

  const textAreaId = `${useId()}-subtitle-ocr-cue-text`;
  const THUMBNAIL_URL_PATH = /^(?:https?:\/\/|data:|blob:|\/\/)/i;
  const confidencePercent = $derived(
    cue ? Math.max(0, Math.min(100, Math.round(cue.confidence * 100))) : 0,
  );

  function resolveThumbnailSrc(thumbnailPath: string): string {
    return THUMBNAIL_URL_PATH.test(thumbnailPath) ? thumbnailPath : convertFileSrc(thumbnailPath);
  }

  function formatTime(ms: number): string {
    const safeMs = Math.max(0, Math.round(ms));
    const totalSeconds = Math.floor(safeMs / 1_000);
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = safeMs % 1_000;

    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0'),
    ].join(':') + `.${milliseconds.toString().padStart(3, '0')}`;
  }

  function handleTextInput(event: Event): void {
    if (!cue || !(event.currentTarget instanceof HTMLTextAreaElement)) {
      return;
    }

    onTextChange(cue.id, event.currentTarget.value);
  }

  function handleSelect(): void {
    if (cue) {
      onSelectCue?.(cue.id);
    }
  }
</script>

<article
  class={cn(
    'grid min-w-0 gap-3',
    mode === 'compact'
      ? 'grid-rows-[minmax(16rem,1fr)_auto_auto] p-4'
      : 'grid-rows-[auto_auto_minmax(7rem,1fr)]',
  )}
  aria-label={cue ? `Subtitle cue ${cueIndex !== undefined ? cueIndex + 1 : ''}`.trim() : 'No subtitle cue selected'}
  aria-current={selected ? 'true' : undefined}
>
  <div class="relative flex min-h-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-950">
    {#if showNavigation}
      <Button
        type="button"
        variant="outline"
        size="icon"
        class="absolute left-3 z-10 rounded-full bg-background/90"
        aria-label="Previous subtitle cue"
        onclick={onPreviousCue}
        disabled={disabled}
      >
        <ChevronLeft class="size-5" aria-hidden="true" />
      </Button>
    {/if}

    {#if bitmap?.thumbnailPath}
      <img
        src={resolveThumbnailSrc(bitmap.thumbnailPath)}
        alt={cueIndex !== undefined ? `Cue ${cueIndex + 1} bitmap` : 'Selected cue bitmap'}
        loading={selected || mode === 'compact' ? 'eager' : 'lazy'}
        class="max-h-full max-w-full object-contain"
      />
    {:else}
      <span class="flex flex-col items-center gap-2 py-16 text-sm text-zinc-400">
        <ImageOff class="size-6" aria-hidden="true" />
        No thumbnail
      </span>
    {/if}

    {#if showNavigation}
      <Button
        type="button"
        variant="outline"
        size="icon"
        class="absolute right-3 z-10 rounded-full bg-background/90"
        aria-label="Next subtitle cue"
        onclick={onNextCue}
        disabled={disabled}
      >
        <ChevronRight class="size-5" aria-hidden="true" />
      </Button>
    {/if}
  </div>

  {#if cue}
    <Item.Root variant="outline" size="sm" class={cn(selected && 'border-primary ring-2 ring-primary/20')}>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          class={cn(String(props.class ?? ''), 'text-left')}
          aria-label="Select subtitle cue"
          onclick={handleSelect}
          disabled={disabled || !onSelectCue}
        >
          <Item.Content>
            <Item.Title>{formatTime(cue.startTimeMs)} - {formatTime(cue.endTimeMs)}</Item.Title>
            <Item.Description class="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Confidence {confidencePercent}%</Badge>
              <span>{cue.sourceCueIds.length} source cue{cue.sourceCueIds.length === 1 ? '' : 's'}</span>
            </Item.Description>
            <Progress value={confidencePercent} class="mt-2 h-1.5" />
          </Item.Content>
        </button>
      {/snippet}
    </Item.Root>

    <Field.Field class="min-h-0">
      <Field.FieldLabel for={textAreaId}>Recognized text</Field.FieldLabel>
      <Textarea
        id={textAreaId}
        value={cue.text}
        disabled={disabled}
        class={cn(
          'min-h-28 overflow-auto font-mono text-sm leading-relaxed',
          mode === 'compact' && 'min-h-36',
        )}
        aria-label="Recognized subtitle text"
        oninput={handleTextInput}
      />
      {#if mode === 'compact'}
        <Field.FieldDescription>
          Edits are kept in the current subtitle OCR draft.
        </Field.FieldDescription>
      {/if}
    </Field.Field>
  {:else}
    <Item.Root variant="outline">
      <Item.Content>
        <Item.Title>No cue selected</Item.Title>
        <Item.Description>Select a subtitle cue to review and edit its text.</Item.Description>
      </Item.Content>
    </Item.Root>
  {/if}
</article>
