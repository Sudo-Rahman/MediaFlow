# Subtitle OCR Filmstrip Timeline Redesign Design

Date: 2026-05-31

## Summary

Redesign the Subtitle OCR wide review mode so the timeline becomes the primary navigation surface and the filmstrip becomes the preview/editing surface for the timeline window.

This spec supersedes the wide-mode timeline portion of `docs/superpowers/specs/2026-05-29-subtitle-ocr-review-redesign-design.md`. The compact review mode, left source panel, right options panel, versioning, retry, export, OCR processing, persistence, and draft editing behavior remain unchanged.

Approved direction: option C from the visual companion. The wide review UI uses a simplified cue-zone timeline without thumbnails. A draggable viewport window on the timeline defines the cue range shown in the filmstrip. The filmstrip remains horizontally scrollable, keeps the centered cue selected, and shows readable cue cards with bitmap preview, metadata, and recognized text.

## Goals

- Keep the wide Subtitle OCR review mode useful at very large app widths, around the existing `2500px+` wide-workspace behavior.
- Remove bitmap thumbnails from the timeline to reduce visual noise.
- Make the timeline a clear duration/navigation surface using simple cue zones.
- Add a draggable timeline viewport window that represents the cues visible in the filmstrip.
- Keep the filmstrip dense enough that neighboring previews are close together.
- Select the cue closest to the horizontal center of the filmstrip while the user scrolls.
- Prevent selected cue text from being clipped at the bottom of wide cue cards.
- Keep zoom and pan behavior bounded so the timeline cannot enter unusable states.
- Keep UI text in English.

## Non-Goals

- Do not redesign compact mode.
- Do not redesign import, retry, export, version dialogs, or OCR options.
- Do not change the persisted `.mediaflow.json` data model.
- Do not add new OCR pipeline behavior.
- Do not make timeline cue zones text-editable.
- Do not show bitmap thumbnails in the timeline.
- Do not create a separate full-screen review route.

## Wide Layout

The approved wide layout order is:

1. Review header with source title, track metadata, active version selector, and existing draft/version actions.
2. Horizontal filmstrip with cue cards.
3. Timeline navigator with cue zones and a draggable viewport window.

The timeline sits below the filmstrip because it controls the filmstrip range. It should remain visually compact enough that the filmstrip and text editor stay dominant.

## Filmstrip

The filmstrip is a horizontally scrollable row of cue cards.

Each cue card contains:

- Bitmap preview.
- Cue timing.
- Confidence.
- Source cue count.
- Confidence progress indicator.
- Recognized text editor.

The card spacing must be tighter than the current wide rail. Use a small fixed gap, around `8px` to `12px`, instead of large slot spacing.

All cards should have stable bounded dimensions in wide mode. The selected card can be emphasized with border/ring/elevation, but it should not become so much wider that it creates large empty gaps between previews. Prefer equal-width cards unless implementation testing shows a small selected-card width increase improves readability without harming density.

The recognized text area must not be clipped. It should have one of these behaviors:

- Preferred: fixed card height with a fixed text editor region that scrolls internally.
- Acceptable: card height grows within a bounded rail height, with the rail preserving vertical scroll if needed.

The selected cue is the cue whose card center is closest to the filmstrip viewport center. While the user scrolls horizontally, selection updates through `requestAnimationFrame`. The centered cue selection must update the cue metadata and timeline selected marker without fighting the user's scroll.

Clicking a cue card selects it and scrolls it to the filmstrip center.

## Timeline

The timeline represents time, not images.

It renders:

- Cue zones for subtitle bitmap cues.
- Empty gaps as quiet background space.
- Time ticks/ruler labels.
- Selected cue marker or selected zone highlight.
- A draggable viewport window that represents the filmstrip's visible cue/time range.

Cue zones should scale by duration. Very short cues must remain visible with a minimum pixel width, but the timeline should preserve the duration relationship as much as possible.

The timeline must not render bitmap thumbnails, representative thumbnails, or image overlays.

## Timeline Zoom

Zoom changes the timeline scale. It must not simply resize the viewport window in place.

When zooming in:

- The timeline content width increases.
- Cue zones spread apart.
- The scrollable timeline viewport can reveal a smaller time range.
- The draggable filmstrip window keeps its time duration unless clamped by min/max rules.

When zooming out:

- The timeline content width decreases.
- Cue zones compress.
- The scrollable timeline viewport can reveal more time.
- The filmstrip window remains usable and is clamped to its configured pixel limits.

Zoom should anchor around the timeline pointer position for wheel/trackpad interactions. Button/icon zoom can anchor around the current filmstrip window center.

## Timeline Viewport Window

The blue timeline window represents the time range currently shown in the filmstrip.

Window constraints:

- Minimum window width: start with `200px`.
- Maximum window width: no larger than the visible timeline viewport width minus a small margin, such as `24px`.
- Minimum represented duration: start with `1_000ms`, unless the source duration is shorter.
- Maximum represented duration: the source duration.
- If zoom or resize would violate min/max pixel width, clamp the represented duration or zoom level to keep the window usable.

The exact constants may be tuned during visual verification, but the implementation must have named constants and tests for the clamp behavior.

Dragging the window:

