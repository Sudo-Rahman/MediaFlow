# Video OCR Segment Zones Design

Date: 2026-05-14

## Goal

Improve Video OCR so users can define multiple OCR zones over specific time ranges, classify each zone by output behavior, and see OCR detections while processing is still running.

The feature should feel preview-first: users work directly on the video, with the OCR timeline acting as a compact map and precision editor.

## Current Problem

Video OCR currently supports one rectangular OCR region for the whole video. This is limiting when subtitles move, when multiple text areas appear at once, or when a video contains both dialogue subtitles and translatable on-screen text such as signs, boards, notes, or UI text.

The current pipeline also waits until processing completes before subtitles are visible, so users cannot quickly confirm whether the selected OCR area and language settings are working.

## UX Model

The video preview is the primary editing surface.

Users add OCR zones from the current playback position:

1. Seek to the timestamp where OCR should start.
2. Right-click the preview.
3. Choose `Add OCR zone from current time`.
4. Draw the rectangle directly on the video.
5. MediaFlow creates a segment starting at the current timestamp and ending at the video duration.
6. The user adjusts the end by dragging the timeline handle or by seeking to a timestamp, right-clicking, and choosing `Set segment end here`.

There is no persistent `Set OCR Region` button. Discovery comes from a subtle tooltip or hint such as `Right-click the preview to add OCR zones`.

New zones default to `main_subtitle`. The first add menu stays lightweight; users change a zone role after creation by right-clicking the zone in the preview or using a timeline context menu.

## OCR Timeline

The OCR timeline sits below the preview and uses role-based rows:

- `Main subtitle`
- `On-screen text`

Each row contains timeline blocks for zones/segments of that role. Blocks are placed in automatic lanes when they overlap in time. Overlapping blocks must not render on top of each other.

If a role has more lanes than fit comfortably, the role row becomes vertically scrollable with `ScrollArea`. The timeline remains a compact overview and precision editor, not a large side panel.

Timeline interactions:

- Select a block.
- Trim start/end handles.
- Right-click a block for role changes, delete, duplicate, and timestamp actions.
- Show provisional detection coverage while OCR is running.

## Zone Roles

Each zone has a role:

```ts
type OcrZoneRole = 'main_subtitle' | 'on_screen_text';
```

`main_subtitle` represents dialogue or classic hardcoded subtitles. It renders as normal subtitles at the bottom of the video and can export to SRT/VTT when no positioned text is present.

`on_screen_text` represents text that belongs visually to a specific part of the frame, such as signs, boards, labels, notes, or video UI. It renders near the source region and requires positioned export.

If two zones are active at the same timestamp, each zone is cropped and OCRed independently. Their text is not blindly concatenated. Results stay associated with `zoneId`, `role`, and `region`.

## Data Model

There is no backward-compatibility requirement for old Video OCR `.mediaflow.json` data. The app is not distributed yet, so use a clean model now. If old OCR data is encountered, show a clear unsupported-version error instead of migrating it.

```ts
interface OcrRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

type OcrZoneRole = 'main_subtitle' | 'on_screen_text';

interface OcrZone {
  id: string;
  region: OcrRegion;
  role: OcrZoneRole;
  label?: string;
}

interface OcrSegment {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  zones: OcrZone[];
}

interface VideoOcrSelection {
  segments: OcrSegment[];
}
```

The simple default state is represented with the same model:

- one segment from `00:00` to video duration;
- one `main_subtitle` zone;
- default region at the bottom of the frame.

This means imported videos start in a usable full-video subtitle OCR state. If the user wants OCR only for specific portions, they delete or trim the default full-duration segment and create narrower segments. If the user wants full-video dialogue OCR plus extra positioned text for a short scene, they keep the default full-duration segment and add an overlapping `on_screen_text` segment.

Segments are per video. `on_screen_text` zones are always per video. Users may copy only the default `main_subtitle` region to other videos; this updates their simple default subtitle region and does not copy segments or `on_screen_text` zones.

## Processing Pipeline

The frontend sends segments to the backend with:

- `startTimeMs`
- `endTimeMs`
- `zones[]`
- `role`
- `region`

The backend builds a normalized OCR plan. For each extracted frame timestamp, it determines active zones by finding segments that cover that timestamp. If multiple segments overlap, active zones are the union of all zones in those segments.

For each active zone:

1. Crop the frame to the zone region.
2. Run OCR on the crop.
3. Emit a result carrying provenance.

Result provenance should include:

