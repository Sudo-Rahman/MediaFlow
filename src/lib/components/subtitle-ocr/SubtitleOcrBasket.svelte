<script lang="ts">
  import { MessageSquareText } from '@lucide/svelte';
  import { useId } from 'bits-ui';

  import { Badge } from '$lib/components/ui/badge';
  import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '$lib/components/ui/empty';
  import * as Field from '$lib/components/ui/field';
  import * as Item from '$lib/components/ui/item';
  import { Progress } from '$lib/components/ui/progress';
  import { Textarea } from '$lib/components/ui/textarea';
  import type { SubtitleOcrCue } from '$lib/types';

  interface SubtitleOcrBasketProps {
    cue: SubtitleOcrCue | null;
    disabled?: boolean;
    onTextChange: (cueId: string, value: string) => void;
  }

  let {
    cue,
    disabled = false,
    onTextChange,
  }: SubtitleOcrBasketProps = $props();

  const textAreaId = `${useId()}-subtitle-text`;
  const confidencePercent = $derived(
    cue ? Math.max(0, Math.min(100, Math.round(cue.confidence * 100))) : 0,
  );

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
</script>

<section class="flex h-full min-h-0 flex-col gap-4 px-4 py-3" aria-label="Subtitle OCR cue editor">
  <div class="flex items-center gap-2">
    <MessageSquareText class="size-4 text-muted-foreground" aria-hidden="true" />
    <h3 class="text-sm font-medium">Cue Basket</h3>
  </div>

  {#if cue}
    <Item.Root variant="outline" size="sm" class="shrink-0">
      <Item.Content>
        <Item.Title>{formatTime(cue.startTimeMs)} - {formatTime(cue.endTimeMs)}</Item.Title>
        <Item.Description class="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Confidence {confidencePercent}%</Badge>
          <span>{cue.sourceCueIds.length} source cue{cue.sourceCueIds.length === 1 ? '' : 's'}</span>
        </Item.Description>
        <Progress value={confidencePercent} class="mt-2 h-1.5" />
      </Item.Content>
    </Item.Root>

    <Field.Field class="min-h-0 flex-1">
      <Field.FieldLabel for={textAreaId}>Recognized text</Field.FieldLabel>
      <Textarea
        id={textAreaId}
        value={cue.text}
        disabled={disabled}
        class="min-h-48 flex-1 overflow-auto font-mono text-sm leading-relaxed"
        aria-label="Recognized subtitle text"
        placeholder="Enter subtitle text"
        oninput={handleTextInput}
      />
      <Field.FieldDescription>
        Edits are kept in the current subtitle OCR draft.
      </Field.FieldDescription>
    </Field.Field>
  {:else}
    <Empty class="min-h-64 border">
      <EmptyHeader>
        <EmptyTitle>No cue selected</EmptyTitle>
        <EmptyDescription>
          Select a subtitle cue from the filmstrip to review and edit its text.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  {/if}
</section>
