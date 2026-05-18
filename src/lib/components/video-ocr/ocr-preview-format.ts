import type { OcrOutputFormat, OcrRegion, OcrSubtitle } from '$lib/types/video-ocr';

const ASS_PREVIEW_WIDTH = 1920;
const ASS_PREVIEW_HEIGHT = 1080;

function formatSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function formatVttTime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatAssTime(ms: number): string {
  const centiseconds = Math.floor((ms % 1000) / 10);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function formatAssText(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\n/g, '\\N');
}

function formatAssPosition(region: OcrRegion): string {
  const x = Math.round((region.x + region.width / 2) * ASS_PREVIEW_WIDTH);
  const y = Math.round(Math.min(region.y + region.height + 0.03, 0.95) * ASS_PREVIEW_HEIGHT);
  return `{\\pos(${x},${y})}`;
}

function formatAssDialogueText(subtitle: OcrSubtitle): string {
  const text = formatAssText(subtitle.text);
  return subtitle.region ? `${formatAssPosition(subtitle.region)}${text}` : text;
}

export function buildFormattedOcrPreview(
  format: OcrOutputFormat,
  subtitles: OcrSubtitle[]
): string {
  if (subtitles.length === 0) {
    return '';
  }

  if (format === 'vtt') {
    const body = subtitles
      .map(
        (sub) => `${formatVttTime(sub.startTime)} --> ${formatVttTime(sub.endTime)}\n${sub.text}\n`
      )
      .join('\n');
    return `WEBVTT\n\n${body}`;
  }

  if (format === 'ass') {
    const events = subtitles
      .map(
        (sub) =>
          `Dialogue: 0,${formatAssTime(sub.startTime)},${formatAssTime(sub.endTime)},Default,,0,0,0,,${formatAssDialogueText(sub)}`
      )
      .join('\n');
    return [
      '[Script Info]',
      'ScriptType: v4.00+',
      `PlayResX: ${ASS_PREVIEW_WIDTH}`,
      `PlayResY: ${ASS_PREVIEW_HEIGHT}`,
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,40,1',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      events,
    ].join('\n');
  }

  return subtitles
    .map(
      (sub, i) =>
        `${i + 1}\n${formatSrtTime(sub.startTime)} --> ${formatSrtTime(sub.endTime)}\n${sub.text}\n`
    )
    .join('\n');
}
