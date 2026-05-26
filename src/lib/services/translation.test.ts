import { beforeEach, describe, expect, it, vi } from 'vitest';

const callLlmMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/stores', () => ({
  settingsStore: {
    getLLMApiKey: vi.fn(() => 'test-api-key'),
  },
}));

vi.mock('$lib/utils/log-toast', () => ({
  log: vi.fn(),
}));

vi.mock('./llm-client', () => ({
  callLlm: callLlmMock,
}));

vi.mock('./sleep-inhibit', () => ({
  withSleepInhibit: vi.fn(async (_reason: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('./translation-memory', () => ({
  getThemeMemoryEntries: vi.fn(async () => new Map()),
  getTranslationMemoryScopeKey: vi.fn(() => '/subs'),
  touchThemeMemoryEntries: vi.fn(async () => undefined),
  upsertThemeMemoryEntries: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

function denseAssText(): string {
  const tags = Array.from({ length: 16 }, (_, index) => `{\\c&H${index.toString(16).padStart(6, '0')}&}`);
  return `DenseUnique Campaign ${tags.join('')}Speech Assembly`;
}

function buildAssFixture(includeOpening = true): string {
  const openingLine = includeOpening
    ? 'Dialogue: 0,0:00:05.00,0:00:06.00,Opening-English,,0,0,0,,{\\fad(100,100)}Opening words'
    : null;

  return [
    '[Script Info]',
    'Title: Translation test',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1',
    'Style: PollTS,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1',
    'Style: CampaignTS,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1',
    'Style: Opening-English,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello there.',
    'Dialogue: 0,0:00:02.00,0:00:03.00,PollTS,,0,0,0,,{\\pos(100,100)}Candidate\\NName',
    'Dialogue: 0,0:00:03.00,0:00:04.00,PollTS,,0,0,0,,{\\pos(101,101)}Candidate\\NName',
    `Dialogue: 0,0:00:04.00,0:00:05.00,CampaignTS,,0,0,0,,${denseAssText()}`,
    openingLine,
  ].filter((line): line is string => line !== null).join('\n');
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function parseUserPromptCues(userPrompt: string): Array<{ id: string; text: string }> {
  return JSON.parse(userPrompt.slice(userPrompt.indexOf('{'))).cues;
}

describe('AI translation ASS visual text planning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (command: string, args?: { responseText?: string }) => {
      if (command === 'parse_translation_response') {
        const parsed = JSON.parse(args?.responseText ?? '{}') as { cues?: Array<{ id: string; translatedText: string }> };
        return {
          success: true,
          cues: parsed.cues ?? [],
          warnings: [],
        };
      }

      throw new Error(`Unexpected invoke command: ${command}`);
    });
  });

  it('deduplicates simple repeated ASS typesetting and skips dense visual text in token prompts', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');

    const prompt = buildFullPromptForTokenCount(buildAssFixture(), 'en', 'fr');

    expect(countOccurrences(prompt, '~p0:Candidate~p1:Name')).toBe(1);
    expect(prompt).not.toContain('DenseUnique Campaign');
    expect(prompt).toContain('Hello there.');
    expect(prompt).toContain('Opening words');
    expect(prompt).toContain('"id":"THEME_0"');
    expect(prompt).toContain('"id":"VISUAL_0"');
  });

  it('translates grouped visual text once, expands it to every occurrence, and preserves dense visual text', async () => {
    const { translateSubtitle } = await import('./translation');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const cues = parseUserPromptCues(request.userPrompt);
      const translatedCues = cues.map((cue) => {
        if (cue.id.startsWith('VISUAL_')) {
          return {
            id: cue.id,
            translatedText: cue.text.replace('Candidate', 'Candidat').replace('Name', 'Nom'),
          };
        }

        return {
          id: cue.id,
          translatedText: cue.text.replace('Hello there.', 'Bonjour.'),
        };
      });

      return {
        content: JSON.stringify({ cues: translatedCues }),
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      };
    });

    const result = await translateSubtitle(
      {
        name: 'episode.ass',
        path: '/subs/episode.ass',
        content: buildAssFixture(false),
        format: 'ass',
        size: 1,
      },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(result.translatedContent).toContain('Bonjour.');
    expect(result.translatedContent).toContain('{\\pos(100,100)}Candidat\\NNom');
    expect(result.translatedContent).toContain('{\\pos(101,101)}Candidat\\NNom');
    expect(result.translatedContent).toContain(denseAssText());

    const promptCueBatches = callLlmMock.mock.calls.map(([request]) => parseUserPromptCues(request.userPrompt));
    expect(promptCueBatches).toEqual([
      [{ id: 'VISUAL_0', text: '~p0:Candidate~p1:Name' }],
      [{ id: 'ASS_0_L12', text: 'Hello there.' }],
    ]);
    expect(warnSpy).not.toHaveBeenCalledWith('Translation validation errors:', expect.anything());

    warnSpy.mockRestore();
  });
});
