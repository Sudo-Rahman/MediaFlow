# MediaFlow

MediaFlow is a local-first multimedia toolbox for transforming media-derived text, tracks, and files while preserving user control over each processing result.

## Language

**Subtitle cue**:
A single timed subtitle unit with text that can be translated, cleaned, reconstructed, exported, or reviewed.
_Avoid_: queue, subtitle line

**Execution queue**:
A scheduling mechanism for asynchronous work items.
_Avoid_: cue

**Partial AI result**:
An AI-assisted subtitle result where valid cue replacements are kept even if some requested cues remain unchanged.
_Avoid_: failed file, all-or-nothing result

**Unresolved subtitle cue**:
A requested subtitle cue that has no valid AI replacement after response parsing and local validation.
_Avoid_: failed queue

**Context cue**:
A neighboring subtitle cue supplied to an AI request for meaning but not eligible for replacement in that response.
_Avoid_: retry target, requested cue

**Retry span**:
A contiguous group of unresolved subtitle cues retried together with neighboring context cues.
_Avoid_: retry queue, failed batch

**Grouped AI retry**:
A retry attempt that resends unresolved subtitle cues together instead of issuing one model request per cue.
_Avoid_: cue-by-cue retry

**Retry exhaustion**:
The point where unresolved subtitle cues stop being retried and remain unchanged with a warning.
_Avoid_: hard failure

**AI-assisted subtitle processing**:
Any AI translation or OCR cleanup workflow that asks a model to return replacements for subtitle cues.
_Avoid_: AI queue processing

## Relationships

- A **Subtitle cue** belongs to one subtitle stream, OCR result, or translated subtitle file.
- An **Execution queue** may process work that affects many **Subtitle cues**, but it is not itself subtitle content.
- A **Partial AI result** may contain both successfully processed **Subtitle cues** and unchanged **Subtitle cues** after retry attempts are exhausted.
- An **Unresolved subtitle cue** is retried without resending already resolved **Subtitle cues**.
- A **Context cue** may guide retry quality but must not be returned as a replacement.
- A **Retry span** includes all adjacent **Unresolved subtitle cues** and may include two **Context cues** before and two after the span.
- A **Grouped AI retry** may contain multiple **Retry spans** in one AI request.
- **Retry exhaustion** may happen after two targeted retries or immediately when a retry is truncated or rejected for context size.
- **AI-assisted subtitle processing** keeps valid replacements from a **Partial AI result** instead of discarding the whole result.

## Example dialogue

> **Dev:** "When an AI response omits a **Subtitle cue**, should we retry the missing cue or mark the translation complete?"
> **Domain expert:** "Retry the missing **Subtitle cue**. If retries are exhausted, keep every successful replacement and warn about the unchanged cues."

## Flagged ambiguities

- "queue" was used to mean **Subtitle cue** in AI translation and OCR cleanup discussions; resolved: use **Subtitle cue** for subtitle content and **Execution queue** only for asynchronous scheduling.
