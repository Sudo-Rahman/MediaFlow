# Video OCR Preview Redesign

Date: 2026-05-21

## Scope

This design changes only the Video OCR preview surface. It must not change `OcrTimeline.svelte`, timeline behavior, OCR storage, OCR processing, or selection data contracts.

Target files are expected to stay around:

- `src/lib/components/video-ocr/VideoPreview.svelte`
- `src/lib/components/video-ocr/RegionSelector.svelte`
- `src/lib/components/video-ocr/SubtitleOverlay.svelte`, to stop default over-video rendering in this flow
- New small preview-only subcomponents if needed

## Problem

The current preview lets too many UI layers occupy the video image:

- Native browser video controls can remain visible after play/pause.
- Generated OCR subtitles render over OCR regions.
- Region editing instructions and Save/Cancel actions render over the editable region.
- Live/zone hints compete with the same top-left and top-center areas.

The result is not a layering bug in one component. It is an unclear layer contract for the preview.

## Design Goals

- Keep the video image clean enough to inspect OCR zones.
- Never place player controls, Save/Cancel, generated cue lists, or persistent instructions over the video image.
- Keep the preview compact and stable when many OCR zones are active.
- Preserve existing OCR zone editing and playback workflows.
- Use existing shadcn-svelte primitives before hand-rolled surfaces.
- Keep all user-facing UI text in English.

## Non-Goals

- No timeline redesign.
- No OCR data model change.
- No OCR processing or export behavior change.
- No persistent `Review / Edit Zones / Subtitle Preview` tab group.
- No broad layout changes to file list or OCR options.

## Preview Layout

The preview becomes one integrated vertical stack:

1. Preview toolbar
2. Video image
3. Compact active cue row
4. Custom player bar

The stack should live in the same preview container so it feels continuous with the video. A `flex-col` layout is the expected implementation shape.

## Layer Contract

### Video Image Layer

Allowed over the video image:

- OCR zone rectangles
- Active region selector outline and resize handles
- Temporary pointer-only affordances needed for dragging or resizing

Not allowed over the video image:

- Native video controls
- Save/Cancel buttons
- Generated subtitle overlay in the default state
- Multi-line active cue lists
- Persistent instruction banners
- Player controls

The actual burned-in subtitles inside the video file are pixels and are not part of this UI layer contract.

### Preview Toolbar

The toolbar sits above the video image inside the preview container.

It owns short state text and edit actions:

- `Editing Main subtitle - Zone 1`
- `Drawing OCR zone`
- `Cancel`
- `Save`

During edit or draw states, guidance text belongs here, not inside the video image.

### Compact Active Cue Row

The compact cue row is a fixed-height row below the video image.

Default content priority:

1. Active cue for the selected OCR zone, if that zone has a cue at the current playback time.
2. First active `main_subtitle` cue by segment and zone order.
3. First active `on_screen_text` cue by segment and zone order.
4. Empty state text when no generated cue is active.

When more than one cue is active, the row shows a count button such as `5 active cues`. Activating the count opens a popover with the full cue list.

Popover requirements:

- Group or label each item by role and zone label.
- Show cue text and confidence when available.
- Cap height and scroll with `ScrollArea`.
- Stay outside the video image.
- Be reachable by keyboard and pointer.

### Custom Player Bar

The native `<video controls>` UI is removed.

The custom player bar sits below the compact cue row and owns:

- Back 10 seconds icon button
- Single Play/Pause icon button
- Forward 10 seconds icon button
- Seek slider
- Current time and duration
- Audio icon button
- Vertical volume slider on hover/focus
- Fullscreen icon button

Volume behavior:

- Clicking the audio icon toggles mute/unmute.
- Hovering or focusing the audio control opens a vertical slider.
- The slider must remain keyboard accessible.
- The open volume slider may float above the player bar, but not over the video image.

Fullscreen behavior:

- Fullscreen keeps the same layer order: image, compact cue row, player controls.
- Fullscreen controls still stay outside the video image.

## States

### Default Review State

- Video image shows passive OCR zone rectangles for zones active at the current playback time.
- Generated OCR text appears in the compact cue row, not over the image.
- The player bar is active.
- Toolbar may show neutral context or be visually minimal.

### Drawing State

- Playback pauses.
- Toolbar shows drawing guidance and Cancel.
- Video image shows only the drawing selector layer.
- Compact cue row and player bar keep their position. Controls may be disabled while dragging if needed.

### Editing State

- Playback pauses.
- Toolbar shows the selected zone and Save/Cancel.
- Video image shows the selected zone with handles.
- Other active zones may be dimmed for context, but must not compete visually with the selected zone.
- No generated subtitle overlay appears over the image.

### Multiple Active Zones

- The video can show multiple zone rectangles.
- The compact row shows one selected or primary cue.
- The count popover shows all active cues.
- The row height does not grow as cue count grows.

### Deferred Output Preview

Over-video subtitle output preview is not part of the initial implementation. The current generated subtitle display is represented by the compact active cue row.

If an over-video output preview is added later, it should be an explicit toolbar icon/toggle, not a persistent tab.

When output preview is enabled:

- OCR zone rectangles hide.
- Region editing is not active.
- Generated subtitles render at their export positions.
- If rendered subtitles overlap, the preview uses deterministic stacking lanes.

This deferred mode must not be implemented accidentally as part of the preview cleanup.

## Accessibility

- All icon-only controls need `aria-label` and visible focus states.
- Seek and volume controls need labels and keyboard operation.
- The active cue count must be a real button or popover trigger.
- Popover content must be reachable by keyboard.
- Do not use clickable `div` or `span` for actions.
- Do not remove focus outlines without a replacement.

## Component Approach

`VideoPreview.svelte` should become the owner of the preview stack and high-level state:

- Playback time
- Paused/playing
- Muted/volume
- Fullscreen request
- Active cue calculation
- Drawing/editing state
- Layer visibility

Small components are acceptable if they keep `VideoPreview.svelte` understandable:

- `PreviewPlayerControls.svelte`
- `ActiveCueSummary.svelte`
- `PreviewToolbar.svelte`

`RegionSelector.svelte` should focus on hit testing and region geometry. Persistent instruction text should move to the preview toolbar.

`SubtitleOverlay.svelte` should not render by default over OCR zones. For the initial implementation, generated OCR text belongs in the compact active cue row.

## Test and Validation Plan

The debugging feedback loop should target the layer contract, not only visual snapshots.

Recommended tests:

- Unit-test active cue selection priority with selected zone, multiple main subtitle cues, and on-screen text cues.
- Unit-test layer visibility for default, drawing, and editing states.
- Unit-test that multiple active cues produce one compact row plus a count, not multiple persistent rows.

Manual/browser validation after implementation:

- Play, pause, and seek: native controls never appear.
- Edit a zone near the bottom of the video: Save/Cancel and guidance do not cover the region.
- Generated OCR subtitle at the same time as an OCR region: text appears in compact cue row, not over the region.
- Five active zones at one timestamp: preview height stays stable and the popover lists all cues.
- Volume hover/focus: vertical slider opens from the audio icon without covering the video image.

Run at minimum after implementation:

- `pnpm check`
- Narrow Vitest tests for new helper/state logic