- Moves the represented filmstrip time range.
- Updates the filmstrip to center the cue nearest the window center.
- Keeps the timeline window inside the timeline duration.
- Auto-scrolls the timeline when the pointer is dragged near the left or right edge of the visible timeline viewport.
- Continues movement while auto-scrolling, so the user can drag across a long zoomed timeline without dropping the pointer.

The window should use visible handles only if the implementation supports resizing the represented duration. If V1 only supports moving the window, use a single draggable body and avoid resize handles that imply unsupported behavior.

## Synchronization

There are three synchronized concepts:

- `selectedCueId`: the currently selected cue.
- `timelineScale`: the timeline zoom level or pixels-per-millisecond ratio.
- `filmstripWindow`: the timeline start/end range represented by the blue window.

Interaction rules:

- Filmstrip scroll selects the cue nearest the filmstrip center.
- Filmstrip-centered selection updates the selected timeline zone and may recenter the timeline window around the selected cue.
- Timeline window drag updates `filmstripWindow`.
- `filmstripWindow` changes scroll the filmstrip to the cue nearest the window center.
- Timeline cue-zone click selects that cue and centers both the filmstrip and window around it.
- Timeline pan changes only the visible portion of the scrollable timeline, not the selected cue by itself.
- Timeline zoom preserves the window center timestamp where possible.

Avoid feedback loops by tracking the active interaction source:

- `filmstrip`
- `timeline-window`
- `timeline-zone`
- `timeline-zoom`
- `selection`

Apply scroll and pointer synchronization through `requestAnimationFrame`. Programmatic scrolls should set a short suppression flag so they do not immediately trigger reciprocal selection updates.

## State And Data

The existing persisted version data remains the source of truth:

- Cue list.
- Cue timings.
- Cue text.
- Cue confidence.
- Source cue ids.
- Bitmap preview/thumbnail paths.

New review state is UI-derived and should not be persisted in `.mediaflow.json`:

- Timeline scale.
- Timeline scroll offset.
- Filmstrip window start/end.
- Active interaction source.

It is acceptable for this state to reset when switching source item or active version. It should preserve selection when possible within the same item/version.

## Components

Expected component responsibilities:

- `SubtitleOcrWorkspace.svelte`: owns selected cue, active version, responsive mode, shared review state, and synchronization callbacks.
- `SubtitleOcrCueRail.svelte`: renders the dense virtualized filmstrip, center-selection behavior, and cue-card scroll synchronization.
- `SubtitleOcrCueCard.svelte`: renders bitmap, metadata, confidence, and editable recognized text without clipping.
- `SubtitleOcrTimeline.svelte`: renders the simplified cue-zone timeline, zoom/pan controls, timeline scroll, draggable filmstrip window, and cue-zone selection.
- `subtitle-ocr-review-state.ts`: owns pure helpers for viewport/window clamping, zoom math, nearest-cue selection, and cue-zone layout calculations.

Use existing shadcn-svelte primitives for buttons, fields, badges, scroll areas, and item-like metadata rows. Timeline geometry can remain custom structural markup because it represents a specialized editor/navigation surface.

## Accessibility

- Cue cards expose selected state and cue timing.
- The recognized text editor remains a real labeled textarea.
- Timeline cue zones are keyboard-focusable buttons with labels such as `Select cue 3, 00:37.795 to 00:39.672`.
- Timeline window has an accessible label describing its visible time range.
- Keyboard alternatives must exist for moving the timeline window and changing zoom.
- Visible toolbar controls should use icon buttons with accessible labels/tooltips rather than long text labels in the final app UI.
- Color must not be the only selected-state signal; use border/ring and `aria-current` or equivalent state.

## Performance

The implementation must remain safe for large subtitle tracks.

Required strategies:

- Keep the filmstrip virtualized.
- Render only visible cue cards plus small overscan.
- Lazy-load cue bitmap images.
- Render timeline cue zones from timing metadata rather than mounting cue cards or images.
- Coalesce scroll, pointer, and zoom updates with `requestAnimationFrame`.
- Avoid per-pointer-event Svelte state churn when a frame is already queued.
- Keep timeline zone DOM bounded by visible time range when heavily zoomed, or use a lightweight derived layout if rendering all zones becomes expensive.

## Testing

Unit tests should cover pure helper behavior:

- Clamp filmstrip window to timeline duration.
- Enforce minimum window pixel width.
- Enforce maximum window pixel width relative to visible timeline width.
- Preserve window center while zooming when possible.
- Clamp zoom when the window would become unusably small or larger than the visible timeline viewport.
- Find the cue nearest a filmstrip center offset.
- Find the cue nearest a timeline window center timestamp.
- Auto-scroll intent near timeline viewport edges.

Component or integration tests should cover:

- Filmstrip scroll selects the centered cue.
- Programmatic filmstrip scroll does not trigger a feedback loop.
- Timeline window drag updates the filmstrip selection.
- Timeline cue-zone click selects and centers the cue.
- Recognized text remains visible/editable in wide cue cards.

Manual verification should include:

- Very wide app window around the intended `2500px+` behavior.
- Horizontal filmstrip scrolling with center selection.
- Timeline zoom in and zoom out.
- Dragging the timeline window left and right.
- Dragging the timeline window into the visible timeline edges to trigger auto-scroll.
- Cues with very short durations.
- Long subtitle tracks with hundreds of cues.
