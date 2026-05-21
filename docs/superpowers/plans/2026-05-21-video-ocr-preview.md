# Video OCR Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign only the Video OCR preview so player controls, edit actions, and generated OCR cue previews no longer overlap the video image or OCR regions.

**Architecture:** Keep `VideoPreview.svelte` as the owner of playback, edit/draw state, fullscreen, and layer visibility. Move pure cue-selection logic into a testable TypeScript helper, add focused preview-only Svelte components for toolbar, active cue summary, and player controls, then wire them into the existing preview without touching `OcrTimeline.svelte`.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest, shadcn-svelte `Button`, `Popover`, `ScrollArea`, `Slider`, Lucide Svelte icons.

---

## File Structure

- Create `src/lib/components/video-ocr/preview-cues.ts`
  - Owns active OCR cue selection, role labels, confidence formatting, and compact cue summary data.
  - Pure TypeScript so the layer contract can be regression-tested without Svelte DOM tooling.
- Create `src/lib/components/video-ocr/preview-cues.test.ts`
  - Covers selected-zone priority, main subtitle fallback, on-screen text fallback, multiple active cue counts, and no-active-cue state.
- Create `src/lib/components/video-ocr/PreviewToolbar.svelte`
  - Renders preview state text and Save/Cancel actions outside the video image.
- Create `src/lib/components/video-ocr/ActiveCueSummary.svelte`
  - Renders one fixed-height cue row and a popover for all active cues.
- Create `src/lib/components/video-ocr/PreviewPlayerControls.svelte`
  - Renders custom transport controls, seek slider, volume popover, and fullscreen button.
- Modify `src/lib/components/video-ocr/RegionSelector.svelte`
  - Remove persistent instruction banner from the video image.
- Modify `src/lib/components/video-ocr/VideoPreview.svelte`
  - Remove native `controls`.
  - Stop default over-video `SubtitleOverlay` rendering.
  - Add the preview stack: toolbar, video image, compact cue row, custom controls.
  - Keep all changes local to the preview component.
- Modify `src/lib/components/video-ocr/index.ts`
  - Export new preview-only components to match the existing Video OCR component barrel pattern.

Do not modify:

- `src/lib/components/video-ocr/OcrTimeline.svelte`
- `src/lib/components/video-ocr/VideoOcrWorkspace.svelte`
- OCR storage, OCR processing, export, or data model files.

## Task 1: Pure Active Cue Helper

