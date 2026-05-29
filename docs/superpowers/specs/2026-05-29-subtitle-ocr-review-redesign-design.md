# Subtitle OCR Review Redesign Design

Date: 2026-05-29

## Summary

Redesign the Subtitle OCR review workspace so it adapts to the available center-panel width.

The existing Subtitle OCR pipeline, left source panel, right options panel, versioning, retry, and export behavior remain unchanged. This spec only replaces the review UI described in `2026-05-28-subtitle-ocr-design.md`.

The approved direction is:

- Compact center width: one large selected bitmap, previous/next navigation, cue metadata, then recognized text in a vertical column.
- Wide center width: cue-card rail with the selected cue centered, neighboring cues visible, cue metadata and recognized text kept with each cue, and a thumbnail timeline below.
- Timeline: navigation only. It uses level-of-detail time buckets at low zoom and exact cue thumbnails at high zoom.

## Goals

- Keep the existing MediaFlow tool chrome: app sidebar, left source panel, right options panel, global export, version selector, file cards, version dialogs, retry, and options.
- Make the center review panel feel like a focused subtitle review/editor surface instead of a split inner layout.
- Automatically switch between compact and wide review modes based on available center workspace width.
- Keep the selected cue visually centered in wide mode.
- Show the confidence/source-cue metadata and recognized text directly with the cue in wide mode.
- Preserve a simple compact mode for narrower windows.
- Make the timeline a performant temporal navigation surface with bitmap previews, gaps, click/drag navigation, and wheel/trackpad zoom.
- Keep UI text in English.

## Non-Goals

- Do not create a separate route or separate app URL for detailed review.
- Do not remove the left source panel or right options panel in wide mode.
- Do not add visible timeline zoom buttons.
- Do not use video-frame thumbnails. Subtitle OCR only has subtitle bitmap thumbnails.
- Do not add new user-facing OCR cleanup options.
- Do not redesign import, version dialogs, export dialogs, or the right options panel as part of this change.

## Responsive Mode Selection

The review workspace has two responsive modes:

- `compact`: default mode for normal and narrow center-panel widths.
- `wide`: detailed mode for very wide center-panel widths.

The switch should be based on the center workspace's available width, not a hard-coded window width. Use a named breakpoint such as `WIDE_REVIEW_MIN_CENTER_WIDTH_PX` with an initial value of `1700`. With the current MediaFlow layout, that is intended to activate wide mode around `2500px` app width. Prefer a container query or `ResizeObserver` threshold on the center review panel.

The mode switch must preserve:

- Selected source item.
- Active version.
- Selected cue.
- Timeline zoom and viewport, clamped to the available duration while preserving the same center timestamp.
- Draft text edits.

Changing modes must not restart OCR, clear review state, or select a different version.

## Compact Review Mode

Compact mode is a vertical review flow:

1. Header with source title, track metadata, and version selector.
2. Large selected bitmap.
3. Previous and next cue controls.
4. Cue metadata block.
5. Recognized text editor.

The metadata block must stay above the recognized text. Compact mode must not place metadata and recognized text side-by-side.

The selected bitmap should preserve aspect ratio, use bounded dimensions, and remain the dominant center-panel element. Previous/next controls may be overlay buttons beside the bitmap or adjacent icon buttons, as long as they are reachable and do not cover subtitle content.

## Wide Review Mode

Wide mode keeps the left and right panels visible, but the center workspace becomes a detailed cue-card rail.

The wide layout is:

1. Header with source title, track metadata, active version selector, and cue navigation controls.
2. Horizontal cue-card rail.
3. Timeline navigation surface.

The cue-card rail shows the selected cue centered. The previous and next cues must remain visible when space allows. On very wide screens, more surrounding cues may be visible, but the selected cue remains centered.

Each cue card contains:

- Bitmap preview at the top.
- Cue timing.
- Confidence.
- Source cue count, such as `2 source cues`.
- Confidence progress indicator.
- Recognized text below the metadata.

The selected cue card is wider than neighboring cards. Card widths should be bounded so 4K displays do not create excessively large bitmaps. Start with these clamps:

- Selected card width: `500px` to `680px`.
- Neighbor card width: `300px` to `460px`.

The values can be tuned during implementation only if visual verification shows clipping or weak readability. The selected card should not exceed `760px`, and neighboring cards should not exceed `520px`.

## Timeline Navigation

The timeline is only for navigation. It is not an editable text surface and it does not replace the cue-card rail.

The timeline domain is the full source duration from `0:00` to the media/subtitle duration. At the default zoom level, the whole duration is visible.

The timeline uses level-of-detail buckets:

