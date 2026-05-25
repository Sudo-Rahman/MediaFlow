# Video OCR Floating Cue Palette Design

Date: 2026-05-25

## Summary

Replace the transient active OCR cues popover in the Video OCR preview with a persistent, draggable workspace palette. The palette shows the OCR cues active at the current playback time and remains open while playback continues, even when the active cue count changes.

The component name should be `FloatingOcrCuePalette`. In UX copy and internal comments, refer to it as a floating OCR cues palette, not as a modal dialog. It is non-modal and does not block interaction with the rest of the Video OCR workspace.

## Goals

- Keep active OCR cue details visible during playback without requiring repeated clicks.
- Let the user drag the cue details panel anywhere inside the Video OCR workspace.
- Keep the palette open as cue count changes from multiple cues to one cue or no cues.
- Close only through explicit user intent: close button or `Escape`.
- Hide the palette naturally when leaving the Video OCR tool.
- Keep the first implementation informational only.

## Non-Goals

- Persist palette position across tool sessions or app restarts.
- Store a separate position per video file.
- Select OCR zones from the palette.
- Dock the palette into a permanent side panel.
- Keep using the current popover behavior as the persistent surface.

## UX Behavior

`ActiveCueSummary` remains the compact row under the video. It shows the primary active OCR cue text and an action button whenever at least one OCR cue is active or the palette is already open.

Clicking the action button opens the floating palette. The palette opens at a default top-right workspace position with comfortable edge offset. After the user drags it, the palette keeps that position until `VideoOcrWorkspace` is destroyed.

While open:

- cue content updates from playback state in real time;
- the panel remains open when active cues change from two cues to one cue or zero cues;
- an empty state appears when no OCR cue is active;
- outside clicks do not close it;
- playback events do not close it;
- the close button closes it;
- `Escape` closes it for keyboard accessibility.

The palette is constrained to the Video OCR workspace bounds. If the workspace resizes, the current position is clamped so the panel remains reachable.

## Component Design

Add `src/lib/components/video-ocr/FloatingOcrCuePalette.svelte`.

Responsibilities:

- render the persistent palette surface;
- render a draggable header with title, description, and close button;
- render active cue items using existing shadcn-svelte primitives;
- render an empty state when no cues are active;
- handle pointer-based dragging within workspace bounds;
- handle `Escape` close behavior.

The component should use existing primitives:

- `Button` for the close action;
- `Item.Root` for each cue row;
- `ScrollArea` for the cue list;
- `Empty` for the no-active-cues state.

It should not add a dependency for dragging. Pointer events are enough for this scope.

`ActiveCueSummary.svelte` should stop rendering the `Popover`. It should remain a compact summary component and expose the open-palette action through an `onOpenPalette` prop.

`VideoPreview.svelte` should receive an `activeCueSummary` prop instead of calculating it itself. It should pass that summary to `ActiveCueSummary` and forward the open-palette event to `VideoOcrWorkspace`.

`VideoOcrWorkspace.svelte` should own:

- `paletteOpen`;
- `palettePosition`;
- a workspace container reference used for drag bounds;
- the single `activeCueSummary` calculation.

## Data Flow

Move active cue summary calculation up to `VideoOcrWorkspace`.

`VideoOcrWorkspace` already has:

- the selected `file`;
- `currentTimeMs`;
- `selectedZoneId`;
- access to the latest OCR subtitles through `file.ocrVersions.at(-1)?.finalSubtitles`.

It should call:

```ts
buildActiveCueSummary({
  subtitles,
  selection: file.ocrSelection,
  timeMs: currentTimeMs,
  selectedZoneId,
})
```

Then:

- pass `activeCueSummary` into `VideoPreview`;
- pass the same summary into `FloatingOcrCuePalette`;
- open the palette from the `ActiveCueSummary` button via `VideoPreview` event forwarding.

This keeps a single source of truth for active cue ordering, primary cue selection, labels, and confidence formatting.

## Dragging Details

Represent position in workspace-local pixels:

```ts
interface FloatingPalettePosition {
  x: number;
  y: number;
}
```

Use `left` and `top` on an absolutely positioned palette inside `VideoOcrWorkspace`. During drag:

1. Capture pointer on header `pointerdown`.
2. Track movement with `pointermove`.
3. Clamp `x` and `y` to the workspace rect minus palette dimensions.
4. Release capture and stop dragging on `pointerup` or `pointercancel`.

Drag should start only from the header area, not from cue list content, buttons, or scrollbars.

## Accessibility

The palette should be non-modal. It should not trap focus.

The close button must have an accessible label such as `Close active OCR cues palette`.

The draggable header can use normal button-free markup with cursor styling. Avoid presenting it as a slider or other ARIA widget unless full keyboard drag behavior is implemented.

`Escape` should close the palette when focus is inside the palette or when the palette is open and the workspace receives the key event.

## Error And Edge Cases

- If there is no selected file, the palette should not render.
- If there are no active cues while open, render the empty state instead of closing.
- If the selected file changes while the Video OCR workspace remains mounted, keep `paletteOpen` and position but update content for the new file.
- If the workspace becomes too small for the previous position, clamp position into the visible area.
- If the latest OCR version has no subtitles, the palette can still open only if previously open; it shows the empty state.

## Testing

Run `pnpm check` after the Svelte changes.

Add focused tests where practical:

- keep existing `preview-cues.test.ts` behavior unchanged;
- add or update tests for `ActiveCueSummary` button visibility and callback behavior if the current test setup supports Svelte component rendering;
- test extracted position-clamping helper logic if dragging math is moved into a small TypeScript helper.

Manual verification should cover:

- open palette from one active cue;
- open palette from two overlapping active cues;
- play through cue changes and confirm the palette stays open;
- drag the palette over preview and timeline areas;
- resize the window and confirm the palette stays reachable;
- close by button;
- close by `Escape`;
- switch away from Video OCR and confirm the palette disappears.

## Implementation Scope

This is a scoped frontend change under `src/lib/components/video-ocr`. It should not change Rust commands, OCR persistence, subtitle generation, FFmpeg behavior, or `.mediaflow.json` compatibility.
