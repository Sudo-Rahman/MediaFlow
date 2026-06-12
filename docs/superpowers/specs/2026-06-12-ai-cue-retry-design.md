# AI Cue Retry Design

Date: 2026-06-12
Status: Approved in discussion

## Problem

MediaFlow uses AI calls to translate and clean subtitle cues in AI Translation, Video OCR AI cleanup, and Subtitle OCR AI cleanup. The model is instructed to return replacements for specific cue IDs, but it can omit IDs, return invalid cue entries, return malformed JSON, return empty content, or fail a provider call.

Today, these failures are not handled consistently. AI Translation can complete with warnings while silently leaving some cues in the source language. Video OCR and Subtitle OCR cleanup can discard an entire cleanup attempt even when some cue corrections are valid.

The desired behavior is partial success with targeted retry: keep every valid cue replacement, retry only unresolved cues, and leave any still-unresolved cues unchanged after retry exhaustion.

## Domain Language

- Subtitle cue: a single timed subtitle unit with text.
- Unresolved subtitle cue: a requested cue with no valid AI replacement after response parsing and local validation.
- Context cue: a neighboring cue supplied for meaning but not eligible for replacement.
- Retry span: a contiguous group of unresolved cues used to calculate context.
- Grouped AI retry: a retry attempt that resends unresolved cues together instead of issuing one request per cue.
- Partial AI result: a result where valid replacements are kept even if some cues remain unchanged.

## Goals

- Apply the same retry semantics to AI Translation, Video OCR AI cleanup, and Subtitle OCR AI cleanup.
- Keep valid cue replacements from every response, including partial retry responses.
- Retry only unresolved cues.
- Use exactly one initial attempt plus at most two targeted retry attempts per cue.
- Group unresolved cues in retry requests. Do not make one API call per cue.
- Add context cues to retries without allowing the model to modify or return those context cues.
- Preserve current completed-result behavior for mostly successful files, with warnings for unresolved cues.

## Non-Goals

- No visible retry settings in the UI.
- No user-facing batch-count behavior for retry attempts.
- No hidden retry splitting when a retry prompt is large.
- No move of prompt orchestration into Rust/Tauri.
- No change to Tauri command APIs.

## Core Behavior

AI-assisted subtitle processing will use a shared frontend retry helper with workflow-specific adapters for prompt construction, response parsing, and applying replacements.

The helper will:

1. Send the initial request or batch request using the workflow's existing call shape.
2. Parse and validate returned cue replacements.
3. Add every valid replacement to an accumulated result map.
4. Mark all missing or invalid requested cues as unresolved.
5. Retry only unresolved cues, grouped into one request per retry attempt.
6. Repeat step 2 through step 5 for at most two targeted retries.
7. Return accumulated replacements plus unresolved cue metadata for logging.

A partial retry response is useful. If a retry asks for 50 unresolved cues and returns 40 valid replacements, those 40 are immediately accumulated. The next retry asks only for the remaining 10.

## Failed Cue Definition

A requested cue is unresolved when:

- its ID is missing from the response;
- its replacement field is absent or invalid for the workflow;
- the response is empty;
- the response cannot be parsed;
- the response is truncated;
- the provider call fails in a retryable way.

Unknown IDs from the model are ignored. Duplicate returned IDs are treated as invalid for that ID unless the workflow can safely choose one without ambiguity. Setup failures such as missing API key, missing model, or cancellation do not enter the retry loop.

## Retry Context

Retries include context, but only unresolved cues are eligible for replacement.

For each retry attempt:

1. Build retry spans from adjacent unresolved cues.
2. For each span, include up to two context cues before the first unresolved cue and up to two context cues after the last unresolved cue.
3. Send all unresolved cues from all spans in the request's `cues` list.
4. Send context cues in a separate `contextCues` structure.
5. Instruct the model to return replacements only for IDs in `cues`.

For AI Translation, context cues include source text and, when available, the already accepted translated text. For Video OCR and Subtitle OCR cleanup, context cues include the current OCR text only.

Retries do not use the user's batch count. The retry attempt is grouped into a single request. If a retry is truncated, reaches max tokens, hits a context-limit provider error, or returns unusable content because of prompt size, MediaFlow logs a warning and leaves the remaining unresolved cues unchanged. It does not split the retry or reduce context.

## Workflow Integration

### AI Translation

`translatePromptCueBatches` should keep its current initial batching behavior. After each initial batch, it should collect valid translations and unresolved IDs. Once the initial phase has finished, unresolved cues are retried by the shared helper using grouped retry attempts with context cues.

The final reconstructed subtitle should include every accepted translation. Cues that remain unresolved after retry exhaustion fall back to their original source text through the existing reconstructor. The translation result can remain successful, but it should carry a warning message and log the unresolved count.

Theme and visual preflight behavior should continue to fall back into the main translation phase when unresolved. The new retry helper applies to the phase that is responsible for producing final cue replacements.

### Video OCR AI Cleanup

`cleanupOcrSubtitlesWithAi` should stop discarding the whole cleanup when a batch response is partially valid. It should accumulate valid corrections, retry unresolved cues, and keep original OCR text for unresolved cues after exhaustion.

Duplicate merging happens after the final accumulated cleanup result is assembled.

### Subtitle OCR AI Cleanup

`cleanupSubtitleOcrCuesWithAi` should use the same partial-result behavior. A cleanup-only version may be created when at least one correction is valid. If zero corrections are valid, cleanup remains unapplied as it does today.

Unresolved cues keep their original OCR text in the final version, and the log panel records that cleanup was partially applied.

## Logging, Status, and Progress

Retry behavior should be visible in the log panel without turning a mostly successful file into a failed file.

Expected log messages:

- `Retrying 12 unresolved cue(s), attempt 1/2`
- `Retry recovered 8/12 cue(s); 4 remain unresolved`
- `4 cue(s) remained unchanged after 2 retry attempts`
- `Retry stopped because the provider truncated the response`

Workflow status remains completed when a usable partial result exists. Translation may keep a warning in `result.error` for compatibility with the current UI. Cleanup logs should distinguish partial cleanup from full cleanup failure.

Progress can stay within the existing AI phase. No new progress controls are required.

## Testing Plan

Add focused tests for the shared helper:

- full success on initial attempt;
- missing IDs trigger retry for only unresolved cues;
- partial retry success is accumulated before the next retry;
- unresolved cues remain unchanged after two retries;
- unknown IDs do not corrupt requested cue handling;
- duplicate IDs are handled without losing other valid cues;
- empty, invalid JSON, truncated, and retryable provider failures mark requested cues unresolved;
- cancellation stops without retries;
- retry context windows are correct for adjacent spans and dispersed cues.

Add integration tests:

- AI Translation keeps a 99 percent translated result successful, recovers cues through retry, leaves final unresolved cues as source text, and logs a warning.
- Video OCR AI cleanup applies valid corrections, preserves original OCR text for unresolved cues, and merges duplicates after accumulation.
- Subtitle OCR AI cleanup creates a cleanup version when at least one correction is valid and does not create one when zero corrections are valid.

Run targeted Vitest files for changed services, then `pnpm check` after TypeScript changes.

## Documentation Impact

`CONTEXT.md` records the domain vocabulary around subtitle cues, context cues, retry spans, grouped AI retries, partial AI results, and retry exhaustion. No ADR is needed because this design is localized to AI-assisted subtitle processing and can be revised without a hard architectural migration.
