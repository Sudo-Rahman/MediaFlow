import type { LlmUsage } from './llm-client';

export const AI_CUE_RETRY_LIMIT = 2;
export const AI_CUE_CONTEXT_RADIUS = 2;

export function isTokenOrContextLimitError(error: string | undefined): boolean {
  if (!error) {
    return false;
  }

  const normalized = error.toLowerCase();
  return [
    'context_length',
    'context length',
    'context window',
    'maximum context',
    'max context',
    'too many tokens',
    'token limit',
    'tokens limit',
    'maximum token',
    'max token',
    'input is too long',
    'input length',
    'prompt is too long',
    'request too large',
  ].some(marker => normalized.includes(marker));
}

export interface AiCueRetryCue {
  id: string;
  text: string;
}

export interface AiCueReplacement {
  id: string;
}

export type AiCueContextPosition = 'before' | 'after';

export interface AiCueRetryContextCue {
  id: string;
  text: string;
  acceptedText?: string;
  position: AiCueContextPosition;
  spanIndex: number;
}

export interface AiCueRetrySpan {
  startIndex: number;
  endIndex: number;
  cueIds: string[];
}

export interface AiCueRetryRequest<
  TCue extends AiCueRetryCue,
  TContextCue extends AiCueRetryContextCue,
> {
  attempt: number;
  requestedCues: TCue[];
  contextCues: TContextCue[];
}

export interface AiCueRetryAttemptResult<TReplacement extends AiCueReplacement> {
  replacements: TReplacement[];
  unresolvedIds: Set<string>;
  usage?: LlmUsage;
  warning?: string;
  terminal?: boolean;
  cancelled?: boolean;
}

export interface AiCueRetryLogEvent {
  level: 'info' | 'warning';
  title: string;
  details: string;
}

export interface AiCueRetryResult<TReplacement extends AiCueReplacement> {
  replacements: TReplacement[];
  unresolvedIds: Set<string>;
  attempts: number;
  usage?: LlmUsage;
  stoppedByTerminalFailure: boolean;
  cancelled: boolean;
  warnings: string[];
}

interface BuildContextCueOptions<
  TCue extends AiCueRetryCue,
  TReplacement extends AiCueReplacement,
> {
  cue: TCue;
  acceptedReplacement?: TReplacement;
  position: AiCueContextPosition;
  spanIndex: number;
}

interface BuildRetryRequestOptions<
  TCue extends AiCueRetryCue,
  TReplacement extends AiCueReplacement,
  TContextCue extends AiCueRetryContextCue,
> {
  allCues: readonly TCue[];
  unresolvedIds: Iterable<string>;
  attempt: number;
  replacements?: readonly TReplacement[];
  contextRadius?: number;
  buildContextCue?: (options: BuildContextCueOptions<TCue, TReplacement>) => TContextCue;
}

export interface RunAiCueRetriesOptions<
  TCue extends AiCueRetryCue,
  TReplacement extends AiCueReplacement,
  TContextCue extends AiCueRetryContextCue = AiCueRetryContextCue,
> {
  allCues: readonly TCue[];
  initialReplacements: readonly TReplacement[];
  initialUnresolvedIds: Iterable<string>;
  maxRetries?: number;
  contextRadius?: number;
  buildContextCue?: (options: BuildContextCueOptions<TCue, TReplacement>) => TContextCue;
  runAttempt: (
    request: AiCueRetryRequest<TCue, TContextCue>
  ) => AiCueRetryAttemptResult<TReplacement> | Promise<AiCueRetryAttemptResult<TReplacement>>;
  log?: (event: AiCueRetryLogEvent) => void;
}

export function buildRetrySpans<TCue extends AiCueRetryCue>(
  allCues: readonly TCue[],
  unresolvedIds: Iterable<string>,
): AiCueRetrySpan[] {
  const unresolvedIdSet = new Set(unresolvedIds);
  const spans: AiCueRetrySpan[] = [];
  let activeSpan: AiCueRetrySpan | undefined;

  allCues.forEach((cue, index) => {
    if (!unresolvedIdSet.has(cue.id)) {
      activeSpan = undefined;
      return;
    }

    if (activeSpan && activeSpan.endIndex === index - 1) {
      activeSpan.endIndex = index;
      activeSpan.cueIds.push(cue.id);
      return;
    }

    activeSpan = {
      startIndex: index,
      endIndex: index,
      cueIds: [cue.id],
    };
    spans.push(activeSpan);
  });

  return spans;
}

