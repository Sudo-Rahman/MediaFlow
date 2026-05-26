import type {
  OcrActiveTarget,
  OcrDraft,
  OcrRawFrame,
  OcrRegion,
  OcrSegment,
  OcrSubtitle,
  OcrVersion,
  OcrVideoFile,
  VideoOcrSelection,
} from '$lib/types';
import { normalizeOcrZoneLabels } from '$lib/utils';

function nowIso(): string {
  return new Date().toISOString();
}

export function cloneOcrSegment(segment: OcrSegment): OcrSegment {
  return {
    ...segment,
    zones: segment.zones.map((zone) => ({ ...zone, region: { ...zone.region } })),
  };
}

export function cloneOcrSelection(selection: VideoOcrSelection): VideoOcrSelection {
  return normalizeOcrZoneLabels({ segments: selection.segments.map(cloneOcrSegment) });
}

export function cloneOcrSubtitle(subtitle: OcrSubtitle): OcrSubtitle {
  return {
    ...subtitle,
    ...(subtitle.region ? { region: { ...subtitle.region } } : {}),
  };
}

function cloneOcrRawFrame(frame: OcrRawFrame): OcrRawFrame {
  return {
    ...frame,
    ...(frame.region ? { region: { ...frame.region } } : {}),
  };
}

export function cloneOcrDraft(draft: OcrDraft): OcrDraft {
  return {
    baseVersionId: draft.baseVersionId,
    selection: cloneOcrSelection(draft.selection),
    dirty: draft.dirty,
    updatedAt: draft.updatedAt,
  };
}

export function cloneOcrVersion(version: OcrVersion): OcrVersion {
  return {
    ...version,
    configSnapshot: { ...version.configSnapshot },
    ...(version.selectionSnapshot ? { selectionSnapshot: cloneOcrSelection(version.selectionSnapshot) } : {}),
    rawOcr: version.rawOcr.map(cloneOcrRawFrame),
    finalSubtitles: version.finalSubtitles.map(cloneOcrSubtitle),
  };
}

function cloneFileVersionState(file: OcrVideoFile): Pick<
  OcrVideoFile,
  'activeOcrVersionId' | 'draft' | 'ocrSelection' | 'ocrVersions'
> {
  return {
    activeOcrVersionId: normalizeActiveOcrVersionId(file.ocrVersions, file.activeOcrVersionId, file.draft),
    draft: file.draft ? cloneOcrDraft(file.draft) : undefined,
    ocrSelection: cloneOcrSelection(file.ocrSelection),
    ocrVersions: file.ocrVersions.map(cloneOcrVersion),
  };
}

export function cloneOcrVersionedFile(file: OcrVideoFile): OcrVideoFile {
  return {
    ...file,
    ...cloneFileVersionState(file),
  };
}

export function normalizeActiveOcrVersionId(
  versions: readonly OcrVersion[],
  activeVersionId: string | null | undefined,
  draft?: OcrDraft,
): string | null | undefined {
  if (activeVersionId === null) {
    return draft ? null : versions.at(-1)?.id;
  }

  if (activeVersionId && versions.some((version) => version.id === activeVersionId)) {
    return activeVersionId;
  }

  return versions.at(-1)?.id;
}

function getLatestVersion(file: OcrVideoFile): OcrVersion | null {
  return file.ocrVersions.at(-1) ?? null;
}

function getVersionById(file: OcrVideoFile, versionId: string | null | undefined): OcrVersion | null {
  return versionId
    ? file.ocrVersions.find((version) => version.id === versionId) ?? null
    : null;
}

export function getActiveOcrTarget(file: OcrVideoFile): OcrActiveTarget {
  if (file.activeOcrVersionId === null && file.draft) {
    return { kind: 'draft', baseVersionId: file.draft.baseVersionId };
  }

  const selectedVersion = getVersionById(file, file.activeOcrVersionId);
  if (selectedVersion) {
    return { kind: 'version', versionId: selectedVersion.id };
  }

  return { kind: 'latest' };
}

export function getRenderedOcrVersion(file: OcrVideoFile): OcrVersion | null {
  const target = getActiveOcrTarget(file);

  if (target.kind === 'draft') {
    return null;
  }

  if (target.kind === 'version') {
    return getVersionById(file, target.versionId) ?? getLatestVersion(file);
  }

  return getLatestVersion(file);
}

function getVersionSelection(file: OcrVideoFile, version: OcrVersion): VideoOcrSelection {
  return cloneOcrSelection(version.selectionSnapshot ?? file.ocrSelection);
}

export function getRenderedOcrSelection(file: OcrVideoFile): VideoOcrSelection {
  const target = getActiveOcrTarget(file);

  if (target.kind === 'draft' && file.draft) {
    return cloneOcrSelection(file.draft.selection);
  }

  const version = getRenderedOcrVersion(file);
  return version ? getVersionSelection(file, version) : cloneOcrSelection(file.ocrSelection);
}

export function getRenderedOcrSubtitles(file: OcrVideoFile): OcrSubtitle[] {
  return getRenderedOcrVersion(file)?.finalSubtitles.map(cloneOcrSubtitle) ?? [];
}

export function hasOcrDraft(file: OcrVideoFile): boolean {
  return file.draft !== undefined;
}