**Files:**
- Create: `src/lib/components/video-ocr/preview-cues.ts`
- Create: `src/lib/components/video-ocr/preview-cues.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/components/video-ocr/preview-cues.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { OcrSubtitle, VideoOcrSelection } from '$lib/types';
import {
  buildActiveCueSummary,
  formatCueConfidence,
  roleLabelForCue,
} from './preview-cues';

const selection: VideoOcrSelection = {
  segments: [
    {
      id: 'segment-main',
      startTimeMs: 1_000,
      endTimeMs: 5_000,
      zones: [
        {
          id: 'zone-main-1',
          role: 'main_subtitle',
          label: 'Main line',
          region: { x: 0.1, y: 0.75, width: 0.8, height: 0.12 },
        },
        {
          id: 'zone-main-2',
          role: 'main_subtitle',
          label: 'Alt line',
          region: { x: 0.15, y: 0.86, width: 0.7, height: 0.1 },
        },
        {
          id: 'zone-text',
          role: 'on_screen_text',
          label: 'Sign',
          region: { x: 0.65, y: 0.35, width: 0.2, height: 0.1 },
        },
      ],
    },
  ],
};

const subtitles: OcrSubtitle[] = [
  {
    id: 'cue-main-1',
    text: 'Primary subtitle text',
    startTime: 1_000,
    endTime: 4_000,
    confidence: 0.923,
    segmentId: 'segment-main',
    zoneId: 'zone-main-1',
    role: 'main_subtitle',
  },
  {
    id: 'cue-main-2',
    text: 'Second subtitle line',
    startTime: 1_000,
    endTime: 4_000,
    confidence: 0.881,
    segmentId: 'segment-main',
    zoneId: 'zone-main-2',
    role: 'main_subtitle',
  },
  {
    id: 'cue-text',
    text: 'pupu',
    startTime: 1_000,
    endTime: 4_000,
    confidence: 0.794,
    segmentId: 'segment-main',
    zoneId: 'zone-text',
    role: 'on_screen_text',
  },
];

describe('preview cue helpers', () => {
  it('prioritizes the selected zone when it has an active cue', () => {
    const summary = buildActiveCueSummary({
      subtitles,
      selection,
      timeMs: 2_000,
      selectedZoneId: 'zone-main-2',
    });

    expect(summary.primaryCue?.subtitle.id).toBe('cue-main-2');
    expect(summary.activeCues.map((cue) => cue.subtitle.id)).toEqual([
      'cue-main-1',
      'cue-main-2',
      'cue-text',
    ]);
    expect(summary.extraCueCount).toBe(2);
  });

  it('falls back to the first active main subtitle cue by selection order', () => {
    const summary = buildActiveCueSummary({
      subtitles,
      selection,
      timeMs: 2_000,
      selectedZoneId: null,
    });

    expect(summary.primaryCue?.subtitle.id).toBe('cue-main-1');
    expect(summary.extraCueCount).toBe(2);
  });

  it('falls back to on-screen text when no main subtitle cue is active', () => {
    const summary = buildActiveCueSummary({
      subtitles: subtitles.filter((subtitle) => subtitle.role === 'on_screen_text'),
      selection,
      timeMs: 2_000,
      selectedZoneId: null,
    });

    expect(summary.primaryCue?.subtitle.id).toBe('cue-text');
    expect(summary.primaryCue ? roleLabelForCue(summary.primaryCue) : '').toBe('On-screen text - Sign');
    expect(summary.extraCueCount).toBe(0);
  });

  it('returns no primary cue when nothing is active at the current time', () => {
    const summary = buildActiveCueSummary({
      subtitles,
      selection,
      timeMs: 6_000,
      selectedZoneId: 'zone-main-1',
    });

    expect(summary.primaryCue).toBeNull();
    expect(summary.activeCues).toEqual([]);
    expect(summary.extraCueCount).toBe(0);
  });

  it('formats confidence values as percentages', () => {
    expect(formatCueConfidence(0.923)).toBe('92%');
    expect(formatCueConfidence(2)).toBe('100%');
    expect(formatCueConfidence(-1)).toBe('0%');
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm test -- src/lib/components/video-ocr/preview-cues.test.ts
```

Expected: FAIL because `./preview-cues` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/components/video-ocr/preview-cues.ts`:

```ts
import type { OcrSubtitle, OcrZone, OcrZoneRole, VideoOcrSelection } from '$lib/types';

export interface ActiveCueInput {
  subtitles: OcrSubtitle[];
  selection: VideoOcrSelection;
  timeMs: number;
  selectedZoneId?: string | null;
}

export interface ActivePreviewCue {
  subtitle: OcrSubtitle;
  zone: OcrZone | null;
  zoneIndex: number;
  segmentIndex: number;
}

export interface ActiveCueSummary {
  primaryCue: ActivePreviewCue | null;
  activeCues: ActivePreviewCue[];
  extraCueCount: number;
}

function rolePriority(role?: OcrZoneRole): number {
  if (role === 'main_subtitle') return 0;
  if (role === 'on_screen_text') return 1;
  return 2;
}

function isSubtitleActive(subtitle: OcrSubtitle, timeMs: number): boolean {
  return timeMs >= subtitle.startTime && timeMs <= subtitle.endTime;
}

function findZoneContext(
  selection: VideoOcrSelection,
  segmentId: string | undefined,
  zoneId: string | undefined,
): Pick<ActivePreviewCue, 'zone' | 'zoneIndex' | 'segmentIndex'> {
  const segmentIndex = selection.segments.findIndex((segment) => segment.id === segmentId);
  const segment = segmentIndex >= 0 ? selection.segments[segmentIndex] : null;
  const zoneIndex = segment?.zones.findIndex((zone) => zone.id === zoneId) ?? -1;

  return {
    zone: zoneIndex >= 0 ? segment?.zones[zoneIndex] ?? null : null,
    zoneIndex: zoneIndex >= 0 ? zoneIndex : Number.MAX_SAFE_INTEGER,
    segmentIndex: segmentIndex >= 0 ? segmentIndex : Number.MAX_SAFE_INTEGER,
  };
}