export function buildRetryRequest<
  TCue extends AiCueRetryCue,
  TReplacement extends AiCueReplacement,
  TContextCue extends AiCueRetryContextCue = AiCueRetryContextCue,
>(
  options: BuildRetryRequestOptions<TCue, TReplacement, TContextCue>,
): AiCueRetryRequest<TCue, TContextCue> {
  const contextRadius = options.contextRadius ?? AI_CUE_CONTEXT_RADIUS;
  const unresolvedIdSet = new Set(options.unresolvedIds);
  const replacementById = new Map((options.replacements ?? []).map(replacement => [replacement.id, replacement]));
  const spans = buildRetrySpans(options.allCues, unresolvedIdSet);
  const requestedCues = options.allCues.filter(cue => unresolvedIdSet.has(cue.id));
  const contextCues: TContextCue[] = [];

  spans.forEach((span, spanIndex) => {
    const beforeStartIndex = Math.max(0, span.startIndex - contextRadius);

    for (let index = beforeStartIndex; index < span.startIndex; index += 1) {
      if (unresolvedIdSet.has(options.allCues[index].id)) continue;

      contextCues.push(
        buildContextCue(options, options.allCues[index], replacementById, 'before', spanIndex)
      );
    }

    const afterEndIndex = Math.min(options.allCues.length - 1, span.endIndex + contextRadius);

    for (let index = span.endIndex + 1; index <= afterEndIndex; index += 1) {
      if (unresolvedIdSet.has(options.allCues[index].id)) continue;

      contextCues.push(
        buildContextCue(options, options.allCues[index], replacementById, 'after', spanIndex)
      );
    }
  });

  return {
    attempt: options.attempt,
    requestedCues,
    contextCues,
  };
}

export async function runAiCueRetries<
  TCue extends AiCueRetryCue,
  TReplacement extends AiCueReplacement,
  TContextCue extends AiCueRetryContextCue = AiCueRetryContextCue,
>(
  options: RunAiCueRetriesOptions<TCue, TReplacement, TContextCue>,
): Promise<AiCueRetryResult<TReplacement>> {
  const maxRetries = options.maxRetries ?? AI_CUE_RETRY_LIMIT;
  const replacements: TReplacement[] = [...options.initialReplacements];
  const acceptedReplacementIds = new Set(replacements.map(replacement => replacement.id));
  let unresolvedIds = removeAcceptedIds(new Set(options.initialUnresolvedIds), acceptedReplacementIds);
  let attempts = 0;
  let usage: LlmUsage | undefined;
  let stoppedByTerminalFailure = false;
  let cancelled = false;
  const warnings: string[] = [];

  while (attempts < maxRetries && unresolvedIds.size > 0) {
    const attempt = attempts + 1;
    const request = buildRetryRequest<TCue, TReplacement, TContextCue>({
      allCues: options.allCues,
      unresolvedIds,
      attempt,
      replacements,
      contextRadius: options.contextRadius,
      buildContextCue: options.buildContextCue,
    });

    options.log?.({
      level: 'info',
      title: 'AI cue retry started',
      details: `Retry attempt ${attempt} started for ${request.requestedCues.length} cue(s).`,
    });

    const attemptResult = await options.runAttempt(request);
    attempts = attempt;

    if (attemptResult.usage) {
      usage = addUsage(usage, attemptResult.usage);
    }

    if (attemptResult.warning) {
      addWarning(warnings, options.log, attemptResult.warning);
    }

    if (attemptResult.cancelled) {
      cancelled = true;
      options.log?.({
        level: 'info',
        title: 'AI cue retry cancelled',
        details: `Retry attempt ${attempt} was cancelled with ${unresolvedIds.size} unresolved cue(s).`,
      });
      break;
    }

    const normalized = normalizeAttemptReplacements(attemptResult.replacements, request.requestedCues);
    for (const warning of normalized.warnings) {
      addWarning(warnings, options.log, warning);
    }

    replacements.push(...normalized.acceptedReplacements);
    for (const replacement of normalized.acceptedReplacements) {
      acceptedReplacementIds.add(replacement.id);
    }

    unresolvedIds = buildNextUnresolvedIds(request.requestedCues, normalized.acceptedIds);

    options.log?.({
      level: 'info',
      title: 'AI cue retry finished',
      details: `Retry attempt ${attempt} accepted ${normalized.acceptedReplacements.length} cue(s) and left ${unresolvedIds.size} unresolved.`,
    });

    if (attemptResult.terminal) {
      stoppedByTerminalFailure = true;
      break;
    }
  }

  if (unresolvedIds.size > 0 && attempts >= maxRetries && !cancelled && !stoppedByTerminalFailure) {
    options.log?.({
      level: 'warning',
      title: 'AI cue retry exhausted',
      details: `Retry limit reached with ${unresolvedIds.size} unresolved cue(s).`,
    });
  }

  if (unresolvedIds.size > 0 && !cancelled) {
    addWarning(
      warnings,
      options.log,
      `${unresolvedIds.size} cue(s) remained unchanged after ${attempts} retry attempt(s).`,
    );
  }

  return {
    replacements,
    unresolvedIds,
    attempts,
    usage,
    stoppedByTerminalFailure,
    cancelled,
    warnings,
  };
}

