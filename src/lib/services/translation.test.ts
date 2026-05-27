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

function parseUserPromptCues(userPrompt: string): Array<{ id: string; text: string }> {
  return JSON.parse(userPrompt.slice(userPrompt.indexOf('{'))).cues;
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
});