```ts
interface OcrZoneFrameResult {
  frameIndex: number;
  timeMs: number;
  segmentId: string;
  zoneId: string;
  role: OcrZoneRole;
  region: OcrRegion;
  text: string;
  confidence: number;
}
```

For the first implementation, prefer clarity over FFmpeg filter complexity: extract frames, crop active zones in memory, OCR each crop, then group results by role and zone. Optimization can follow once correctness and UX are stable.

## Subtitle Generation

Subtitle generation must separate roles:

- `main_subtitle`: run stabilization and merging similar to the current dialogue subtitle flow.
- `on_screen_text`: stabilize by zone and preserve position metadata.

Main subtitles and on-screen text should not be merged into the same cue. They have different display semantics and export constraints.

## Preview And Export

Preview after final OCR:

- `main_subtitle` displays at the bottom as normal subtitles.
- `on_screen_text` displays as a callout near the source region.
- If there is not enough room near the region, fallback to a semi-transparent overlay inside the region.

Export rules:

- If every zone is `main_subtitle`, SRT and VTT are available.
- If any zone is `on_screen_text`, ASS is required and SRT/VTT are removed or disabled with a concise explanation: `ASS required for positioned text`.

ASS positioning should be derived from the source region and video dimensions.

## Live OCR Preview

The pipeline should stream provisional OCR detections while processing runs. The user should not need to wait for the full pipeline to finish before seeing whether OCR is working.

Live preview behavior:

- No side panel.
- No duplicate OCR progress badge inside the preview; the app already shows processing progress elsewhere.
- Show provisional `main_subtitle` text at the bottom when the current playback time matches a live detection.
- Show provisional `on_screen_text` near its source region.
- Add a compact preview overlay element such as `Live detections · 24`.
- The live detections element opens a shadcn `HoverCard` with recent detections, timestamps, roles, confidence, and text.
- The timeline can show detected vs pending portions during processing.
- When processing finishes, final stabilized subtitles replace provisional detections.

Provisional text must be visually distinct from final subtitles. It can be labeled `Provisional` in the hovercard or use subtle styling in the overlay.

## UI Components

Use shadcn-svelte primitives for interactive UI. Use Tailwind/divs for internal layout, timeline drawing, and video overlays.

Planned components:

- `ContextMenu`: preview actions, zone actions, timeline block actions.
- `HoverCard`: `Live detections · N` preview element.
- `Card`: OCR timeline container.
- `ScrollArea`: overflow lanes in role rows.
- `Button`: compact explicit actions where needed.
- `Badge`: role labels, provisional status, detection counts.
- `Tooltip`: discovery hints such as right-click guidance.
- `Select` or `DropdownMenu`: role selection outside context menus if needed.
- `Dialog`: optional detailed live detections view only, never as a persistent side panel.
- `Progress`: existing app progress UI, not duplicated in the video preview.
- `Switch` or `Checkbox`: options such as applying the default main subtitle region to other videos.
- `Input` and `Field`: precise timestamp editing if numeric editing is added.

## Validation And Error Handling

Validate on the frontend and backend:

- Segment start is before end.
- Segment bounds are within video duration.
- Regions are normalized within `0..1`.
- Region width and height are above a minimum threshold.
- Empty segments are not processed.
- Overlapping segments are allowed.
- Multiple active zones at the same timestamp are allowed.
- Unsupported old Video OCR persistence data produces a clear error.

If a segment or zone is invalid, block OCR start and show an actionable message.

## Tests

Add or update tests for:

- Creating, trimming, deleting, and role-changing zones.
- Timeline lane assignment for overlapping blocks.
- Saving and loading the new `segments` format.
- Rejecting unsupported old OCR data.
- Building the backend OCR request payload.
- Export availability based on zone roles.
- Backend segment and region validation.
- Multiple active zones at one timestamp producing multiple OCR results.
- Keeping `main_subtitle` and `on_screen_text` subtitle generation separate.
- Live detection event normalization and provisional preview state.

## Open Implementation Notes

This design intentionally does not prescribe exact file boundaries. Implementation should follow existing MediaFlow patterns:

- Svelte 5 runes for state.
- Existing Video OCR view/component structure.
- Tauri invoke wrappers in frontend services.
- Rust OCR logic in `src-tauri/src/tools/ocr`.
- Progress and live detection events through Tauri event emission.

The design should be implemented as one coherent Video OCR refactor, with tests added around the new selection model and pipeline contract.
