import type { OcrSubtitle, OcrZone, OcrZoneRole, VideoOcrSelection } from '$lib/types';

export interface ActiveCueInput {
  subtitles: OcrSubtitle[];
  selection: VideoOcrSelection;
  timeMs: number;
  selectedZoneId?: string | null;
}

export interface ActivePreviewCue {
  subtitle: OcrSubtitle;
  zone: OcrZone | null;
  zoneIndex: number;
  segmentIndex: number;
}

export interface ActiveCueSummary {
  primaryCue: ActivePreviewCue | null;
  activeCues: ActivePreviewCue[];
  extraCueCount: number;
}

function rolePriority(role?: OcrZoneRole): number {
  if (role === 'main_subtitle') return 0;
  if (role === 'on_screen_text') return 1;
  return 2;
}

function isSubtitleActive(subtitle: OcrSubtitle, timeMs: number): boolean {
  return timeMs >= subtitle.startTime && timeMs < subtitle.endTime;
}

function findZoneContext(
  selection: VideoOcrSelection,
  segmentId: string | undefined,
  zoneId: string | undefined,
): Pick<ActivePreviewCue, 'zone' | 'zoneIndex' | 'segmentIndex'> {
  const segmentIndex = selection.segments.findIndex((segment) => segment.id === segmentId);
  const segment = segmentIndex >= 0 ? selection.segments[segmentIndex] : null;
  const zoneIndex = segment?.zones.findIndex((zone) => zone.id === zoneId) ?? -1;

  return {
    zone: zoneIndex >= 0 ? segment?.zones[zoneIndex] ?? null : null,
    zoneIndex: zoneIndex >= 0 ? zoneIndex : Number.MAX_SAFE_INTEGER,
    segmentIndex: segmentIndex >= 0 ? segmentIndex : Number.MAX_SAFE_INTEGER,
  };
}

function compareActiveCues(left: ActivePreviewCue, right: ActivePreviewCue): number {
  return (
    left.segmentIndex - right.segmentIndex
    || rolePriority(left.subtitle.role ?? left.zone?.role) - rolePriority(right.subtitle.role ?? right.zone?.role)
    || left.zoneIndex - right.zoneIndex
    || left.subtitle.startTime - right.subtitle.startTime
    || left.subtitle.id.localeCompare(right.subtitle.id)
  );
}

export function buildActiveCueSummary({
  subtitles,
  selection,
  timeMs,
  selectedZoneId = null,
}: ActiveCueInput): ActiveCueSummary {
  const activeCues = subtitles
    .filter((subtitle) => isSubtitleActive(subtitle, timeMs))
    .map((subtitle) => ({
      subtitle,
      ...findZoneContext(selection, subtitle.segmentId, subtitle.zoneId),
    }))
    .sort(compareActiveCues);

  const selectedCue = selectedZoneId
    ? activeCues.find((cue) => cue.subtitle.zoneId === selectedZoneId) ?? null
    : null;
  const primaryCue = selectedCue ?? activeCues[0] ?? null;

  return {
    primaryCue,
    activeCues,
    extraCueCount: primaryCue ? Math.max(0, activeCues.length - 1) : 0,
  };
}

export function roleLabelForCue(cue: ActivePreviewCue): string {
  const role = cue.subtitle.role ?? cue.zone?.role;
  const roleLabel = role === 'main_subtitle' ? 'Main subtitle' : 'On-screen text';
  const zoneLabel = cue.zone
    ? cue.zone.label?.trim() || `Zone ${cue.zoneIndex + 1}`
    : 'Unknown zone';
  return `${roleLabel} - ${zoneLabel}`;
}

export function formatCueConfidence(confidence: number): string {
  const normalized = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  return `${Math.round(normalized * 100)}%`;
}
