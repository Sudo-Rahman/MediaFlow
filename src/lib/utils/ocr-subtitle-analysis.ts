import type { OcrSubtitle } from '$lib/types/video-ocr';

export interface OcrSubtitleAnalysis {
  cueCount: number;
  minDurationMs: number | null;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
  under250ms: number;
  under500ms: number;
  avgCps: number | null;
  maxCps: number | null;
  over30Cps: number;
  urlLikeCount: number;
  topPrefixes: Array<{ prefix: string; count: number }>;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function tokenLooksLikeDomain(token: string): boolean {
  const cleaned = token.replace(/^[^a-z0-9.-]+|[^a-z0-9.-]+$/gi, '');
  if (!cleaned.includes('.')) return false;

  const parts = cleaned.split('.').filter(Boolean);
  if (parts.length < 2) return false;

  const tld = parts.at(-1) ?? '';
  if (tld.length < 2 || tld.length > 6 || !/^[a-z]+$/i.test(tld)) return false;

  const domain = parts.at(-2) ?? '';
  if (domain.length < 2 || !/[a-z]/i.test(domain)) return false;

  return true;
}

function looksUrlLike(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes('http://') || lower.includes('https://') || lower.includes('www.')) return true;
  if (lower.includes('.com') || lower.includes('.net') || lower.includes('.org') || lower.includes('.co') || lower.includes('.io') || lower.includes('.me') || lower.includes('.tv') || lower.includes('.app')) return true;

  return lower.split(/\s+/).some(tokenLooksLikeDomain);
}

export function analyzeOcrSubtitles(subtitles: OcrSubtitle[]): OcrSubtitleAnalysis {
  const durations = subtitles
    .map((s) => Math.max(0, s.endTime - s.startTime))
    .filter((d) => d > 0);

  const cueCount = subtitles.length;
  let minDurationMs: number | null = null;
  let maxDurationMs: number | null = null;
  for (const d of durations) {
    minDurationMs = minDurationMs === null ? d : Math.min(minDurationMs, d);
    maxDurationMs = maxDurationMs === null ? d : Math.max(maxDurationMs, d);
  }
  const avgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  const under250ms = durations.filter((d) => d < 250).length;
  const under500ms = durations.filter((d) => d < 500).length;

  const cpsValues = subtitles
    .map((s) => {
      const durationSec = (s.endTime - s.startTime) / 1000;
      if (durationSec <= 0) return null;
      const charCount = collapseWhitespace(s.text).replace(/\s+/g, '').length;
      return charCount / durationSec;
    })
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const avgCps = cpsValues.length > 0 ? cpsValues.reduce((a, b) => a + b, 0) / cpsValues.length : null;
  let maxCps: number | null = null;
  for (const v of cpsValues) {
    maxCps = maxCps === null ? v : Math.max(maxCps, v);
  }
  const over30Cps = cpsValues.filter((v) => v > 30).length;

  const urlLikeCount = subtitles.filter((s) => looksUrlLike(s.text)).length;

  const prefixCounts = new Map<string, number>();
  for (const sub of subtitles) {
    const t = collapseWhitespace(sub.text);
    if (!t) continue;
    const prefix = t.slice(0, 4);
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }

  const topPrefixes = [...prefixCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([prefix, count]) => ({ prefix, count }));

  return {
    cueCount,
    minDurationMs,
    avgDurationMs,
    maxDurationMs,
    under250ms,
    under500ms,
    avgCps,
    maxCps,
    over30Cps,
    urlLikeCount,
    topPrefixes,
  };
}

export function formatOcrSubtitleAnalysis(analysis: OcrSubtitleAnalysis): string {
  const parts: string[] = [];
  parts.push(`${analysis.cueCount} cues`);
  if (analysis.minDurationMs !== null) parts.push(`min ${Math.round(analysis.minDurationMs)}ms`);
  if (analysis.under250ms > 0) parts.push(`${analysis.under250ms} <250ms`);
  if (analysis.over30Cps > 0) parts.push(`${analysis.over30Cps} >30 CPS`);
  if (analysis.urlLikeCount > 0) parts.push(`${analysis.urlLikeCount} URL-like`);

  const prefixPart = analysis.topPrefixes.length > 0
    ? ` (top: ${analysis.topPrefixes.map(p => `${p.prefix}(${p.count})`).join(', ')})`
    : '';

  return `Subtitle analysis: ${parts.join(', ')}${prefixPart}.`;
}
