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

function denseCampaignText(): string {
  const words = ['Student', 'Council', 'Presidential', 'Elections', 'Campaign', 'Speech', 'Assembly'];
  const tags = Array.from({ length: 20 }, (_, index) => `{\\c&H${index.toString(16).padStart(6, '0')}&}`);
  return [
    tags[0],
    words[0],
    ' ',
    tags[1],
    words[1],
    ' ',
    tags[2],
    words[2],
    ' ',
    tags[3],
    words[3],
    ' ',
    tags[4],
    words[4],
    ' ',
    tags.slice(5).join(''),
    words[5],
    ' ',
    words[6],
  ].join('');
}

function fragmentedCampaignText(): string {
  return [
    '{\\pos(646.125,-8.75)\\b1\\blur0.5\\an5\\fs80\\fscy55\\fscx45\\c&H254156&}',
    'Stu',
    '{\\c&H415968&}',
    'den',
    '{\\c&H35566C&}',
    't ',
    '{\\c&H325266&}',
    'C',
    '{\\c&H406379&}',
    'ou',
    '{\\c&H486B7E&}',
    'n',
    '{\\c&H49697E&}',
    'c',
    '{\\c&H497489&}',
    'il ',
    '{\\c&H517A91&}',
    'Pre',
    '{\\c&H5B8396&}',
    'si',
    '{\\c&H608A9D&}',
    'd',
    '{\\c&H668E99&}',
    'en',
    '{\\c&H6890A0&}',
    'tial ',
    '{\\c&H6598A7&}',
    'Elections\\h\\h\\h',
    '{\\c&H5D869A&}',
    'Camp',
    '{\\c&H577F95&}',
    'aig',
    '{\\c&H487289&}',
    'n ',
    '{\\c&H3C697B&}',
    'Sp',
    '{\\c&H395A6E&}',
    'eec',
    '{\\c&H2B4C62&}',
    'h ',
    '{\\c&H2B4357&}',
    'As',
    '{\\c&H2D4558&}',
    'se',
    '{\\c&H283D53&}',
    'm',
    '{\\c&H283C53&}',
    'b',
    '{\\c&H1D3044&}',
    'ly',
  ].join('');
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

function buildAssWithEvents(events: string[], options: { extraStyles?: string[] } = {}): string {
  return [
    '[Script Info]',
    'Title: Translation test',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1',
    'Style: PollTS,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1',
    'Style: CampaignTS,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1',
    'Style: SignTS,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1',
    'Style: ShowTitleTS,Aubrey,100,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,120,100,0,0,1,0,0,5,10,10,10,1',
    ...(options.extraStyles ?? []),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
  ].join('\n');
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

interface PromptPayload {
  cues: Array<{ id: string; text: string }>;
  contextCues?: Array<{
    id: string;
    text: string;
    translatedText?: string;
    position?: string;
    spanIndex?: number;
  }>;
}

function parseUserPromptPayload(userPrompt: string): PromptPayload {
  const parsed = JSON.parse(userPrompt.slice(userPrompt.indexOf('{'))) as Partial<PromptPayload>;

  return {
    cues: parsed.cues ?? [],
    contextCues: parsed.contextCues,
  };
}

function parseUserPromptCues(userPrompt: string): Array<{ id: string; text: string }> {
  return parseUserPromptPayload(userPrompt).cues;
}

function allPromptCues(): Array<{ id: string; text: string }> {
  return callLlmMock.mock.calls.flatMap(([request]) => parseUserPromptCues(request.userPrompt));
}

function normalizeReadableText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[^\S\r\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripAssReadableText(value: string): string {
  return normalizeReadableText(
    value
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/g, ' ')
  );
}

function extractEventText(content: string, style: string): string {
  const line = content
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith('Dialogue:') && candidate.includes(`,${style},`));
  return line?.split(',,').at(-1) ?? '';
}

function replaceReadableTextInSkeleton(text: string, replacement: string): string {
  let replaced = false;

  return text
    .split(/(⟦[A-Z]+_\d+⟧)/g)
    .map((part) => {
      if (/^⟦[A-Z]+_\d+⟧$/.test(part)) {
        return part;
      }

      if (part.trim().length === 0) {
        return part;
      }

      if (!replaced) {
        replaced = true;
        return replacement;
      }

      return '';
    })
    .join('');
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

  it('deduplicates simple repeated ASS typesetting and sends dense visual text as readable text', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');

    const prompt = buildFullPromptForTokenCount(buildAssFixture(), 'en', 'fr');

    expect(countOccurrences(prompt, '~p0:Candidate~p1:Name')).toBe(1);
    expect(countOccurrences(prompt, 'DenseUnique Campaign Speech Assembly')).toBe(1);
    expect(prompt).not.toContain('\\c&H000000&');
    expect(prompt).toContain('Hello there.');
    expect(prompt).toContain('Opening words');
    expect(prompt).toContain('"id":"THEME_0"');
    expect(prompt).toContain('"id":"VISUAL_0"');
  });

  it('translates only the English theme layer when source language is English', async () => {
    const { buildFullPromptForTokenCount, translateSubtitle } = await import('./translation');
    const content = buildAssWithEvents(
      [
        'Dialogue: 0,0:00:01.00,0:00:02.00,Ending8-English,,0,0,0,,Like being in the sun',
        'Dialogue: 0,0:00:01.00,0:00:02.00,Ending8-Romaji,,0,0,0,,Itsumo hidamari no you ni',
        'Comment: 0,0:00:01.00,0:00:02.00,Ending8-Kanji,,0,0,0,Karaoke,いつも陽だまりのように',
      ],
      {
        extraStyles: [
          'Style: Ending8-English,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
          'Style: Ending8-Romaji,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
          'Style: Ending8-Kanji,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
        ],
      }
    );

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');

    expect(prompt).toContain('Like being in the sun');
    expect(prompt).not.toContain('Itsumo hidamari no you ni');
    expect(prompt).not.toContain('いつも陽だまりのように');

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const cues = parseUserPromptCues(request.userPrompt);
      return {
        content: JSON.stringify({
          cues: cues.map((cue) => ({
            id: cue.id,
            translatedText: cue.text.replace('Like being in the sun', 'Comme au soleil'),
          })),
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const result = await translateSubtitle(
      { name: 'ending.ass', path: '/subs/ending.ass', content, format: 'ass', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(result.translatedContent).toContain('Comme au soleil');
    expect(result.translatedContent).toContain('Itsumo hidamari no you ni');
    expect(result.translatedContent).toContain('いつも陽だまりのように');
    expect(allPromptCues()).toEqual([{ id: 'THEME_0', text: 'Like being in the sun' }]);
  });

  it('uses source language aliases to keep only the matching Portuguese lyrics layer', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents(
      [
        'Dialogue: 0,0:00:01.00,0:00:02.00,Opening-PTBR,,0,0,0,,Como estar ao sol',
        'Dialogue: 0,0:00:01.00,0:00:02.00,Opening-Roma,,0,0,0,,Itsumo hidamari no you ni',
        'Dialogue: 0,0:00:01.00,0:00:02.00,Opening-JP,,0,0,0,,いつも陽だまりのように',
      ],
      {
        extraStyles: [
          'Style: Opening-PTBR,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
          'Style: Opening-Roma,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
          'Style: Opening-JP,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
        ],
      }
    );

    const prompt = buildFullPromptForTokenCount(content, 'pt', 'fr');

    expect(prompt).toContain('Como estar ao sol');
    expect(prompt).not.toContain('Itsumo hidamari no you ni');
    expect(prompt).not.toContain('いつも陽だまりのように');
  });

  it('uses Japanese script layers when source language is Japanese', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents(
      [
        'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Japanese,,0,0,0,,いつも陽だまりのように',
        'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-English,,0,0,0,,Like being in the sun',
        'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Romaji,,0,0,0,,Itsumo hidamari no you ni',
      ],
      {
        extraStyles: [
          'Style: Ending-Japanese,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
          'Style: Ending-English,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
          'Style: Ending-Romaji,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
        ],
      }
    );

    const prompt = buildFullPromptForTokenCount(content, 'ja', 'fr');

    expect(prompt).toContain('いつも陽だまりのように');
    expect(prompt).not.toContain('Like being in the sun');
    expect(prompt).not.toContain('Itsumo hidamari no you ni');
  });

  it('infers the English source theme layer in auto-detect mode', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-English,,0,0,0,,Like being in the sun',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Romanji,,0,0,0,,Itsumo hidamari no you ni',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Kanji,,0,0,0,,いつも陽だまりのように',
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'auto', 'fr');

    expect(prompt).toContain('Like being in the sun');
    expect(prompt).not.toContain('Itsumo hidamari no you ni');
    expect(prompt).not.toContain('いつも陽だまりのように');
  });

  it('infers Japanese source theme layers in auto-detect mode', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-JP,,0,0,0,,いつも陽だまりのように',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Romaji,,0,0,0,,Itsumo hidamari no you ni',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Kanji,,0,0,0,,ひらがな字幕',
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'auto', 'fr');

    expect(prompt).toContain('いつも陽だまりのように');
    expect(prompt).not.toContain('Itsumo hidamari no you ni');
    expect(prompt).not.toContain('ひらがな字幕');
  });

  it('infers non-English source theme layers in auto-detect mode', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Portuguese,,0,0,0,,Como estar ao sol',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Romaji,,0,0,0,,Itsumo hidamari no you ni',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Kanji,,0,0,0,,いつも陽だまりのように',
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'auto', 'fr');

    expect(prompt).toContain('Como estar ao sol');
    expect(prompt).not.toContain('Itsumo hidamari no you ni');
    expect(prompt).not.toContain('いつも陽だまりのように');
  });

  it('keeps auto-detect theme layers when multiple non-target source layers are present', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-English,,0,0,0,,Like being in the sun',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Portuguese,,0,0,0,,Como estar ao sol',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Romaji,,0,0,0,,Itsumo hidamari no you ni',
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'auto', 'fr');

    expect(prompt).toContain('Like being in the sun');
    expect(prompt).toContain('Como estar ao sol');
    expect(prompt).toContain('Itsumo hidamari no you ni');
  });

  it('keeps auto-detect theme layers when no explicit source layer is present', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Romaji,,0,0,0,,Itsumo hidamari no you ni',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Kanji,,0,0,0,,いつも陽だまりのように',
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'auto', 'fr');

    expect(prompt).toContain('Itsumo hidamari no you ni');
    expect(prompt).toContain('いつも陽だまりのように');
  });

  it('excludes existing target-language theme layers in auto-detect mode', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-English,,0,0,0,,Like being in the sun',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-French,,0,0,0,,Comme au soleil',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Romaji,,0,0,0,,Itsumo hidamari no you ni',
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'auto', 'fr');

    expect(prompt).toContain('Like being in the sun');
    expect(prompt).not.toContain('Comme au soleil');
    expect(prompt).not.toContain('Itsumo hidamari no you ni');
  });

  it('skips target-language theme families with only auxiliary sources in auto-detect mode', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello there.',
      'Dialogue: 0,0:00:03.00,0:00:04.00,Ending-English,,0,0,0,,Already translated lyrics',
      'Dialogue: 0,0:00:03.00,0:00:04.00,Ending-Romaji,,0,0,0,,Mou yakusareta uta',
      'Dialogue: 0,0:00:03.00,0:00:04.00,Ending-Kanji,,0,0,0,,翻訳済みの歌',
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'auto', 'en');

    expect(prompt).toContain('Hello there.');
    expect(prompt).not.toContain('Already translated lyrics');
    expect(prompt).not.toContain('Mou yakusareta uta');
    expect(prompt).not.toContain('翻訳済みの歌');
  });

  it('keeps all theme layers when no layer matches the selected source language', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-English,,0,0,0,,Like being in the sun',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Romaji,,0,0,0,,Itsumo hidamari no you ni',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Ending-Kanji,,0,0,0,,いつも陽だまりのように',
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'pt', 'fr');

    expect(prompt).toContain('Like being in the sun');
    expect(prompt).toContain('Itsumo hidamari no you ni');
    expect(prompt).toContain('いつも陽だまりのように');
  });

  it('keeps single-layer romaji themes translatable as a conservative fallback', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,Opening-Romaji,,0,0,0,,Itsumo hidamari no you ni',
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');

    expect(prompt).toContain('Itsumo hidamari no you ni');
    expect(prompt).toContain('"id":"THEME_0"');
  });

  it('translates grouped visual text once, expands it to every occurrence, and translates dense visual text', async () => {
    const { translateSubtitle } = await import('./translation');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const cues = parseUserPromptCues(request.userPrompt);
      const translatedCues = cues.map((cue) => {
        if (cue.id.startsWith('VISUAL_')) {
          return {
            id: cue.id,
            translatedText: cue.text
              .replace('Candidate', 'Candidat')
              .replace('Name', 'Nom')
              .replace('DenseUnique Campaign Speech Assembly', 'Assemblee du discours DenseUnique'),
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
    expect(result.translatedContent).toContain('Assemblee');
    expect(result.translatedContent).not.toContain('DenseUnique Campaign');

    const promptCueBatches = callLlmMock.mock.calls.map(([request]) => parseUserPromptCues(request.userPrompt));
    expect(promptCueBatches).toEqual([
      [
        { id: 'VISUAL_0', text: '~p0:Candidate~p1:Name' },
        { id: 'VISUAL_1', text: 'DenseUnique Campaign Speech Assembly' },
      ],
      [{ id: 'ASS_0_L12', text: 'Hello there.' }],
    ]);
    expect(warnSpy).not.toHaveBeenCalledWith('Translation validation errors:', expect.anything());

    warnSpy.mockRestore();
  });

  it('translates short tagged ASS signs instead of treating them as dense passthrough', async () => {
    const { translateSubtitle } = await import('./translation');

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const cues = parseUserPromptCues(request.userPrompt);
      return {
        content: JSON.stringify({
          cues: cues.map((cue) => ({
            id: cue.id,
            translatedText: cue.text.replace('EXIT', 'SORTIE'),
          })),
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,SignTS,,0,0,0,,{\\pos(100,100)}EXIT',
    ]);

    const result = await translateSubtitle(
      { name: 'sign.ass', path: '/subs/sign.ass', content, format: 'ass', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(result.translatedContent).toContain('{\\pos(100,100)}SORTIE');
    expect(allPromptCues()).toEqual([{ id: 'VISUAL_0', text: 'EXIT' }]);
  });

  it('retries missing visual preflight groups in the main translation phase', async () => {
    const { translateSubtitle } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,SignTS,,0,0,0,,{\\pos(100,100)}EXIT',
    ]);
    let callIndex = 0;

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      callIndex += 1;
      const cues = parseUserPromptCues(request.userPrompt);

      if (callIndex === 1) {
        return {
          content: JSON.stringify({ cues: [] }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      }

      return {
        content: JSON.stringify({
          cues: cues.map((cue) => ({
            id: cue.id,
            translatedText: cue.text.replace('EXIT', 'SORTIE'),
          })),
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const result = await translateSubtitle(
      { name: 'missing-visual.ass', path: '/subs/missing-visual.ass', content, format: 'ass', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    const promptCueBatches = callLlmMock.mock.calls.map(([request]) => parseUserPromptCues(request.userPrompt));
    expect(result.success).toBe(true);
    expect(result.translatedContent).toContain('{\\pos(100,100)}SORTIE');
    expect(callLlmMock).toHaveBeenCalledTimes(2);
    expect(promptCueBatches[0]).toEqual([{ id: 'VISUAL_0', text: 'EXIT' }]);
    expect(promptCueBatches[1]).toHaveLength(1);
    expect(promptCueBatches[1][0].text).toContain('⟦TAG_0⟧EXIT');
  });

  it('groups dense CampaignTS text by readable text and translates every occurrence', async () => {
    const { buildFullPromptForTokenCount, translateSubtitle } = await import('./translation');
    const campaignText = denseCampaignText();
    const content = buildAssWithEvents([
      `Dialogue: 0,0:00:01.00,0:00:02.00,CampaignTS,,0,0,0,,{\\pos(100,100)}${campaignText}`,
      `Dialogue: 0,0:00:02.00,0:00:03.00,CampaignTS,,0,0,0,,{\\pos(101,101)}${campaignText}`,
      `Dialogue: 0,0:00:03.00,0:00:04.00,CampaignTS,,0,0,0,,{\\pos(102,102)}${campaignText}`,
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');
    expect(countOccurrences(prompt, 'Student Council Presidential Elections Campaign Speech Assembly')).toBe(1);
    expect(prompt).not.toContain('\\c&H000000&');

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const cues = parseUserPromptCues(request.userPrompt);
      return {
        content: JSON.stringify({
          cues: cues.map((cue) => ({
            id: cue.id,
            translatedText: cue.text.replace(
              'Student Council Presidential Elections Campaign Speech Assembly',
              'Discours de campagne du conseil etudiant'
            ),
          })),
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const result = await translateSubtitle(
      { name: 'campaign.ass', path: '/subs/campaign.ass', content, format: 'ass', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(countOccurrences(result.translatedContent, 'Discours')).toBe(3);
    expect(result.translatedContent).toContain('{\\pos(100,100)}');
    expect(result.translatedContent).toContain('\\c&H000000&');
    expect(allPromptCues()).toEqual([
      { id: 'VISUAL_0', text: 'Student Council Presidential Elections Campaign Speech Assembly' },
    ]);
  });

  it('keeps translated plain visual text readable when tags split source words', async () => {
    const { buildFullPromptForTokenCount, translateSubtitle } = await import('./translation');
    const translatedCampaign = 'Discours de campagne du conseil etudiant';
    const content = buildAssWithEvents([
      `Dialogue: 0,0:00:01.00,0:00:02.00,CampaignTS,,0,0,0,,${fragmentedCampaignText()}`,
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');
    expect(countOccurrences(prompt, 'Student Council Presidential Elections Campaign Speech Assembly')).toBe(1);
    expect(prompt).not.toContain('\\c&H254156&');

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const cues = parseUserPromptCues(request.userPrompt);
      return {
        content: JSON.stringify({
          cues: cues.map((cue) => ({
            id: cue.id,
            translatedText: cue.text.replace(
              'Student Council Presidential Elections Campaign Speech Assembly',
              translatedCampaign
            ),
          })),
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const result = await translateSubtitle(
      { name: 'fragmented-campaign.ass', path: '/subs/fragmented-campaign.ass', content, format: 'ass', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    const translatedEventText = extractEventText(result.translatedContent, 'CampaignTS');
    expect(result.success).toBe(true);
    expect(translatedEventText).toContain('{\\c&H415968&}');
    expect(stripAssReadableText(translatedEventText)).toBe(translatedCampaign);
    expect(stripAssReadableText(translatedEventText)).not.toContain('Disco urs');
    expect(stripAssReadableText(translatedEventText)).not.toContain('consei letu');
  });

  it('retries dense visual text in main translation when plain projection has no readable text', async () => {
    const { translateSubtitle } = await import('./translation');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const content = buildAssWithEvents([
      `Dialogue: 0,0:00:01.00,0:00:02.00,CampaignTS,,0,0,0,,${fragmentedCampaignText()}`,
    ]);
    let callIndex = 0;
    const translatedCampaign = 'Discours de campagne du conseil etudiant';

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      callIndex += 1;
      const cues = parseUserPromptCues(request.userPrompt);

      if (callIndex === 1) {
        return {
          content: JSON.stringify({
            cues: cues.map((cue) => ({ id: cue.id, translatedText: '' })),
          }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      }

      return {
        content: JSON.stringify({
          cues: cues.map((cue) => ({
            id: cue.id,
            translatedText: replaceReadableTextInSkeleton(cue.text, translatedCampaign),
          })),
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const result = await translateSubtitle(
      { name: 'empty-campaign.ass', path: '/subs/empty-campaign.ass', content, format: 'ass', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(stripAssReadableText(extractEventText(result.translatedContent, 'CampaignTS'))).toBe(translatedCampaign);
    expect(callLlmMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalledWith('Translation validation errors:', expect.anything());

    warnSpy.mockRestore();
  });

  it('escapes physical newlines in translated ASS visual text', async () => {
    const { translateSubtitle } = await import('./translation');
    const translatedCampaign = 'Discours de campagne\ndu conseil etudiant';
    const content = buildAssWithEvents([
      `Dialogue: 0,0:00:01.00,0:00:02.00,CampaignTS,,0,0,0,,${fragmentedCampaignText()}`,
    ]);

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const cues = parseUserPromptCues(request.userPrompt);
      return {
        content: JSON.stringify({
          cues: cues.map((cue) => ({
            id: cue.id,
            translatedText: cue.text.replace(
              'Student Council Presidential Elections Campaign Speech Assembly',
              translatedCampaign
            ),
          })),
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const result = await translateSubtitle(
      { name: 'newline-campaign.ass', path: '/subs/newline-campaign.ass', content, format: 'ass', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    const eventLine = result.translatedContent
      .split('\n')
      .find((line) => line.startsWith('Dialogue:') && line.includes(',CampaignTS,'));
    expect(result.success).toBe(true);
    expect(eventLine).toContain('Discours de campagne\\Ndu conseil etudiant');
    expect(result.translatedContent).not.toContain('Discours de campagne\ndu conseil etudiant');
  });

  it('preserves readable line breaks for dense plain visual prompts', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const tags = Array.from({ length: 16 }, (_, index) => `{\\c&H${index.toString(16).padStart(6, '0')}&}`).join('');
    const content = buildAssWithEvents([
      `Dialogue: 0,0:00:01.00,0:00:02.00,CampaignTS,,0,0,0,,{\\pos(100,100)}${tags}Student Council\\NPresident\\NElections`,
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');

    expect(prompt).toContain('Student Council\\nPresident\\nElections');
    expect(prompt).not.toContain('Student CouncilPresidentElections');
  });

  it('keeps dense short title cues in the translation plan', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,ShowTitleTS,,0,0,0,,{\\pos(100,100)}Amagami',
      'Dialogue: 0,0:00:02.00,0:00:03.00,ShowTitleTS,,0,0,0,,{\\pos(110,100)}SS',
      'Dialogue: 0,0:00:03.00,0:00:04.00,ShowTitleTS,,0,0,0,,{\\pos(120,100)}plus',
      'Dialogue: 0,0:00:04.00,0:00:05.00,ShowTitleTS,,0,0,0,,{\\pos(130,100)}＋',
    ]);

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');

    expect(prompt).toContain('Amagami');
    expect(prompt).toContain('SS');
    expect(prompt).toContain('plus');
    expect(prompt).toContain('＋');
  });

  it('keeps Thoughts style dialogue in the main translation plan', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents(
      [
        'Dialogue: 0,0:00:01.00,0:00:02.00,Thoughts,,0,0,0,,I cannot tell her yet.',
      ],
      {
        extraStyles: [
          'Style: Thoughts,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1',
        ],
      }
    );

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');

    expect(prompt).not.toContain('"id":"VISUAL_0"');
    expect(prompt).toContain('I cannot tell her yet.');
  });

  it('keeps Comments style dialogue in the main translation plan', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents(
      [
        'Dialogue: 0,0:00:01.00,0:00:02.00,Comments,,0,0,0,,That was close.',
      ],
      {
        extraStyles: [
          'Style: Comments,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1',
        ],
      }
    );

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');

    expect(prompt).not.toContain('"id":"VISUAL_0"');
    expect(prompt).toContain('That was close.');
  });

  it('keeps explicit TS suffix styles in the visual text plan', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents(
      [
        'Dialogue: 0,0:00:01.00,0:00:02.00,PollTS,,0,0,0,,{\\pos(100,100)}Candidate\\NName',
        'Dialogue: 0,0:00:02.00,0:00:03.00,Sign-TS,,0,0,0,,{\\pos(120,100)}Door',
      ],
      {
        extraStyles: [
          'Style: Sign-TS,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1',
        ],
      }
    );

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');

    expect(prompt).toContain('"id":"VISUAL_0"');
    expect(prompt).toContain('~p0:Candidate~p1:Name');
    expect(prompt).toContain('Door');
  });

  it('groups numbered TS styles as visual text', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents(
      [
        'Dialogue: 0,0:08:21.77,0:08:21.89,TS2,,0,0,0,,{\\blur0.7}{\\b1\\pos(651,84)}by Beaver',
        'Dialogue: 0,0:08:21.89,0:08:21.98,TS2,,0,0,0,,{\\blur0.7}{\\b1\\pos(682.5,330)}by Beaver',
        'Dialogue: 0,0:08:21.89,0:08:21.98,TS3,,0,0,0,,{\\blur0.7\\fs33\\pos(691.5,205.5)}Three Kingdoms',
        'Dialogue: 0,0:08:21.98,0:08:22.06,TS3,,0,0,0,,{\\blur0.7\\fs33\\pos(705,298.5)}Three Kingdoms',
        'Dialogue: 0,0:14:41.86,0:14:44.07,TS4,,0,0,0,,{\\fad(780,0)\\pos(751.5,511.5)}Kibitou City Third Park',
        'Dialogue: 0,0:16:45.60,0:16:48.32,TS4,,0,0,0,,{\\fad(780,0)\\pos(751.5,511.5)}Kibitou City Third Park',
      ],
      {
        extraStyles: [
          'Style: TS2,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1',
          'Style: TS3,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1',
          'Style: TS4,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1',
        ],
      }
    );

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');

    expect(prompt).toContain('"id":"VISUAL_0"');
    expect(prompt).not.toContain('"id":"ASS_');
    expect(countOccurrences(prompt, 'by Beaver')).toBe(1);
    expect(countOccurrences(prompt, 'Three Kingdoms')).toBe(1);
    expect(countOccurrences(prompt, 'Kibitou City Third Park')).toBe(1);
  });

  it('groups repeated Sign #1 visual text once', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents(
      Array.from({ length: 10 }, (_, index) =>
        `Dialogue: 1,0:00:22.${String(index).padStart(2, '0')},0:00:22.${String(index + 1).padStart(2, '0')},Sign #1,,0,0,0,,{\\fscx${140 + index}\\fscy${140 + index}\\blur0.7\\pos(${500 + index},${900 - index})}Let's Aim For A Dignified School Life!`
      ),
      {
        extraStyles: [
          'Style: Sign #1,Kozuka Gothic Pr6N B,50,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1',
        ],
      }
    );

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');

    expect(prompt).toContain('"id":"VISUAL_0"');
    expect(countOccurrences(prompt, "Let's Aim For A Dignified School Life!")).toBe(1);
    expect(prompt).not.toContain('"id":"ASS_');
  });

  it('groups Sign-CityArch word-split visual text as readable text', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const eventText = [
      '{\\pos(310,80)\\c&H111111&}Welcome ',
      '{\\c&H222222&}to ',
      '{\\c&H333333&}the ',
      '{\\c&H444444&}city ',
      '{\\c&H555555&}by ',
      '{\\c&H666666&}the ',
      '{\\c&H777777&}sea',
    ].join('');
    const content = buildAssWithEvents(
      Array.from({ length: 4 }, (_, index) =>
        `Dialogue: 1,0:00:10.${index}0,0:00:10.${index}5,Sign-CityArch,,0,0,0,,${eventText.replace('310,80', `${310 + index},80`)}`
      ),
      {
        extraStyles: [
          'Style: Sign-CityArch,Iwata Mincho Pro M-Kami,38,&H009EABC7,&H000000FF,&H00000000,&H00000000,-1,0,0,0,80,86,0,0,1,0,0,5,10,10,10,1',
        ],
      }
    );

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');

    expect(prompt).toContain('"id":"VISUAL_0"');
    expect(countOccurrences(prompt, 'Welcome to the city by the sea')).toBe(1);
    expect(prompt).not.toContain('\\c&H111111&');
    expect(prompt).not.toContain('Welcome ⟦TAG_');
  });

  it('keeps unformatted Sign style dialogue in the main translation plan', async () => {
    const { buildFullPromptForTokenCount } = await import('./translation');
    const content = buildAssWithEvents(
      [
        'Dialogue: 0,0:00:01.00,0:00:02.00,Sign,,0,0,0,,I signed the form.',
      ],
      {
        extraStyles: [
          'Style: Sign,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1',
        ],
      }
    );

    const prompt = buildFullPromptForTokenCount(content, 'en', 'fr');

    expect(prompt).not.toContain('"id":"VISUAL_0"');
    expect(prompt).toContain('"id":"ASS_');
    expect(prompt).toContain('I signed the form.');
  });

  it('retries canonical visual text in main translation when placeholders are missing', async () => {
    const { translateSubtitle } = await import('./translation');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,PollTS,,0,0,0,,{\\pos(100,100)}Candidate\\NName',
    ]);
    let callIndex = 0;

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      callIndex += 1;
      const cues = parseUserPromptCues(request.userPrompt);
      return {
        content: JSON.stringify({
          cues: cues.map((cue) => ({
            id: cue.id,
            translatedText: callIndex === 1
              ? cue.text.replace('~p0:Candidate~p1:Name', 'Candidat Nom')
              : cue.text.replace('Candidate', 'Candidat').replace('Name', 'Nom'),
          })),
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const result = await translateSubtitle(
      { name: 'poll.ass', path: '/subs/poll.ass', content, format: 'ass', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(result.translatedContent).toContain('{\\pos(100,100)}Candidat\\NNom');
    expect(result.translatedContent).not.toContain('{\\pos(100,100)}Candidate\\NName');
    expect(callLlmMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalledWith('Translation validation errors:', expect.anything());

    warnSpy.mockRestore();
  });

  it('accepts canonical visual placeholders in textual order without retrying', async () => {
    const { translateSubtitle } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,PollTS,,0,0,0,,Student Council President\\N{\\pos(100,100)}Campaign Speech Assembly',
    ]);

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const cues = parseUserPromptCues(request.userPrompt);
      return {
        content: JSON.stringify({
          cues: cues.map((cue) => ({
            id: cue.id,
            translatedText: cue.text
              .replace('Student Council President', 'President du conseil etudiant')
              .replace('Campaign Speech Assembly', 'Assemblee du discours de campagne'),
          })),
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const result = await translateSubtitle(
      { name: 'textual-order.ass', path: '/subs/textual-order.ass', content, format: 'ass', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    const promptCueBatches = callLlmMock.mock.calls.map(([request]) => parseUserPromptCues(request.userPrompt));
    expect(result.success).toBe(true);
    expect(promptCueBatches).toEqual([
      [{
        id: 'VISUAL_0',
        text: 'Student Council President~p1:~p0:Campaign Speech Assembly',
      }],
    ]);
    expect(result.translatedContent).toContain(
      'President du conseil etudiant\\N{\\pos(100,100)}Assemblee du discours de campagne'
    );
    expect(callLlmMock).toHaveBeenCalledTimes(1);
  });

  it('keeps visual text byte-equivalent when the model returns source text unchanged', async () => {
    const { translateSubtitle } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,PollTS,,0,0,0,,{\\pos(100,100)}Candidate\\NName',
      `Dialogue: 0,0:00:02.00,0:00:03.00,CampaignTS,,0,0,0,,{\\pos(101,101)}${denseCampaignText()}`,
    ]);

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const cues = parseUserPromptCues(request.userPrompt);
      return {
        content: JSON.stringify({
          cues: cues.map((cue) => ({ id: cue.id, translatedText: cue.text })),
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const result = await translateSubtitle(
      { name: 'identity.ass', path: '/subs/identity.ass', content, format: 'ass', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(result.translatedContent).toBe(content);
  });

  it('retries unresolved main translation cues as one grouped request with translated context', async () => {
    const { translateSubtitle } = await import('./translation');
    const content = [
      '0',
      '00:00:01,000 --> 00:00:02,000',
      'Line zero.',
      '',
      '1',
      '00:00:02,000 --> 00:00:03,000',
      'Line one.',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      'Line two.',
      '',
      '3',
      '00:00:04,000 --> 00:00:05,000',
      'Line three.',
      '',
      '4',
      '00:00:05,000 --> 00:00:06,000',
      'Line four.',
      '',
      '5',
      '00:00:06,000 --> 00:00:07,000',
      'Line five.',
    ].join('\n');

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const prompt = parseUserPromptPayload(request.userPrompt);
      const callNumber = callLlmMock.mock.calls.length;

      if (callNumber === 1) {
        return {
          content: JSON.stringify({
            cues: prompt.cues
              .filter(cue => cue.id !== 'SRT_2' && cue.id !== 'SRT_3')
              .map(cue => ({
                id: cue.id,
                translatedText: `FR ${cue.text}`,
              })),
          }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      }

      if (callNumber === 2) {
        return {
          content: JSON.stringify({
            cues: [{ id: 'SRT_2', translatedText: 'FR Line two.' }],
          }),
          usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
        };
      }

      return {
        content: JSON.stringify({ cues: [] }),
        usage: { promptTokens: 6, completionTokens: 2, totalTokens: 8 },
      };
    });

    const result = await translateSubtitle(
      { name: 'retry.srt', path: '/subs/retry.srt', content, format: 'srt', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(result.translatedContent).toContain('FR Line two.');
    expect(result.translatedContent).toContain('Line three.');
    expect(result.error).toContain('1 cue(s) remained unchanged');
    expect(callLlmMock).toHaveBeenCalledTimes(3);

    const firstRetryPrompt = parseUserPromptPayload(callLlmMock.mock.calls[1][0].userPrompt);
    expect(firstRetryPrompt.cues.map(cue => cue.id)).toEqual(['SRT_2', 'SRT_3']);
    expect(firstRetryPrompt.contextCues?.map(cue => cue.id)).not.toContain('SRT_2');
    expect(firstRetryPrompt.contextCues?.map(cue => cue.id)).not.toContain('SRT_3');
    expect(firstRetryPrompt.contextCues?.map(cue => cue.id)).toEqual([
      'SRT_0',
      'SRT_1',
      'SRT_4',
      'SRT_5',
    ]);
    expect(firstRetryPrompt.contextCues).toEqual([
      {
        id: 'SRT_0',
        text: 'Line zero.',
        translatedText: 'FR Line zero.',
        position: 'before',
        spanIndex: 0,
      },
      {
        id: 'SRT_1',
        text: 'Line one.',
        translatedText: 'FR Line one.',
        position: 'before',
        spanIndex: 0,
      },
      {
        id: 'SRT_4',
        text: 'Line four.',
        translatedText: 'FR Line four.',
        position: 'after',
        spanIndex: 0,
      },
      {
        id: 'SRT_5',
        text: 'Line five.',
        translatedText: 'FR Line five.',
        position: 'after',
        spanIndex: 0,
      },
    ]);

    const secondRetryPrompt = parseUserPromptPayload(callLlmMock.mock.calls[2][0].userPrompt);
    expect(secondRetryPrompt.cues.map(cue => cue.id)).toEqual(['SRT_3']);
    expect(secondRetryPrompt.contextCues?.map(cue => cue.id)).not.toContain('SRT_3');
  });

  it('retries main translation provider failures and keeps partial fallback output', async () => {
    const { translateSubtitle } = await import('./translation');
    const content = [
      '0',
      '00:00:01,000 --> 00:00:02,000',
      'First line.',
      '',
      '1',
      '00:00:02,000 --> 00:00:03,000',
      'Second line.',
    ].join('\n');

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const prompt = parseUserPromptPayload(request.userPrompt);
      const callNumber = callLlmMock.mock.calls.length;

      if (callNumber === 1) {
        return {
          content: '',
          error: 'Provider unavailable',
          usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 },
        };
      }

      if (callNumber === 2) {
        return {
          content: JSON.stringify({
            cues: [{ id: 'SRT_0', translatedText: 'FR First line.' }],
          }),
          usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
        };
      }

      return {
        content: JSON.stringify({ cues: [] }),
        usage: { promptTokens: 6, completionTokens: 2, totalTokens: 8 },
      };
    });

    const result = await translateSubtitle(
      { name: 'provider-retry.srt', path: '/subs/provider-retry.srt', content, format: 'srt', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(result.translatedContent).toContain('FR First line.');
    expect(result.translatedContent).toContain('Second line.');
    expect(result.error).toContain('Provider unavailable');
    expect(result.error).toContain('1 cue(s) remained unchanged');
    expect(callLlmMock).toHaveBeenCalledTimes(3);

    const firstRetryPrompt = parseUserPromptPayload(callLlmMock.mock.calls[1][0].userPrompt);
    expect(firstRetryPrompt.cues.map(cue => cue.id)).toEqual(['SRT_0', 'SRT_1']);
  });

  it('retries empty initial translations instead of accepting them', async () => {
    const { translateSubtitle } = await import('./translation');
    const content = [
      '0',
      '00:00:01,000 --> 00:00:02,000',
      'First line.',
      '',
      '1',
      '00:00:02,000 --> 00:00:03,000',
      'Second line.',
    ].join('\n');

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const prompt = parseUserPromptPayload(request.userPrompt);
      const callNumber = callLlmMock.mock.calls.length;

      if (callNumber === 1) {
        return {
          content: JSON.stringify({
            cues: [
              { id: 'SRT_0', translatedText: '' },
              { id: 'SRT_1', translatedText: 'FR Second line.' },
            ],
          }),
        };
      }

      return {
        content: JSON.stringify({
          cues: prompt.cues.map(cue => ({ id: cue.id, translatedText: `FR retry ${cue.text}` })),
        }),
      };
    });

    const result = await translateSubtitle(
      { name: 'empty-translation-retry.srt', path: '/subs/empty-translation-retry.srt', content, format: 'srt', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(result.translatedContent).toContain('FR retry First line.');
    expect(result.translatedContent).toContain('FR Second line.');
    expect(callLlmMock).toHaveBeenCalledTimes(2);

    const retryPrompt = parseUserPromptPayload(callLlmMock.mock.calls[1][0].userPrompt);
    expect(retryPrompt.cues.map(cue => cue.id)).toEqual(['SRT_0']);
  });

  it('leaves invalid retry translations unresolved instead of replacing the cue', async () => {
    const { translateSubtitle } = await import('./translation');
    const content = [
      '0',
      '00:00:01,000 --> 00:00:02,000',
      '<i>Hello there.</i>',
    ].join('\n');

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const prompt = parseUserPromptPayload(request.userPrompt);
      const callNumber = callLlmMock.mock.calls.length;

      if (callNumber === 1) {
        return { content: JSON.stringify({ cues: [] }) };
      }

      if (callNumber === 2) {
        return {
          content: JSON.stringify({
            cues: [{ id: prompt.cues[0].id, translatedText: 'Bonjour.' }],
          }),
        };
      }

      return { content: JSON.stringify({ cues: [] }) };
    });

    const result = await translateSubtitle(
      { name: 'invalid-retry.srt', path: '/subs/invalid-retry.srt', content, format: 'srt', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(result.translatedContent).toContain('<i>Hello there.</i>');
    expect(result.translatedContent).not.toContain('Bonjour.');
    expect(result.error).toContain('1 cue(s) remained unchanged');
    expect(callLlmMock).toHaveBeenCalledTimes(3);
  });

  it('includes resolved visual preflight translations in main retry context', async () => {
    const { translateSubtitle } = await import('./translation');
    const content = buildAssWithEvents([
      'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Before retry.',
      'Dialogue: 0,0:00:02.00,0:00:03.00,SignTS,,0,0,0,,{\\pos(100,100)}EXIT',
      'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Missing one.',
      'Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,Missing two.',
      'Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,After retry.',
    ]);

    callLlmMock.mockImplementation(async (request: { userPrompt: string }) => {
      const prompt = parseUserPromptPayload(request.userPrompt);
      const callNumber = callLlmMock.mock.calls.length;

      if (callNumber === 1) {
        return {
          content: JSON.stringify({
            cues: prompt.cues.map(cue => ({
              id: cue.id,
              translatedText: cue.text.replace('EXIT', 'SORTIE'),
            })),
          }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      }

      if (callNumber === 2) {
        return {
          content: JSON.stringify({
            cues: prompt.cues
              .filter(cue => !cue.text.includes('Missing one.') && !cue.text.includes('Missing two.'))
              .map(cue => ({ id: cue.id, translatedText: `FR ${cue.text}` })),
          }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      }

      return {
        content: JSON.stringify({
          cues: prompt.cues.map(cue => ({ id: cue.id, translatedText: `FR ${cue.text}` })),
        }),
        usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
      };
    });

    const result = await translateSubtitle(
      { name: 'visual-context.ass', path: '/subs/visual-context.ass', content, format: 'ass', size: 1 },
      'openai',
      'gpt-test',
      'en',
      'fr'
    );

    expect(result.success).toBe(true);
    expect(result.translatedContent).toContain('SORTIE');

    const retryPrompt = parseUserPromptPayload(callLlmMock.mock.calls[2][0].userPrompt);
    const retryTargetIds = retryPrompt.cues.map(cue => cue.id);
    const visualContextCue = retryPrompt.contextCues?.find(cue => cue.text.includes('EXIT'));
    expect(retryTargetIds).toHaveLength(2);
    expect(retryPrompt.contextCues?.map(cue => cue.id)).not.toContain(retryTargetIds[0]);
    expect(retryPrompt.contextCues?.map(cue => cue.id)).not.toContain(retryTargetIds[1]);
    expect(visualContextCue?.translatedText).toContain('SORTIE');
  });
});