export function getOcrDraftVersionName(file: OcrVideoFile): string {
  return `Draft Version ${file.ocrVersions.length + 1}`;
}

export function selectOcrVersion(file: OcrVideoFile, versionId: string | null): OcrVideoFile {
  if (versionId === null) {
    return {
      ...file,
      activeOcrVersionId: file.draft ? null : normalizeActiveOcrVersionId(file.ocrVersions, undefined),
    };
  }

  return {
    ...file,
    activeOcrVersionId: normalizeActiveOcrVersionId(file.ocrVersions, versionId, file.draft),
  };
}

export function branchOcrDraftFromRenderedSelection(file: OcrVideoFile): OcrVideoFile {
  if (file.ocrVersions.length === 0 && !file.draft) {
    return {
      ...file,
      activeOcrVersionId: undefined,
      ocrSelection: cloneOcrSelection(file.ocrSelection),
    };
  }

  if (file.activeOcrVersionId === null && file.draft) {
    return {
      ...file,
      activeOcrVersionId: null,
      draft: cloneOcrDraft(file.draft),
      ocrSelection: cloneOcrSelection(file.draft.selection),
    };
  }

  const renderedVersion = getRenderedOcrVersion(file);
  const selection = getRenderedOcrSelection(file);
  return {
    ...file,
    activeOcrVersionId: null,
    draft: {
      baseVersionId: renderedVersion?.id ?? null,
      selection,
      dirty: true,
      updatedAt: nowIso(),
    },
    ocrSelection: cloneOcrSelection(selection),
  };
}

export function replaceOcrDraftSelection(file: OcrVideoFile, selection: VideoOcrSelection): OcrVideoFile {
  const nextSelection = cloneOcrSelection(selection);

  if (file.ocrVersions.length === 0 && !file.draft) {
    return {
      ...file,
      activeOcrVersionId: undefined,
      ocrSelection: nextSelection,
    };
  }

  const draftSource = branchOcrDraftFromRenderedSelection(file);
  return {
    ...draftSource,
    activeOcrVersionId: null,
    draft: {
      baseVersionId: draftSource.draft?.baseVersionId ?? null,
      selection: nextSelection,
      dirty: true,
      updatedAt: nowIso(),
    },
    ocrSelection: cloneOcrSelection(nextSelection),
  };
}

function withSelectionSnapshot(version: OcrVersion, selection: VideoOcrSelection): OcrVersion {
  return {
    ...cloneOcrVersion(version),
    selectionSnapshot: cloneOcrSelection(version.selectionSnapshot ?? selection),
  };
}

export function setOcrVersionsForFile(file: OcrVideoFile, versions: readonly OcrVersion[]): OcrVideoFile {
  const nextVersions = versions.map((version) =>
    withSelectionSnapshot(version, version.selectionSnapshot ?? file.ocrSelection),
  );

  return {
    ...file,
    ocrVersions: nextVersions,
    activeOcrVersionId: nextVersions.at(-1)?.id,
    draft: undefined,
  };
}

export function appendOcrVersionFromRenderedSelection(file: OcrVideoFile, version: OcrVersion): OcrVideoFile {
  const target = getActiveOcrTarget(file);
  const renderedSelection = getRenderedOcrSelection(file);
  const versionWithSnapshot = withSelectionSnapshot(version, renderedSelection);

  return {
    ...file,
    ocrSelection: cloneOcrSelection(renderedSelection),
    ocrVersions: [...file.ocrVersions.map(cloneOcrVersion), versionWithSnapshot],
    activeOcrVersionId: versionWithSnapshot.id,
    draft: target.kind === 'draft' ? undefined : file.draft ? cloneOcrDraft(file.draft) : undefined,
  };
}

export function getRetryRawSource(file: OcrVideoFile): OcrVersion | null {
  const target = getActiveOcrTarget(file);

  if (target.kind === 'draft') {
    return null;
  }

  if (target.kind === 'version') {
    const selectedVersion = getVersionById(file, target.versionId);
    return selectedVersion?.rawOcr.length ? selectedVersion : null;
  }

  for (let i = file.ocrVersions.length - 1; i >= 0; i -= 1) {
    const version = file.ocrVersions[i];
    if (version.rawOcr.length > 0) {
      return version;
    }
  }

  return null;
}

export function areOcrRegionsEqual(left: OcrRegion, right: OcrRegion): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

export function areOcrSelectionsEqual(left: VideoOcrSelection, right: VideoOcrSelection): boolean {
  if (left.segments.length !== right.segments.length) {
    return false;
  }

  return left.segments.every((leftSegment, segmentIndex) => {
    const rightSegment = right.segments[segmentIndex];
    if (
      leftSegment.id !== rightSegment.id
      || leftSegment.startTimeMs !== rightSegment.startTimeMs
      || leftSegment.endTimeMs !== rightSegment.endTimeMs
      || leftSegment.zones.length !== rightSegment.zones.length
    ) {
      return false;
    }

    return leftSegment.zones.every((leftZone, zoneIndex) => {
      const rightZone = rightSegment.zones[zoneIndex];
      return leftZone.id === rightZone.id
        && leftZone.role === rightZone.role
        && leftZone.label === rightZone.label
        && areOcrRegionsEqual(leftZone.region, rightZone.region);
    });
  });
}