function buildContextCue<
  TCue extends AiCueRetryCue,
  TReplacement extends AiCueReplacement,
  TContextCue extends AiCueRetryContextCue,
>(
  options: BuildRetryRequestOptions<TCue, TReplacement, TContextCue>,
  cue: TCue,
  replacementById: ReadonlyMap<string, TReplacement>,
  position: AiCueContextPosition,
  spanIndex: number,
): TContextCue {
  const acceptedReplacement = replacementById.get(cue.id);

  if (options.buildContextCue) {
    return options.buildContextCue({ cue, acceptedReplacement, position, spanIndex });
  }

  return {
    id: cue.id,
    text: cue.text,
    position,
    spanIndex,
  } as TContextCue;
}

function removeAcceptedIds(unresolvedIds: Set<string>, acceptedIds: ReadonlySet<string>): Set<string> {
  return new Set([...unresolvedIds].filter(id => !acceptedIds.has(id)));
}

function buildNextUnresolvedIds<TCue extends AiCueRetryCue>(
  requestedCues: readonly TCue[],
  acceptedIds: ReadonlySet<string>,
): Set<string> {
  return new Set(requestedCues.map(cue => cue.id).filter(id => !acceptedIds.has(id)));
}

function normalizeAttemptReplacements<TCue extends AiCueRetryCue, TReplacement extends AiCueReplacement>(
  replacements: readonly TReplacement[],
  requestedCues: readonly TCue[],
): {
  acceptedReplacements: TReplacement[];
  acceptedIds: Set<string>;
  warnings: string[];
} {
  const requestedIds = new Set(requestedCues.map(cue => cue.id));
  const replacementsByRequestedId = new Map<string, TReplacement[]>();
  const warnings: string[] = [];

  for (const replacement of replacements) {
    if (!requestedIds.has(replacement.id)) {
      warnings.push(`Ignored retry replacement for unknown cue id "${replacement.id}".`);
      continue;
    }

    const existing = replacementsByRequestedId.get(replacement.id) ?? [];
    existing.push(replacement);
    replacementsByRequestedId.set(replacement.id, existing);
  }

  const acceptedReplacements: TReplacement[] = [];
  const acceptedIds = new Set<string>();

  for (const cue of requestedCues) {
    const cueReplacements = replacementsByRequestedId.get(cue.id) ?? [];

    if (cueReplacements.length === 1) {
      acceptedReplacements.push(cueReplacements[0]);
      acceptedIds.add(cue.id);
      continue;
    }

    if (cueReplacements.length > 1) {
      warnings.push(`Ignored duplicate retry replacements for cue id "${cue.id}".`);
    }
  }

  return {
    acceptedReplacements,
    acceptedIds,
    warnings,
  };
}

function addUsage(current: LlmUsage | undefined, next: LlmUsage): LlmUsage {
  if (!current) {
    return { ...next };
  }

  return {
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
    totalTokens: current.totalTokens + next.totalTokens,
  };
}

function addWarning(
  warnings: string[],
  log: ((event: AiCueRetryLogEvent) => void) | undefined,
  warning: string,
): void {
  warnings.push(warning);
  log?.({
    level: 'warning',
    title: 'AI cue retry warning',
    details: warning,
  });
}
