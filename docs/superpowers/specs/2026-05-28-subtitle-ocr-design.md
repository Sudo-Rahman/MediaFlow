# Subtitle OCR Design

Date: 2026-05-28

## Summary

Add a new `Subtitle OCR` tool to MediaFlow. The tool converts bitmap subtitle sources to text subtitle versions that can be reviewed and exported as `ASS`, `SRT`, and `VTT`.

The workflow is separate from Video OCR. Video OCR samples video frames and user-defined regions. Subtitle OCR works from timed bitmap subtitle cues from PGS or VobSub sources, so the source item, OCR pipeline, review UI, retry behavior, and persistence model must be cue-based.

Authoritative library context: `oxideav-sub-image` treats PGS, DVB subtitles, and VobSub as bitmap-native subtitle formats that produce RGBA video frames rather than text subtitles. The crate supports PGS, VobSub `.idx` + `.sub`, and DVB subtitle decoding, emits one RGBA frame per display-set/cue change, and carries cue timing through packet/frame metadata. See [oxideav-sub-image docs](https://docs.rs/oxideav-sub-image/latest/oxideav_sub_image/).

## Goals

- Add `Subtitle OCR` as a dedicated sidebar tool.
- Import standalone `.sup` PGS files.
- Import standalone VobSub pairs as `.idx` + `.sub`.
- Import media containers such as `.mkv`, `.m2ts`, and `.vob`, then allow users to select compatible bitmap subtitle tracks.
- Extract selected container tracks to temporary/cache storage before decoding.
- Decode bitmap subtitle cues, OCR each cue image with the existing Paddle OCR Rust integration, and produce versioned text subtitle results.
- Persist versions in existing `<stem>.mediaflow.json` sidecars.
- Reuse existing MediaFlow patterns for file cards, versions, retry, export dialogs, global header export, settings, progress, logs, and AI provider/model selection.
- Provide a performant review workspace with a main bitmap filmstrip, synchronized timeline, and editable OCR text basket.
- Keep UI text in English.

## Non-Goals

- No Blu-ray or DVD folder structure import in V1, including `BDMV`, `VIDEO_TS`, and ISO images.
- No OCR of burned-in video subtitles. That remains Video OCR.
- No advanced visual reconstruction for ASS. ASS export is text-based, not pixel-perfect bitmap styling.
- No exposed user controls for internal stabilization heuristics.
- No automatic OCR model selection from track language tags.
- No support for audio, video, or text subtitle tracks inside the Subtitle OCR import dialog.
- No DVB subtitle import in V1. The chosen V1 targets are PGS and VobSub.

## Source Model

The core item is a `SubtitleOcrSourceItem`. One selected standalone subtitle file or one selected container track becomes one item in the left panel.

Container example:

```text
Movie.mkv
Track 5 · PGS · French · Default

Movie.mkv
Track 6 · PGS · Japanese signs · Forced
```

Standalone examples:

```text
French.sup · PGS
French.idx/.sub · VobSub
```

Each item has independent status, progress, selected version, versions, retry state, export eligibility, errors, and source metadata.

## Import Behavior

Supported V1 inputs:

- Media containers: `.mkv`, `.m2ts`, `.vob`, plus the app's existing media import extensions when FFprobe exposes PGS or VobSub subtitle streams.
- PGS standalone: `.sup`.
- VobSub standalone: `.idx` + `.sub`.

VobSub pairing rules:

- If the user imports `.idx` only, look for a neighboring `.sub` with the same basename.
- If the user imports `.sub` only, look for a neighboring `.idx` with the same basename.
- If both files are imported together, deduplicate and create one VobSub item.
- If the pair is missing, show a warning and do not create an OCR-ready item.

Container import rules:

- Probe the container for compatible bitmap subtitle streams.
- Open a track selection dialog when one or more compatible streams are found.
- Only bitmap subtitle tracks are shown. Audio/video/text subtitle tracks are excluded.
- The dialog follows the Audio to Subs item-row pattern, not a dense table.
- Each row is selectable and shows codec, stream index, language tag, title, default/forced flags, and OCR model selection.
- Quick actions include Select all, Forced only, and Clear.
- Confirming import creates one left-panel item per selected track.

## OCR Model Selection

The right options panel contains a global OCR model selector, matching the Video OCR model selector vocabulary and options.

Each import dialog row has an `OCR model` select:

- Default value: `Default`.
- `Default` means "use the current global OCR model at run time."
- A row may be manually overridden to a concrete OCR model.
- Track language tags such as `fre`, `eng`, or `jpn` are displayed only as metadata. They do not auto-select OCR models.

After import, each source item preserves either:

- `ocrModelOverride: "default"`, or
- `ocrModelOverride: <concrete model id>`.

When a run starts, the effective OCR model is resolved as:

```text
item override if concrete, otherwise current global OCR model
```

The effective model used for a run is stored in the version config snapshot.

## Options Panel

The Subtitle OCR right panel contains only user-facing options that matter for this workflow:

- Global OCR model.
- Use GPU.
- AI cleanup.
- AI provider/model selector, visible only when AI cleanup is enabled.
- Start, retry, and cancel actions following existing tool patterns.

Internal stabilization is not exposed as options.

## Backend Pipeline

Pipeline:

```text
source item
-> prepare bitmap source
-> decode timed bitmap cues
-> OCR cue images
-> reconstruct text lines
-> conservative internal stabilization
-> optional AI cleanup
-> persist version
-> review/export
```

Container items:

- Extract the selected subtitle stream with FFmpeg to an app temp/cache path.
- Temporary files are never written into the user's output folder.
- Temporary extraction should follow Audio to Subs and Video OCR cache patterns.
- Cleanup of stale temp/cache files should be safe and bounded.

Standalone items:

- `.sup` is decoded directly as PGS.
- `.idx/.sub` is decoded directly as VobSub pair.

Decoding:

- Use `oxideav-sub-image` for bitmap-native subtitle decoding.
- Store cue timing, bitmap dimensions, source rectangle/canvas data when available, and a stable cue id.
- Generate thumbnails or bitmap cache entries for review.

OCR:

- Use the existing Paddle OCR Rust integration.
- Respect `useGpu`.
- Use the effective OCR model for each item.
- Preserve raw OCR output in the version for retry and auditability.

## Text Reconstruction

PGS and VobSub are image formats. They do not provide text lines, speaker markers, or dialogue structure. The pipeline must reconstruct text from OCR geometry.

Primary line reconstruction:

- Group OCR boxes by vertical position into text lines.
- Sort boxes left to right within each line.
- Join lines with real newline characters in the internal cue text.

Dialogue dash fallback:

- If OCR returns one text block with no useful geometry, apply only a conservative fallback for obvious dialogue.
- Split when the text starts with `-` or `-`-like dialogue punctuation and contains another likely dialogue-start separator after prior text.
- Do not split ordinary hyphens inside words or ordinary sentence punctuation.

Export formatting:

- SRT and VTT write real newline characters inside the cue body.
- ASS uses ASS-compliant line break serialization while preserving the same displayed line structure.

## Internal Stabilization

Subtitle OCR has lightweight internal stabilization, not an exposed cleanup feature.

The internal stabilization may:

- Drop empty or whitespace-only cues.
- Normalize whitespace while preserving intentional line breaks.
- Merge adjacent or overlapping cues only when the normalized text is identical.
- Reuse OCR results for exact bitmap hash matches, and only for near-identical bitmap fingerprints when implementation tests prove the threshold is conservative.
- Extend cue timing for obvious duplicate display events.

The internal stabilization must not:

- Aggressively merge similar but non-identical text.
- Translate text.
- Rewrite grammar or spelling.
- Expose thresholds in the UI.

More intelligent deduplication and correction belongs to optional AI cleanup.

## AI Cleanup

AI cleanup is optional and user-controlled through the `AI cleanup` switch.

AI cleanup should:

- Correct OCR mistakes, spelling, punctuation, and grammar.
- Preserve the source language.
- Preserve meaning.
- Preserve intentional dialogue line breaks and speaker dashes.
- Remove consecutive or near-consecutive duplicate cues when they represent the same subtitle.
- Merge duplicate cues into a single cue with widened timing when appropriate.
- Avoid inventing text.
- Avoid translating.
- Avoid reordering beyond local duplicate merges.

The AI cleanup contract for Subtitle OCR may differ from translation and one-to-one OCR cleanup. It should accept a window of cues with ids, timings, and text, then return a cleaned cue list that can remove or merge local duplicates.

If AI cleanup fails, the non-AI stabilized cues remain available and should be stored as the version result unless the operation was cancelled.

## Versioning

Each source item has versioned OCR results.

A version stores:

- Version id, name, creation date.
- Source item metadata.
- Source track metadata for container tracks.
- Config snapshot, including effective OCR model, GPU, AI cleanup state, provider/model if used.
- Raw OCR results.
- Stabilized cues before AI cleanup.
- Final cues after optional AI cleanup.
- Confidence and timing data.
- Thumbnail/cache keys when needed for review.

The workspace has a version selector. The selected version is the active version. Filmstrip, timeline, OCR basket, retry, and export all use the active version.

Retry behavior:

- Full OCR retry uses the source item as input, pre-fills options from the active version's config snapshot, and creates a new version.
- AI cleanup only retry starts from the active version's final cues and creates a new version.
- Retry never silently uses the latest version if another version is active.
- If the active version lacks required data for a retry mode, the UI disables that mode or explains the fallback.

## Review Workspace

The center workspace uses the approved `Main Filmstrip, balanced` direction.

Layout:

- Main horizontal filmstrip at the top.
- Timeline below the filmstrip.
- OCR basket below the timeline.
- Version selector in the workspace.

Filmstrip:

- Shows bitmap cues as the primary visual review surface.
- The selected cue is larger and highlighted.
- Previous and next cues remain visible.
- Bitmap aspect ratio is preserved inside each tile.
- Tile width represents cue duration or bitmap width within bounded min/max constraints.
- Clicking a bitmap selects that cue.

Timeline:

- Displays the same time domain as the filmstrip.
- Dragging the timeline viewport changes the visible filmstrip window.
- Zooming the timeline changes the filmstrip scale.
- Scrolling the filmstrip updates the timeline viewport.
- Selecting a cue moves the timeline playhead to the cue timestamp.
- Synchronization is throttled through `requestAnimationFrame` and tracks active interaction source to avoid scroll loops.

OCR basket:

- Shows editable text for the selected cue.
- Editing cue text creates or updates a draft derived from the active version. Persisted versions are immutable until the user saves the draft as a new version.
- Saving/editing must not mutate raw OCR.

## Left Panel

The left panel follows existing MediaFlow tool patterns:

- Import button and drag/drop.
- File item cards.
- Status, progress, errors, and badges.
- Version count badge.
- Version dialog button.
- Retry action.
- Remove single/all.

For container tracks, item cards must clearly show the common source media and the specific stream/track metadata.

## Export

Supported formats:

- `ASS`
- `SRT`
- `VTT`

Exports use existing versioned export flows:

- File-by-file export from the item/version dialog.
- Global header export for all eligible source items/versions.

ASS export V1:

- Text-based ASS.
- No attempt to recreate bitmap styling, position, colors, outlines, or font metrics.
- Line breaks must display correctly.

SRT/VTT export:

- Real line breaks are preserved.
- Timing must be valid and monotonic for each exported cue list.

## Performance Requirements

The review surface must be designed for large subtitle tracks without lag.

Required strategies:

- Horizontal virtualization for filmstrip cue tiles.
- Lazy loading for thumbnails.
- Do not mount thousands of cue images in the DOM.
- Use lightweight timeline metadata, not bitmap images, for the timeline.
- Use a bounded image cache.
- Prefer small thumbnails for filmstrip tiles.
- Load a higher quality image only for the selected cue when needed.
- Release object URLs with `URL.revokeObjectURL()` when entries leave cache.
- Drop JS references to no-longer-visible images so the runtime can reclaim memory.
- Keep a small prefetch window around visible cues.
- Throttle filmstrip/timeline sync with `requestAnimationFrame`.

Backend performance:

- Avoid OCRing identical or near-identical bitmaps when safe to reuse prior OCR.
- Process cues sequentially or with bounded concurrency based on existing OCR engine constraints.
- Emit progress often enough for feedback but not so often that UI updates become expensive.
- Support cancellation and cleanup of temp extraction/OCR work.

## Error Handling

Expected errors:

- No compatible bitmap subtitle tracks found.
- Missing VobSub pair file.
- FFprobe failure.
- FFmpeg extraction failure.
- Unsupported bitmap subtitle codec.
- Decoder failure.
- OCR model missing.
- OCR engine failure.
- AI cleanup failure.
- Export write failure.

User-visible errors must be clear and should avoid exposing sensitive prompts, API keys, tokens, or large OCR payloads.

AI cleanup failure falls back to non-AI stabilized cues unless the operation was cancelled.

## Testing Plan

Frontend tests:

- VobSub pair resolution creates one item for `.idx/.sub`.
- Missing VobSub pair reports warning and does not create an OCR-ready item.
- Container track selection creates one source item per selected track.
- Import row `Default` model remains tied to global model until run time.
- Concrete row override is preserved after import.
- Active version controls filmstrip, timeline, OCR basket, retry, and export.
- Retry uses active version, not latest version.
- Filmstrip/timeline state mapping is deterministic and avoids feedback loops.
- Export requests include correct active/selected versions and formats.

Rust tests:

- Source validation for `.sup`, `.idx/.sub`, and container paths.
- FFmpeg extraction command construction for subtitle streams.
- VobSub pair validation.
- Cue text reconstruction from multiple OCR boxes.
- Dialogue dash fallback on single-block OCR.
- Conservative duplicate stabilization for identical adjacent text.
- ASS/SRT/VTT export preserves line breaks.
- Cancellation clears active temp work.

Integration or smoke tests:

- Import sample `.sup` or generated local fixture when available.
- Decode a small fixture and produce at least one OCR-ready cue.
- Persist and reload a Subtitle OCR version from `.mediaflow.json`.

## Implementation Notes

Likely new frontend areas:

- `src/lib/types/subtitle-ocr.ts`
- `src/lib/stores/subtitle-ocr.svelte.ts`
- `src/lib/components/views/SubtitleOcrView.svelte`
- `src/lib/components/subtitle-ocr/*`
- `src/lib/services/subtitle-ocr-storage.ts`
- `src/lib/services/subtitle-ocr-export.ts` or reuse shared versioned export helpers where practical.

Likely new backend area:

- `src-tauri/src/tools/subtitle_ocr/*`
- new command exports in `src-tauri/src/commands/mod.rs`
- new command registration in `src-tauri/src/lib.rs`

Implementation should reuse existing shared pieces where they fit:

- `FileItemCard`
- version browser/export dialogs
- `LlmProviderModelSelector`
- OCR model checks
- log/toast conventions
- `.mediaflow.json` sidecar patterns
- progress/cancellation patterns

## Approved Decisions

- Tool name: `Subtitle OCR`.
- New dedicated pipeline, not Video OCR reuse.
- Containers supported, disk folders and ISOs excluded in V1.
- Track selection dialog uses Audio to Subs style item rows.
- Each selected container track becomes a separate left-panel item.
- Import row OCR model default is `Default`; no language-based automatic model mapping.
- Center workspace uses Main Filmstrip, balanced.
- Filmstrip and timeline remain synchronized over timestamps.
- Versions persist to `.mediaflow.json`.
- Exports use existing versioned export dialogs and global header export.
- User-facing options are OCR model, Use GPU, and AI cleanup.
- Internal stabilization is conservative and hidden.
- AI cleanup handles intelligent correction and duplicate merge when enabled.