- At default zoom, divide the visible duration into a small number of time buckets based on timeline pixel width.
- Each bucket represents a time range.
- If a bucket contains subtitle cues, show a representative subtitle bitmap.
- If a bucket contains no subtitle cues, show an explicit gap/empty segment.
- The lower-left overlay shows the bucket start time.
- The lower-right overlay shows the cue count, such as `42 cues`, or an empty/gap label such as `No cues`.

As the user zooms in:

- The visible duration shrinks around the zoom anchor.
- Bucket duration becomes smaller.
- Representative bitmap buckets become more temporally precise.
- When the zoom level is precise enough, a visible thumbnail may represent one exact subtitle cue.
- Clicking an exact cue thumbnail selects that cue and centers the cue-card rail on it.

Gaps between subtitle activity must remain visible. A gap should not be filled with a fake bitmap.

## Timeline Interactions

Timeline interactions:

- Mouse wheel over the timeline zooms.
- Trackpad pinch or equivalent browser wheel zoom gesture zooms.
- Timeline zoom anchors around the pointer position when possible.
- Dragging the timeline pans/navigates through time.
- Clicking a bucket moves the selected timestamp to that bucket's representative time.
- Clicking an exact cue thumbnail selects that cue.
- Timeline movement updates the cue-card rail.
- Cue-card rail navigation updates the timeline playhead/viewport.

There should be no visible zoom-in or zoom-out buttons for the timeline. Keyboard shortcuts may exist for accessibility, but they must not introduce extra visible chrome.

Synchronization must avoid feedback loops by tracking the active interaction source and applying updates through `requestAnimationFrame`.

## Data Model

The existing version data remains the source of truth:

- Final cue list.
- Raw/stabilized cue lineage.
- Cue timings.
- Cue confidence.
- Source cue ids.
- Bitmap thumbnail paths.

The review UI should derive these additional view models:

- Center selected cue id.
- Wide/compact review mode.
- Timeline visible time range.
- Timeline zoom level.
- Timeline level-of-detail bucket list.
- Cue-card virtual range.

Timeline buckets are derived view data and should not be persisted in `.mediaflow.json`.

## Performance Requirements

This redesign must be optimized for large subtitle tracks.

Required strategies:

- Virtualize the cue-card rail.
- Mount only visible cue cards plus a small overscan window.
- Lazy-load cue thumbnails.
- Use bounded thumbnail dimensions for cue cards.
- Generate timeline buckets from metadata, not by mounting every cue thumbnail.
- At overview zoom, render only the calculated bucket count, not hundreds of cues.
- Use representative thumbnails for buckets.
- Keep empty/gap buckets lightweight.
- Use `requestAnimationFrame` for scroll, drag, and zoom sync.
- Avoid updating Svelte state on every raw pointer event when a frame is already queued.
- Revoke object URLs if object URLs are introduced.
- Drop references to offscreen images so the runtime can reclaim memory.

The selected cue may load a higher quality bitmap than neighboring cards if the existing cache supports it. Neighboring cards should use smaller thumbnails.

## Accessibility

- Previous and next cue controls must have accessible labels.
- Cue cards must expose the cue timing and selected state.
- Timeline buckets must expose time range and cue count.
- Exact cue timeline thumbnails must be keyboard-selectable when they represent individual cues.
- Wheel/trackpad zoom must not be the only accessible way to navigate. Keyboard navigation may pan/select cues, but visible zoom buttons are not part of the approved design.
- Recognized text remains editable with the existing draft-version behavior.

## Error And Empty States

- If a selected version has no cues, show the existing empty review state.
- If a cue has no bitmap thumbnail, show the existing missing-thumbnail fallback inside the cue card.
- If a timeline bucket has no subtitle cue, show a gap/empty state with time and `No cues`.
- If duration is unavailable, disable timeline interactions and keep cue navigation available.

## Testing

Tests should cover:

- Timeline bucket generation at overview, mid, and precise zoom levels.
- Empty/gap bucket generation.
- Representative cue selection for buckets with multiple cues.
- Exact cue selection when zoom is precise enough.
- Compact mode layout state does not place metadata beside text.
- Wide mode keeps selected cue centered.
- Mode switching preserves selected source, version, cue, and draft text.
- Timeline drag/click/wheel updates the selected timestamp/cue without scroll loops.
- Cue-card navigation updates timeline viewport/playhead.
- Large cue lists do not mount all cue cards or all cue thumbnails.

Manual verification should include:

- A normal-width app window.
- A very wide app window around the intended `2500px+` behavior.
- Trackpad zoom over the timeline.
- Mouse wheel zoom over the timeline.
- Timeline click and drag navigation.
- Cue previous/next navigation.
