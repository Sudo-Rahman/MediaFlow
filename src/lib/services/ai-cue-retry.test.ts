import { describe, expect, it } from 'vitest';

import {
  buildRetryRequest,
  buildRetrySpans,
  runAiCueRetries,
  type AiCueReplacement,
  type AiCueRetryCue,
  type AiCueRetryLogEvent,
} from './ai-cue-retry';

interface TestCue extends AiCueRetryCue {
  label: string;
}

interface TestReplacement extends AiCueReplacement {
  value: string;
}

function cues(count: number): TestCue[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: `c${index + 1}`,
    text: `source ${index + 1}`,
    label: `Cue ${index + 1}`,
  }));
}

describe('ai-cue-retry', () => {
  it('groups adjacent unresolved cues into retry spans', () => {
    const spans = buildRetrySpans(cues(9), new Set(['c2', 'c3', 'c5', 'c8', 'c9']));

    expect(spans).toEqual([
      { startIndex: 1, endIndex: 2, cueIds: ['c2', 'c3'] },
      { startIndex: 4, endIndex: 4, cueIds: ['c5'] },
      { startIndex: 7, endIndex: 8, cueIds: ['c8', 'c9'] },
    ]);
  });

  it('builds one grouped retry request with two context cues around each span', () => {
    const allCues = cues(9);
    const request = buildRetryRequest<TestCue, TestReplacement>({
      allCues,
      attempt: 1,
      unresolvedIds: new Set(['c4', 'c5', 'c8']),
      replacements: [
        { id: 'c3', value: 'accepted 3' },
        { id: 'c6', value: 'accepted 6' },
      ],
      buildContextCue: ({ cue, acceptedReplacement, position, spanIndex }) => ({
        id: cue.id,
        text: cue.text,
        acceptedText: acceptedReplacement?.value,
        position,
        spanIndex,
      }),
    });

    expect(request.attempt).toBe(1);
    expect(request.requestedCues.map(cue => cue.id)).toEqual(['c4', 'c5', 'c8']);
    expect(request.contextCues).toEqual([
      { id: 'c2', text: 'source 2', acceptedText: undefined, position: 'before', spanIndex: 0 },
      { id: 'c3', text: 'source 3', acceptedText: 'accepted 3', position: 'before', spanIndex: 0 },
      { id: 'c6', text: 'source 6', acceptedText: 'accepted 6', position: 'after', spanIndex: 0 },
      { id: 'c7', text: 'source 7', acceptedText: undefined, position: 'after', spanIndex: 0 },
      { id: 'c6', text: 'source 6', acceptedText: 'accepted 6', position: 'before', spanIndex: 1 },
      { id: 'c7', text: 'source 7', acceptedText: undefined, position: 'before', spanIndex: 1 },
      { id: 'c9', text: 'source 9', acceptedText: undefined, position: 'after', spanIndex: 1 },
    ]);
  });

  it('accumulates partial retry success and retries only remaining unresolved cues', async () => {
    const requests: string[][] = [];
    const result = await runAiCueRetries<TestCue, TestReplacement>({
      allCues: cues(4),
      initialReplacements: [{ id: 'c1', value: 'accepted 1' }],
      initialUnresolvedIds: new Set(['c2', 'c4']),
      runAttempt: request => {
        requests.push(request.requestedCues.map(cue => cue.id));

        if (requests.length === 1) {
          return {
            replacements: [{ id: 'c2', value: 'accepted 2' }],
            unresolvedIds: new Set(['c4']),
            usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
          };
        }

        return {
          replacements: [{ id: 'c4', value: 'accepted 4' }],
          unresolvedIds: new Set(),
          usage: { promptTokens: 7, completionTokens: 4, totalTokens: 11 },
        };
      },
    });

    expect(requests).toEqual([['c2', 'c4'], ['c4']]);
    expect(result.replacements).toEqual([
      { id: 'c1', value: 'accepted 1' },
      { id: 'c2', value: 'accepted 2' },
      { id: 'c4', value: 'accepted 4' },
    ]);
    expect([...result.unresolvedIds]).toEqual([]);
    expect(result.attempts).toBe(2);
    expect(result.usage).toEqual({ promptTokens: 17, completionTokens: 7, totalTokens: 24 });
  });

  it('ignores unknown IDs and treats duplicated requested IDs as unresolved', async () => {
    const logEvents: AiCueRetryLogEvent[] = [];
    const result = await runAiCueRetries<TestCue, TestReplacement>({
      allCues: cues(2),
      initialReplacements: [],
      initialUnresolvedIds: new Set(['c1', 'c2']),
      maxRetries: 1,
      runAttempt: () => ({
        replacements: [
          { id: 'c1', value: 'accepted 1a' },
          { id: 'c1', value: 'accepted 1b' },
          { id: 'c2', value: 'accepted 2' },
          { id: 'unknown', value: 'ignored' },
        ],
        unresolvedIds: new Set(),
      }),
      log: event => logEvents.push(event),
    });

    expect(result.replacements).toEqual([{ id: 'c2', value: 'accepted 2' }]);
    expect([...result.unresolvedIds]).toEqual(['c1']);
    expect(result.warnings.some(warning => warning.includes('unknown'))).toBe(true);
    expect(result.warnings.some(warning => warning.includes('duplicate'))).toBe(true);
    expect(logEvents.some(event => event.level === 'warning' && event.details.includes('duplicate'))).toBe(true);
  });

  it('stops retrying when an attempt is terminal', async () => {
    const requests: string[][] = [];
    const result = await runAiCueRetries<TestCue, TestReplacement>({
      allCues: cues(2),
      initialReplacements: [],
      initialUnresolvedIds: new Set(['c1', 'c2']),
      runAttempt: request => {
        requests.push(request.requestedCues.map(cue => cue.id));

        return {
          replacements: [],
          unresolvedIds: new Set(['c1', 'c2']),
          terminal: true,
          warning: 'Retry stopped because the provider truncated the response',
        };
      },
    });

    expect(requests).toEqual([['c1', 'c2']]);
    expect([...result.unresolvedIds]).toEqual(['c1', 'c2']);
    expect(result.stoppedByTerminalFailure).toBe(true);
    expect(result.warnings).toContain('Retry stopped because the provider truncated the response');
  });

  it('returns cancelled without scheduling more retries', async () => {
    const requests: string[][] = [];
    const result = await runAiCueRetries<TestCue, TestReplacement>({
      allCues: cues(2),
      initialReplacements: [],
      initialUnresolvedIds: new Set(['c1', 'c2']),
      runAttempt: request => {
        requests.push(request.requestedCues.map(cue => cue.id));

        return {
          replacements: [{ id: 'c1', value: 'discarded cancelled result' }],
          unresolvedIds: new Set(['c1', 'c2']),
          cancelled: true,
        };
      },
    });

    expect(requests).toEqual([['c1', 'c2']]);
    expect([...result.unresolvedIds]).toEqual(['c1', 'c2']);
    expect(result.cancelled).toBe(true);
    expect(result.attempts).toBe(1);
  });
});