function compareActiveCues(left: ActivePreviewCue, right: ActivePreviewCue): number {
  return (
    left.segmentIndex - right.segmentIndex
    || rolePriority(left.subtitle.role ?? left.zone?.role) - rolePriority(right.subtitle.role ?? right.zone?.role)
    || left.zoneIndex - right.zoneIndex
    || left.subtitle.startTime - right.subtitle.startTime
    || left.subtitle.id.localeCompare(right.subtitle.id)
  );
}

export function buildActiveCueSummary({
  subtitles,
  selection,
  timeMs,
  selectedZoneId = null,
}: ActiveCueInput): ActiveCueSummary {
  const activeCues = subtitles
    .filter((subtitle) => isSubtitleActive(subtitle, timeMs))
    .map((subtitle) => ({
      subtitle,
      ...findZoneContext(selection, subtitle.segmentId, subtitle.zoneId),
    }))
    .sort(compareActiveCues);

  const selectedCue = selectedZoneId
    ? activeCues.find((cue) => cue.subtitle.zoneId === selectedZoneId) ?? null
    : null;
  const primaryCue = selectedCue ?? activeCues[0] ?? null;

  return {
    primaryCue,
    activeCues,
    extraCueCount: primaryCue ? Math.max(0, activeCues.length - 1) : 0,
  };
}

export function roleLabelForCue(cue: ActivePreviewCue): string {
  const role = cue.subtitle.role ?? cue.zone?.role;
  const roleLabel = role === 'main_subtitle' ? 'Main subtitle' : 'On-screen text';
  const zoneLabel = cue.zone?.label?.trim() || `Zone ${Number.isFinite(cue.zoneIndex) ? cue.zoneIndex + 1 : 1}`;
  return `${roleLabel} - ${zoneLabel}`;
}

export function formatCueConfidence(confidence: number): string {
  const normalized = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  return `${Math.round(normalized * 100)}%`;
}
```

- [ ] **Step 4: Run the helper tests**

Run:

```bash
pnpm test -- src/lib/components/video-ocr/preview-cues.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/lib/components/video-ocr/preview-cues.ts src/lib/components/video-ocr/preview-cues.test.ts
git commit -m "test: add video OCR preview cue helpers"
```

## Task 2: Preview Toolbar and Region Selector Cleanup

**Files:**
- Create: `src/lib/components/video-ocr/PreviewToolbar.svelte`
- Modify: `src/lib/components/video-ocr/RegionSelector.svelte`

- [ ] **Step 1: Create the toolbar component**

Create `src/lib/components/video-ocr/PreviewToolbar.svelte`:

```svelte
<script lang="ts">
  import { Check, X } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';

  interface PreviewToolbarProps {
    title?: string;
    description?: string;
    showCancel?: boolean;
    showSave?: boolean;
    saveDisabled?: boolean;
    oncancel?: () => void;
    onsave?: () => void;
    class?: string;
  }

  let {
    title = 'Video preview',
    description = '',
    showCancel = false,
    showSave = false,
    saveDisabled = false,
    oncancel,
    onsave,
    class: className = '',
  }: PreviewToolbarProps = $props();
</script>

