<script lang="ts" module>
  export interface SubtitleOcrCueNavigationState {
    disabled: boolean;
    hasHandler: boolean;
  }

  export interface SubtitleOcrCueTextEditState {
    disabled: boolean;
    textDisabled: boolean;
  }

  export interface SubtitleOcrCueTextCommitState extends SubtitleOcrCueTextEditState {
    currentText: string;
    nextText: string;
  }

  export function canNavigateSubtitleOcrCue({
    disabled,
    hasHandler,
  }: SubtitleOcrCueNavigationState): boolean {
    return !disabled && hasHandler;
  }

  export function canEditSubtitleOcrCueText({
    disabled,
    textDisabled,
  }: SubtitleOcrCueTextEditState): boolean {
    return !disabled && !textDisabled;
  }

  export function shouldCommitSubtitleOcrCueText({
    disabled,
    textDisabled,
    currentText,
    nextText,
  }: SubtitleOcrCueTextCommitState): boolean {
    return canEditSubtitleOcrCueText({ disabled, textDisabled }) && currentText !== nextText;
  }
</script>

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
    textDisabled?: boolean;
    cueIndex?: number;
    showNavigation?: boolean;
    onSelectCue?: (cueId: string) => void;
    onPreviousCue?: () => void;
    onNextCue?: () => void;
    onTextCommit: (cueId: string, value: string) => void;
  }

  let {
    cue,
    bitmap,
    selected = false,
    mode,
    disabled = false,
    textDisabled = false,
    cueIndex,
    showNavigation = false,
    onSelectCue,
    onPreviousCue,
    onNextCue,
    onTextCommit,
  }: SubtitleOcrCueCardProps = $props();

  let textValue = $state('');
  let textCueId = $state<string | null>(null);
  let textFocused = $state(false);

  const textAreaId = `${useId()}-subtitle-ocr-cue-text`;
  const BITMAP_URL_PATH = /^(?:[a-z][a-z\d+\-.]*:|\/\/)/i;
  const canSelectCue = $derived(Boolean(cue && onSelectCue && !disabled));
  const canUsePreviousCue = $derived(canNavigateSubtitleOcrCue({
    disabled,
    hasHandler: Boolean(onPreviousCue),
  }));
  const canUseNextCue = $derived(canNavigateSubtitleOcrCue({
    disabled,
    hasHandler: Boolean(onNextCue),
  }));
  const canEditCueText = $derived(canEditSubtitleOcrCueText({ disabled, textDisabled }));
  const bitmapImagePath = $derived(bitmap?.previewPath);
  const confidencePercent = $derived(
    cue ? Math.max(0, Math.min(100, Math.round(cue.confidence * 100))) : 0,
  );

  $effect(() => {
    const nextCueId = cue?.id ?? null;
    const nextText = cue?.text ?? '';
    if (nextCueId !== textCueId || !textFocused) {
      textCueId = nextCueId;
      textValue = nextText;
    }
  });

  function resolveBitmapSrc(bitmapPath: string): string {
    return BITMAP_URL_PATH.test(bitmapPath) ? bitmapPath : convertFileSrc(bitmapPath);
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

  function handleTextFocus(): void {
    textFocused = true;
    handleSelect();
  }

  function handleTextInput(event: Event): void {
    if (!canEditCueText) {
      return;
    }

    if (!cue || !(event.currentTarget instanceof HTMLTextAreaElement)) {
      return;
    }

    textValue = event.currentTarget.value;
  }

  function handleTextBlur(): void {
    textFocused = false;
    if (!cue) {
      return;
    }

    if (!shouldCommitSubtitleOcrCueText({
      disabled,
      textDisabled,
      currentText: cue.text,
      nextText: textValue,
    })) {
      return;
    }

    onTextCommit(cue.id, textValue);
  }

  function handleSelect(): void {
    if (cue && onSelectCue && !disabled) {
      onSelectCue(cue.id);
    }
  }
</script>

<article
  class={cn(
    'grid min-w-0 gap-3 overflow-visible',
    mode === 'compact'
      ? 'grid-rows-[minmax(16rem,1fr)_auto_auto] p-4'
      : 'h-full grid-rows-[12rem_auto_minmax(0,1fr)] rounded-2xl border p-2 text-card-foreground transition-[border-color,box-shadow,background-color]',
    mode === 'wide' && (
      selected
        ? 'border-primary bg-card shadow-md ring-2 ring-primary/20'
        : 'border-transparent bg-transparent'
    ),
  )}
  aria-label={cue ? `Subtitle cue ${cueIndex !== undefined ? cueIndex + 1 : ''}`.trim() : 'No subtitle cue selected'}
  aria-current={selected ? 'true' : undefined}
>
  <div class={cn(
    'relative flex min-h-0 items-center justify-center overflow-hidden rounded-2xl bg-zinc-950',
    mode === 'wide' && 'h-48',
  )}>
    <button
      type="button"
      class="flex size-full min-h-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-inherit disabled:pointer-events-none"
      aria-label="Select subtitle cue"
      onclick={handleSelect}
      disabled={!canSelectCue}
    >
      {#if bitmapImagePath}
        <img
          src={resolveBitmapSrc(bitmapImagePath)}
          alt={cueIndex !== undefined ? `Cue ${cueIndex + 1} bitmap` : 'Selected cue bitmap'}
          loading={selected || mode === 'compact' ? 'eager' : 'lazy'}
          class="max-h-full max-w-full object-contain"
        />
      {:else}
        <span class="flex flex-col items-center gap-2 py-16 text-sm text-zinc-400">
          <ImageOff class="size-6" aria-hidden="true" />
          No preview
        </span>
      {/if}
    </button>

    {#if showNavigation}
      <Button
        type="button"
        variant="outline"
        size="icon"
        class="absolute left-3 z-10 rounded-full bg-background/90"
        aria-label="Previous subtitle cue"
        onclick={onPreviousCue}
        disabled={!canUsePreviousCue}
      >
        <ChevronLeft class="size-5" aria-hidden="true" />
      </Button>
    {/if}

    {#if showNavigation}
      <Button
        type="button"
        variant="outline"
        size="icon"
        class="absolute right-3 z-10 rounded-full bg-background/90"
        aria-label="Next subtitle cue"
        onclick={onNextCue}
        disabled={!canUseNextCue}
      >
        <ChevronRight class="size-5" aria-hidden="true" />
      </Button>
    {/if}
  </div>

  {#if cue}
    <div class="relative">
      <Item.Root
        variant="outline"
        size="sm"
        class={cn(mode === 'compact' && selected && 'border-primary ring-2 ring-primary/20')}
      >
        <Item.Content>
          <Item.Title>{formatTime(cue.startTimeMs)} - {formatTime(cue.endTimeMs)}</Item.Title>
          <Item.Description class="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Confidence {confidencePercent}%</Badge>
            <span>{cue.sourceCueIds.length} source cue{cue.sourceCueIds.length === 1 ? '' : 's'}</span>
          </Item.Description>
          <Progress value={confidencePercent} class="mt-2 h-1.5" />
        </Item.Content>
      </Item.Root>

      {#if canSelectCue}
        <button
          type="button"
          class="absolute inset-0 cursor-pointer appearance-none rounded-2xl border border-transparent bg-transparent p-0 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
          aria-label="Select subtitle cue"
          onclick={handleSelect}
        ></button>
      {/if}
    </div>

    <Field.Field class={cn('min-h-0', mode === 'wide' && 'overflow-visible gap-2 pb-0.5')}>
      <Field.FieldLabel for={textAreaId}>Recognized text</Field.FieldLabel>
      <Textarea
        id={textAreaId}
        value={textValue}
        disabled={!canEditCueText}
        class={cn(
          'min-h-28 overflow-auto font-mono text-sm leading-relaxed',
          mode === 'compact' && 'min-h-36',
          mode === 'wide' && 'min-h-0 flex-1 resize-none',
        )}
        aria-label="Recognized subtitle text"
        onfocus={handleTextFocus}
        oninput={handleTextInput}
        onblur={handleTextBlur}
      />
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
