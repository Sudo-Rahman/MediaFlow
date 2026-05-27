# OCR Timeline Editing Design

Date: 2026-05-27
Status: Approved for implementation planning

## Context

MediaFlow's Video OCR timeline already supports zooming, panning with horizontal wheel gestures, playhead dragging, segment moving, and segment trimming. Three editing gaps remain:

- Dragging the playhead, a zone block, or a trim handle gets stuck at the visible edge when the timeline is zoomed.
- Users need a precise way to split one OCR zone into two time ranges from the timeline.
- Short non-overlapping zones can visually overlap after zooming out because the timeline gives blocks a minimum rendered width while lane assignment currently reasons mainly from time ranges.

This design changes only frontend timeline editing and `VideoOcrSelection` manipulation. It does not change Rust/Tauri commands, OCR processing, persisted sidecar format shape, or export formats.

## Goals

- Auto-pan the zoomed timeline while dragging near the visible left or right edge.
- Support a precise two-step cut workflow for a single targeted OCR zone.
- Keep visually overlapping blocks on separate timeline lanes, including collisions caused by minimum rendered block width.
- Preserve existing drag commit/cancel behavior and persistence flow.
- Keep core calculations covered by focused unit tests.

## Non-Goals

- Prevent overlapping OCR zones in time.
- Add a business minimum duration for cuts.
- Redesign the OCR timeline or replace the current Svelte component.
- Change OCR output generation or AI cleanup behavior.

## Architecture

`OcrTimeline.svelte` remains the interaction owner for pointer gestures, context menus, viewport display, and the precise cut overlay. Pure calculations should be implemented as exported helpers in either `src/lib/utils/ocr-selection.ts` or the module script of `OcrTimeline.svelte`, matching the existing pattern for timeline tests.

The data flow remains:

`OcrTimeline.svelte` -> `VideoOcrWorkspace.svelte` -> `VideoOcrView.svelte` -> `videoOcrStore` -> `persistFileData`.

A new store action should perform the single-zone cut so the mutation is centralized and testable.

## Auto-Pan During Drag

Auto-pan applies to all active timeline drag types:

- playhead seek
- moving a zone block
- trimming the start edge
- trimming the end edge

The trigger edge width is:

```text
edgeWidthPx = clamp(trackWidthPx * 0.12, 60, 150)
```

Auto-pan only runs when the viewport is zoomed, meaning the visible window is smaller than the full video duration. When the pointer is inside the left edge zone, the viewport pans backward. When it is inside the right edge zone, the viewport pans forward. If the pointer leaves the track bounds while dragging, the same direction continues based on the side it left from.

Pan speed should scale with edge pressure: closer to the edge, or outside the track, moves faster. The pan loop should run with `requestAnimationFrame` while a drag is active and stop on pointerup, pointercancel, Escape, component destroy, or when the viewport reaches the video boundary.

While auto-pan changes the viewport, the active drag preview must keep updating from the latest pointer position in the new viewport. Existing commit semantics stay intact:

- seek commits only on pointerup;
- move/trim previews during drag;
- move/trim commits only on pointerup after a preview edit;
- pointercancel rolls back preview edits.

## Precise Zone Cut

The cut workflow is two-step:

1. The user right-clicks a zone block and chooses `Cut`.
2. The timeline enters precise cut mode for that targeted zone.

In precise cut mode:

- the targeted zone remains selected;
- the cursor changes to a vertical split-style cursor;
- a vertical guide follows the pointer inside the timeline;
- a tooltip near the pointer shows the current timestamp with millisecond precision;
- left click confirms the cut;
- Escape, pointercancel, or right click cancels the mode.

The cut time is taken from the guide position at confirmation, not from the original context-menu position. A cut is valid only when:

```text
segment.startTimeMs < cutTimeMs < segment.endTimeMs
```

There is no business minimum duration. The only restriction is avoiding zero-duration pieces.

The timeline should call a new callback named `onCutZone`:

```ts
onCutZone?: (segmentId: string, zoneId: string, cutTimeMs: number) => void;
```

`VideoOcrWorkspace.svelte` adds the active `fileId`, and `VideoOcrView.svelte` calls a store action and persists.

## Single-Zone Split Semantics

The cut targets only the zone block that was right-clicked. It must not cut every zone in the segment unless the targeted zone is the only zone in that segment.

If the source segment contains only the targeted zone, replace it with two new segments:

- left segment: original start to cut time;
- right segment: cut time to original end.

If the source segment contains multiple zones:

- remove only the targeted zone from the original segment;
- keep the original segment time range for the other zones;
- create two new one-zone segments for the targeted zone, split at the cut time.

Both split zones preserve the original role and region. Labels are derived from the displayed/current label:

- `Zone 4` becomes `Zone 4 A` and `Zone 4 B`;
- custom labels use the same suffix rule, for example `Opening` becomes `Opening A` and `Opening B`.

Default label normalization should not overwrite these explicit split labels.

## Visual Lane Assignment

Timeline lanes should avoid visual collisions, not only time overlap. The lane assignment should account for each block's rendered bounds in the current viewport:

- visible start percentage;
- visible end percentage;
- minimum block width;
- track width in pixels;
- a small required visual gap between blocks.

If two blocks would overlap or touch visually, they must be placed on different lanes even when their time ranges do not overlap. This fixes short adjacent zones that collide after zooming out because both receive a minimum rendered width.

When choosing which block stays on the earlier lane, the layout should prefer longer blocks first, then earlier start time, then stable id ordering. This makes shorter blocks drop below longer blocks in dense areas, matching the desired behavior.

The lane assignment remains per role group, so `main_subtitle` and `on_screen_text` keep independent lane stacks.

## Error Handling And Edge Cases

- If a cut target no longer exists by confirmation time, cancel the cut without mutation.
- If the cut time rounds to the exact start or end, do not commit the cut.
- If a multi-zone source segment would become empty after removing the target, drop the empty segment.
- If auto-pan reaches the start or end of the video, keep the drag active but stop moving the viewport past the boundary.
- If the timeline loses the active pointer or the component is destroyed, cancel the active drag or cut mode using the existing rollback behavior.

## Testing Plan

Focused automated tests:

- `src/lib/utils/ocr-selection.test.ts`
  - assigns visually colliding blocks to separate lanes even without time overlap;
  - prefers keeping the longer block on the earlier lane;
  - keeps lane assignment grouped by role through caller grouping.
- `src/lib/components/video-ocr/OcrTimeline.test.ts`
  - computes auto-pan edge width as `clamp(width * 0.12, 60, 150)`;
  - computes left/right/no auto-pan intent;
  - preserves existing seek and trim commit/cancel behavior.
- `src/lib/stores/video-ocr.test.ts`
  - cuts a single-zone segment into two labeled segments;
  - cuts one zone out of a multi-zone segment without changing the other zones;
  - rejects cuts at exact start and exact end.

Manual verification after implementation:

- zoom into the timeline, drag the playhead to a visible edge, and verify the viewport pans;
- repeat with moving a zone block and trimming both handles;
- right-click a zone, choose `Cut`, verify the vertical guide and timestamp tooltip, then confirm;
- zoom out around short adjacent zones and verify blocks do not visually overlap.

Expected validation commands:

```bash
pnpm test -- src/lib/utils/ocr-selection.test.ts src/lib/components/video-ocr/OcrTimeline.test.ts src/lib/stores/video-ocr.test.ts
pnpm check
```