<div class={cn('flex min-h-11 items-center justify-between gap-3 border-b bg-background px-3 py-2', className)}>
  <div class="min-w-0">
    <p class="truncate text-sm font-medium text-foreground">{title}</p>
    {#if description}
      <p class="truncate text-xs text-muted-foreground">{description}</p>
    {/if}
  </div>

  {#if showCancel || showSave}
    <div class="flex shrink-0 items-center gap-2">
      {#if showCancel}
        <Button type="button" variant="secondary" size="sm" onclick={oncancel}>
          <X class="size-3.5" aria-hidden="true" />
          Cancel
        </Button>
      {/if}
      {#if showSave}
        <Button type="button" size="sm" disabled={saveDisabled} onclick={onsave}>
          <Check class="size-3.5" aria-hidden="true" />
          Save
        </Button>
      {/if}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Remove persistent video-image instructions from RegionSelector**

In `src/lib/components/video-ocr/RegionSelector.svelte`, delete the final instruction block:

```svelte
  <!-- Instructions -->
  <div class="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-3 py-1.5 rounded text-sm pointer-events-none">
    {#if region && region.width > 0}
      Drag region to move, use handles to resize
    {:else if !allowCreate}
      Select an existing zone to edit
    {:else}
      Click and drag to select OCR region
    {/if}
  </div>
```

Keep the overlay, region rectangle, handles, and mouse logic unchanged.

- [ ] **Step 3: Run Svelte/TypeScript checking**

Run:

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 4: Commit Task 2**

Run:

```bash
git add src/lib/components/video-ocr/PreviewToolbar.svelte src/lib/components/video-ocr/RegionSelector.svelte
git commit -m "feat: move video OCR edit actions out of preview image"
```

## Task 3: Compact Active Cue Summary Component

**Files:**
- Create: `src/lib/components/video-ocr/ActiveCueSummary.svelte`
- Modify: `src/lib/components/video-ocr/index.ts`

- [ ] **Step 1: Create the compact cue row component**

Create `src/lib/components/video-ocr/ActiveCueSummary.svelte`:

```svelte
<script lang="ts">
  import { Captions } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { cn } from '$lib/utils';
  import type { ActiveCueSummary } from './preview-cues';
  import { formatCueConfidence, roleLabelForCue } from './preview-cues';

  interface ActiveCueSummaryProps {
    summary: ActiveCueSummary;
    class?: string;
  }

  let { summary, class: className = '' }: ActiveCueSummaryProps = $props();

  const primaryLabel = $derived(summary.primaryCue ? roleLabelForCue(summary.primaryCue) : 'No active OCR cue');
  const primaryText = $derived(summary.primaryCue?.subtitle.text.trim() || 'No OCR text at current time');
  const hasMultipleCues = $derived(summary.activeCues.length > 1);
</script>

<div class={cn('flex min-h-10 items-center gap-3 border-t bg-muted/35 px-3 py-1.5', className)}>
  <Captions class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

  <div class="min-w-0 flex-1">
    <div class="flex min-w-0 items-center gap-2">
      <span class="shrink-0 text-xs font-medium text-muted-foreground">{primaryLabel}</span>
      <span class="min-w-0 truncate text-sm font-medium text-foreground">{primaryText}</span>
    </div>
  </div>

  {#if hasMultipleCues}
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            type="button"
            variant="secondary"
            size="sm"
            class="h-7 shrink-0 px-2 text-xs"
            aria-label={`Show ${summary.activeCues.length} active OCR cues`}
          >
            {summary.activeCues.length} active cues
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content align="end" side="top" sideOffset={8} class="w-96 max-w-[calc(100vw-2rem)] p-0">
        <Popover.Header class="border-b px-3 py-2">
          <Popover.Title>Active OCR Cues</Popover.Title>
          <Popover.Description>OCR text active at the current playback time.</Popover.Description>
        </Popover.Header>
        <ScrollArea class="max-h-72" scrollbarYClasses="w-2">
          <div class="flex flex-col gap-2 p-3">
            {#each summary.activeCues as cue (`${cue.subtitle.id}:${cue.subtitle.zoneId ?? ''}`)}
              <div class="rounded-md border bg-background p-2">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                    {roleLabelForCue(cue)}
                  </span>
                  <span class="shrink-0 text-xs font-medium text-foreground">
                    {formatCueConfidence(cue.subtitle.confidence)}
                  </span>
                </div>
                <p class="mt-1 whitespace-pre-wrap text-sm text-foreground">{cue.subtitle.text}</p>
              </div>
            {/each}
          </div>
        </ScrollArea>
      </Popover.Content>
    </Popover.Root>
  {/if}
</div>
```

- [ ] **Step 2: Export the preview components**

Open `src/lib/components/video-ocr/index.ts` and add:

```ts
export { default as ActiveCueSummary } from './ActiveCueSummary.svelte';
export { default as PreviewPlayerControls } from './PreviewPlayerControls.svelte';
export { default as PreviewToolbar } from './PreviewToolbar.svelte';
```

- [ ] **Step 3: Run Svelte/TypeScript checking**

Run:

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add src/lib/components/video-ocr/ActiveCueSummary.svelte src/lib/components/video-ocr/index.ts
git commit -m "feat: add compact video OCR cue summary"
```

## Task 4: Custom Preview Player Controls

**Files:**
- Create: `src/lib/components/video-ocr/PreviewPlayerControls.svelte`

- [ ] **Step 1: Create the custom controls component**

Create `src/lib/components/video-ocr/PreviewPlayerControls.svelte`:

```svelte
<script lang="ts">
  import {
    Maximize,
    Pause,
    Play,
    RotateCcw,
    RotateCw,
    Volume2,
    VolumeX,
  } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { Slider } from '$lib/components/ui/slider';
  import { cn } from '$lib/utils';

  interface PreviewPlayerControlsProps {
    currentTime: number;
    duration: number;
    paused: boolean;
    muted: boolean;
    volume: number;
    disabled?: boolean;
    onseek?: (timeSeconds: number) => void;
    ontoggleplay?: () => void;
    onskip?: (deltaSeconds: number) => void;
    ontogglemute?: () => void;
    onvolumechange?: (volume: number) => void;
    onfullscreen?: () => void;
    class?: string;
  }

  let {
    currentTime,
    duration,
    paused,
    muted,
    volume,
    disabled = false,
    onseek,
    ontoggleplay,
    onskip,
    ontogglemute,
    onvolumechange,
    onfullscreen,
    class: className = '',
  }: PreviewPlayerControlsProps = $props();

  let seekValue = $state(0);
  let volumeValue = $state(100);

  const safeDuration = $derived(Number.isFinite(duration) && duration > 0 ? duration : 0);
  const safeCurrentTime = $derived(Math.max(0, Math.min(safeDuration || 0, currentTime || 0)));
  const seekMax = $derived(Math.max(1, safeDuration));
  const volumePercent = $derived(Math.round(Math.max(0, Math.min(1, volume)) * 100));

  $effect(() => {
    seekValue = safeCurrentTime;
  });

  $effect(() => {
    volumeValue = volumePercent;
  });

  function formatTime(seconds: number): string {
    const safeSeconds = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  function handleSeek(value: number): void {
    onseek?.(value);
  }

  function handleVolume(value: number): void {
    onvolumechange?.(Math.max(0, Math.min(1, value / 100)));
  }
</script>

<div class={cn('grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t bg-background px-3 py-2', className)}>
  <div class="flex items-center gap-1.5">
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label="Back 10 seconds"
      title="Back 10 seconds"
      onclick={() => onskip?.(-10)}
    >
      <RotateCcw class="size-4" aria-hidden="true" />
    </Button>
    <Button
      type="button"
      variant="secondary"
      size="icon"
      disabled={disabled}
      aria-label={paused ? 'Play video' : 'Pause video'}
      title={paused ? 'Play' : 'Pause'}
      onclick={ontoggleplay}
    >
      {#if paused}
        <Play class="size-4" aria-hidden="true" />
      {:else}
        <Pause class="size-4" aria-hidden="true" />
      {/if}
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label="Forward 10 seconds"
      title="Forward 10 seconds"
      onclick={() => onskip?.(10)}
    >
      <RotateCw class="size-4" aria-hidden="true" />
    </Button>
  </div>

  <div class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
    <span class="font-mono text-xs tabular-nums text-muted-foreground">{formatTime(safeCurrentTime)}</span>
    <Slider
      value={seekValue}
      min={0}
      max={seekMax}
      step={0.1}
      disabled={disabled || safeDuration <= 0}
      aria-label="Seek video"
      onValueChange={handleSeek}
    />
    <span class="font-mono text-xs tabular-nums text-muted-foreground">{formatTime(safeDuration)}</span>
  </div>

  <div class="flex items-center gap-1.5">
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={muted ? 'Unmute video' : 'Mute video'}
            title={muted ? 'Unmute' : 'Mute'}
            onclick={ontogglemute}
          >
            {#if muted || volumePercent === 0}
              <VolumeX class="size-4" aria-hidden="true" />
            {:else}
              <Volume2 class="size-4" aria-hidden="true" />
            {/if}
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content side="top" align="center" sideOffset={8} class="flex h-36 w-12 items-center justify-center p-3">
        <Slider
          value={volumeValue}
          orientation="vertical"
          min={0}
          max={100}
          step={1}
          aria-label="Video volume"
          onValueChange={handleVolume}
        />
      </Popover.Content>
    </Popover.Root>

    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label="Enter fullscreen"
      title="Fullscreen"
      onclick={onfullscreen}
    >
      <Maximize class="size-4" aria-hidden="true" />
    </Button>
  </div>
</div>
```

- [ ] **Step 2: Run Svelte/TypeScript checking**

Run:

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 3: Commit Task 4**

Run:

```bash
git add src/lib/components/video-ocr/PreviewPlayerControls.svelte
git commit -m "feat: add custom video OCR preview controls"
```

## Task 5: Integrate the New Preview Stack

**Files:**
- Modify: `src/lib/components/video-ocr/VideoPreview.svelte`
- Modify: `src/lib/components/video-ocr/SubtitleOverlay.svelte` only if it becomes unused and needs deletion from imports

- [ ] **Step 1: Update imports in `VideoPreview.svelte`**

Replace the `SubtitleOverlay` import with new preview components and helper:

```ts
import ActiveCueSummary from './ActiveCueSummary.svelte';
import PreviewPlayerControls from './PreviewPlayerControls.svelte';
import PreviewToolbar from './PreviewToolbar.svelte';
import { buildActiveCueSummary } from './preview-cues';
```

Remove:

```ts
import SubtitleOverlay from './SubtitleOverlay.svelte';
```

- [ ] **Step 2: Add playback state**

Inside `VideoPreview.svelte`, near the existing local state, add:

```ts
let isPaused = $state(true);
let isMuted = $state(false);
let volume = $state(1);
```

Add derived selected zone id:

```ts
const selectedZoneId = $derived(editingZone?.zoneId ?? null);
```

Add the cue summary derived value after `currentSubtitle` or replace `currentSubtitle` entirely:

```ts
const activeCueSummary = $derived.by(() => buildActiveCueSummary({
  subtitles: latestSubtitles,
  selection: file?.ocrSelection ?? { segments: [] },
  timeMs: Math.round(currentTime * 1000),
  selectedZoneId,
}));
```

- [ ] **Step 3: Add custom playback handlers**

Add these functions in `VideoPreview.svelte`:

```ts
function syncPlaybackState(): void {
  if (!videoEl) {
    isPaused = true;
    return;
  }

  isPaused = videoEl.paused;
  isMuted = videoEl.muted;
  volume = videoEl.volume;
}

function seekToSeconds(timeSeconds: number): void {
  if (!videoEl) {
    return;
  }

  const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : file?.duration ?? 0;
  const nextTime = Math.max(0, Math.min(duration, timeSeconds));
  videoEl.currentTime = nextTime;
  if (file) {
    currentTimesByFileId = { ...currentTimesByFileId, [file.id]: nextTime };
  }
  onTimeChange?.(Math.round(nextTime * 1000));
}

function skipBySeconds(deltaSeconds: number): void {
  seekToSeconds((videoEl?.currentTime ?? currentTime) + deltaSeconds);
}

function togglePlayback(): void {
  if (!videoEl) {
    return;
  }

  if (videoEl.paused) {
    void videoEl.play().then(syncPlaybackState).catch(() => {
      syncPlaybackState();
    });
    return;
  }

  videoEl.pause();
  syncPlaybackState();
}

function toggleMute(): void {
  if (!videoEl) {
    return;
  }

  videoEl.muted = !videoEl.muted;
  syncPlaybackState();
}

function setVolume(nextVolume: number): void {
  if (!videoEl) {
    return;
  }

  videoEl.volume = Math.max(0, Math.min(1, nextVolume));
  if (videoEl.volume > 0 && videoEl.muted) {
    videoEl.muted = false;
  }
  syncPlaybackState();
}

function enterFullscreen(): void {
  const target = containerEl;
  if (!target?.requestFullscreen) {
    return;
  }

  void target.requestFullscreen();
}
```

Update `handleTimeUpdate()` so it calls `syncPlaybackState()` after updating time:

```ts
function handleTimeUpdate() {
  if (videoEl) {
    const nextTime = videoEl.currentTime;
    if (file) {
      currentTimesByFileId = { ...currentTimesByFileId, [file.id]: nextTime };
    }
    onTimeChange?.(Math.round(nextTime * 1000));
    syncPlaybackState();
  }
}
```

- [ ] **Step 4: Remove native controls from the video element**

Change the `<video>` markup from:

```svelte
<video
  bind:this={videoEl}
  src={videoSrc}
  class="w-full h-full object-contain"
  controls={!isDrawingZone && !isEditingZone}
  ontimeupdate={handleTimeUpdate}
  onloadedmetadata={updateVideoBounds}
  onresize={updateVideoBounds}
  onerror={handleVideoError}
>
</video>
```

To:

```svelte
<video
  bind:this={videoEl}
  src={videoSrc}
  class="h-full w-full object-contain"
  ontimeupdate={handleTimeUpdate}
  onplay={syncPlaybackState}
  onpause={syncPlaybackState}
  onvolumechange={syncPlaybackState}
  onloadedmetadata={() => {
    updateVideoBounds();
    syncPlaybackState();
  }}
  onresize={updateVideoBounds}
  onerror={handleVideoError}
>
</video>
```

- [ ] **Step 5: Replace the preview markup with the stack**

In the `videoSrc` branch of `VideoPreview.svelte`, keep the `ContextMenu.Root` and `ContextMenu.Content`, but make the visual stack:

```svelte
<div class={cn("relative flex min-h-0 h-full flex-col overflow-hidden rounded-lg border bg-background", className)}>
  {#if videoSrc}
    <ContextMenu.Root>
      <PreviewToolbar
        title={isEditingZone
          ? 'Editing OCR zone'
          : isDrawingZone
            ? 'Drawing OCR zone'
            : 'Video preview'}
        description={isEditingZone
          ? 'Drag the region or resize it with handles.'
          : isDrawingZone
            ? 'Drag over the video image to select an OCR region.'
            : 'Right-click the video image to add or modify OCR zones.'}
        showCancel={isDrawingZone || isEditingZone}
        showSave={isEditingZone}
        saveDisabled={!editingRegion}
        oncancel={cancelRegionSelection}
        onsave={saveZoneEditing}
      />

      <ContextMenu.Trigger
        bind:ref={containerEl}
        class="relative min-h-0 flex-1 overflow-hidden bg-black"
        oncontextmenu={handlePreviewContextMenu}
        onpointerenter={() => {
          isPointerInsidePreview = true;
        }}
        onpointerleave={() => {
          isPointerInsidePreview = false;
        }}
      >
        <!-- existing video, zone overlays, live detections, and RegionSelector go here -->
      </ContextMenu.Trigger>

      <ActiveCueSummary summary={activeCueSummary} />

      <PreviewPlayerControls
        currentTime={currentTime}
        duration={videoEl?.duration ?? file?.duration ?? 0}
        paused={isPaused}
        muted={isMuted}
        {volume}
        disabled={isDrawingZone || isEditingZone}
        onseek={seekToSeconds}
        onskip={skipBySeconds}
        ontoggleplay={togglePlayback}
        ontogglemute={toggleMute}
        onvolumechange={setVolume}
        onfullscreen={enterFullscreen}
      />

      <!-- existing ContextMenu.Content remains here -->
    </ContextMenu.Root>
  {/if}
</div>
```

Important markup removals:

- Remove the `{#if showSubtitles && currentSubtitle && !isDrawingZone}` block that renders `<SubtitleOverlay />`.
- Remove the absolute top-right Save/Cancel button block inside the video image.
- Keep the live detections hover button and passive zone outlines, but verify they do not conflict with editing state.

- [ ] **Step 6: Run Svelte/TypeScript checking**

Run:

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add src/lib/components/video-ocr/VideoPreview.svelte src/lib/components/video-ocr/SubtitleOverlay.svelte
git commit -m "feat: integrate compact video OCR preview stack"
```

## Task 6: Layer Contract Regression Coverage

**Files:**
- Modify: `src/lib/components/video-ocr/preview-cues.test.ts`
- Create: `src/lib/components/video-ocr/preview-layer-state.ts`
- Create: `src/lib/components/video-ocr/preview-layer-state.test.ts`
- Modify: `src/lib/components/video-ocr/VideoPreview.svelte`

- [ ] **Step 1: Add pure layer-state helper**

Create `src/lib/components/video-ocr/preview-layer-state.ts`:

```ts
export interface PreviewLayerStateInput {
  isDrawingZone: boolean;
  isEditingZone: boolean;
}

export interface PreviewLayerState {
  showPassiveZones: boolean;
  showRegionSelector: boolean;
  showToolbarActions: boolean;
  showGeneratedSubtitleOverlay: boolean;
}

export function getPreviewLayerState({
  isDrawingZone,
  isEditingZone,
}: PreviewLayerStateInput): PreviewLayerState {
  return {
    showPassiveZones: !isDrawingZone && !isEditingZone,
    showRegionSelector: isDrawingZone || isEditingZone,
    showToolbarActions: isDrawingZone || isEditingZone,
    showGeneratedSubtitleOverlay: false,
  };
}
```

- [ ] **Step 2: Add layer-state tests**

Create `src/lib/components/video-ocr/preview-layer-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { getPreviewLayerState } from './preview-layer-state';

describe('preview layer state', () => {
  it('shows passive zones and never generated subtitle overlay in default state', () => {
    expect(getPreviewLayerState({ isDrawingZone: false, isEditingZone: false })).toEqual({
      showPassiveZones: true,
      showRegionSelector: false,
      showToolbarActions: false,
      showGeneratedSubtitleOverlay: false,
    });
  });

  it('shows only the selector layer while drawing', () => {
    expect(getPreviewLayerState({ isDrawingZone: true, isEditingZone: false })).toEqual({
      showPassiveZones: false,
      showRegionSelector: true,
      showToolbarActions: true,
      showGeneratedSubtitleOverlay: false,
    });
  });

  it('shows only the selector layer while editing', () => {
    expect(getPreviewLayerState({ isDrawingZone: false, isEditingZone: true })).toEqual({
      showPassiveZones: false,
      showRegionSelector: true,
      showToolbarActions: true,
      showGeneratedSubtitleOverlay: false,
    });
  });
});
```

- [ ] **Step 3: Use the layer-state helper in `VideoPreview.svelte`**

In `src/lib/components/video-ocr/VideoPreview.svelte`, import:

```ts
import { getPreviewLayerState } from './preview-layer-state';
```

Add a derived value near the existing state-derived values:

```ts
const previewLayers = $derived(getPreviewLayerState({ isDrawingZone, isEditingZone }));
```

Replace display conditions:

```svelte
{#if !isDrawingZone && !isEditingZone}
```

with:

```svelte
{#if previewLayers.showPassiveZones}
```

Replace:

```svelte
{#if isDrawingZone || isEditingZone}
```

with:

```svelte
{#if previewLayers.showRegionSelector}
```

Do not reintroduce a generated subtitle overlay. The helper should keep `showGeneratedSubtitleOverlay` false.

- [ ] **Step 4: Run narrow tests**

Run:

```bash
pnpm test -- src/lib/components/video-ocr/preview-cues.test.ts src/lib/components/video-ocr/preview-layer-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run Svelte/TypeScript checking**

Run:

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add src/lib/components/video-ocr/VideoPreview.svelte src/lib/components/video-ocr/preview-cues.test.ts src/lib/components/video-ocr/preview-layer-state.ts src/lib/components/video-ocr/preview-layer-state.test.ts
git commit -m "test: cover video OCR preview layer contract"
```

## Task 7: Final Verification

**Files:**
- Verify only; no planned file edits.

- [ ] **Step 1: Run TypeScript/Svelte checks**

Run:

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 2: Run relevant frontend tests**

Run:

```bash
pnpm test -- src/lib/components/video-ocr/preview-cues.test.ts src/lib/stores/video-ocr.test.ts src/lib/utils/ocr-selection.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full frontend tests if the narrow tests pass**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Manual preview validation**

Run the app:

```bash
pnpm dev
```

Expected: Vite starts on port `1420`.

Open the app and validate:

- Native browser video controls do not appear after play, pause, or seek.
- Save/Cancel appear in the preview toolbar, not over the video image.
- RegionSelector no longer shows persistent instructions over the video image.
- Generated OCR cue text appears in the compact row below the image.
- Five active cues keep the row height fixed and open a popover list.
- The audio icon toggles mute, and its vertical slider is reachable by hover/focus.
- Fullscreen keeps controls outside the video image.
- `OcrTimeline.svelte` behavior is unchanged.

- [ ] **Step 5: Stop the dev server**

Stop the `pnpm dev` process from the terminal session.

- [ ] **Step 6: Commit any final fixes**

If verification required fixes, commit them:

```bash
git add src/lib/components/video-ocr
git commit -m "fix: polish video OCR preview controls"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Preview-only scope: covered by file structure and all tasks; no timeline implementation task exists.
- Native controls removed: Task 5.
- Save/Cancel out of image: Task 2 and Task 5.
- Compact cue row and popover: Task 1 and Task 3.
- Custom player controls: Task 4 and Task 5.
- Region selector instructions moved out of image: Task 2.
- Accessibility requirements: Task 3 and Task 4 component APIs include real buttons, labels, popover, and sliders.
- Tests and validation: Task 1, Task 6, and Task 7.

Placeholder scan:

- No placeholder markers or unspecified implementation steps remain.
- Core helper, component, integration, and validation tasks are deterministic.

Type consistency:

- `ActiveCueSummary`, `ActivePreviewCue`, and helper names are consistent across tasks.
- Svelte event prop names are lower-case callback props and match usage in the integration task.
