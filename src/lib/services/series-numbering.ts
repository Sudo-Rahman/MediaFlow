import type { RenameFile, RenameRuleContext, SortConfig } from '$lib/types/rename';
import {
  extractSeasonNumber,
  extractSeriesInfo,
} from '$lib/services/series-parser';
import { compareRenameFiles } from '$lib/services/rename';
import {
  getImportPathBasename,
  getImportPathParent,
  normalizePathForIdentity,
  resolveSourceGroup,
  type SourceGroup,
} from '$lib/types/source-group';

export { extractSeasonNumber, extractSeriesInfo } from '$lib/services/series-parser';

type SeriesResolutionStatus = 'resolved' | 'conflict' | 'unresolved';

export interface SeriesNumberingIssue {
  groupKey: string;
  label: string;
  status: Exclude<SeriesResolutionStatus, 'resolved'>;
  candidates: number[];
  message: string;
}

export interface SeriesGroupResolution {
  groupKey: string;
  label: string;
  status: SeriesResolutionStatus;
  seasonNumber?: number;
  explicitSeasonNumber?: number;
  candidates: number[];
  fileIds: string[];
}

export interface SeriesNumberingPlan {
  contextsByFileId: Map<string, RenameRuleContext>;
  resolutions: SeriesGroupResolution[];
  issues: SeriesNumberingIssue[];
}

interface SeriesFileGroup {
  groupKey: string;
  sourceGroup: SourceGroup;
  files: RenameFile[];
}

/**
 * Plan deterministic, group-local numbering for selected files.
 *
 * Group identity comes from import provenance and falls back to the selected
 * file's parent directory for legacy/direct imports. The returned contexts
 * also include each file's global index so ordinary Number rules retain their
 * existing behavior when mixed with Series Numbering.
 */
export function planSeriesNumbering(
  files: readonly RenameFile[],
  sortConfig: SortConfig,
  assignments: ReadonlyMap<string, number> = new Map(),
): SeriesNumberingPlan {
  const selectedFiles = files.filter((file) => file.selected);
  const sortedFiles = [...selectedFiles].sort((left, right) => compareRenameFiles(left, right, sortConfig));
  const groups = groupSelectedFiles(sortedFiles);
  const contextsByFileId = new Map<string, RenameRuleContext>();
  const resolutions: SeriesGroupResolution[] = [];

  const globalIndexById = new Map<string, number>();
  sortedFiles.forEach((file, index) => globalIndexById.set(file.id, index));

  for (const group of groups.values()) {
    const assignment = assignments.get(group.groupKey);
    const resolution = resolveGroupSeason(group, assignment);
    resolutions.push(resolution);

    const groupFiles = [...group.files].sort((left, right) => compareRenameFiles(left, right, sortConfig));
    for (const [seriesIndex, file] of groupFiles.entries()) {
      contextsByFileId.set(file.id, {
        globalIndex: globalIndexById.get(file.id) ?? 0,
        seriesIndex,
        seasonNumber: resolution.seasonNumber,
      });
    }
  }

  resolutions.sort((left, right) => compareGroupKeys(left.groupKey, right.groupKey));
  const issues = resolutions
    .filter((resolution): resolution is SeriesGroupResolution & { status: 'conflict' | 'unresolved' } => resolution.status !== 'resolved')
    .map((resolution) => ({
      groupKey: resolution.groupKey,
      label: resolution.label,
      status: resolution.status,
      candidates: resolution.candidates,
      message: resolution.status === 'conflict'
        ? `Several season numbers were found for this folder: ${resolution.candidates.map((season) => `Season ${season}`).join(', ')}. Choose the season to use.`
        : 'No season could be detected for this group.',
    }));

  return { contextsByFileId, resolutions, issues };
}

function stableSeriesGroupKeys(files: readonly RenameFile[]): string[] {
  return [...groupSelectedFiles(files.filter((file) => file.selected)).keys()].sort(compareGroupKeys);
}

/** Build season assignments 1, 2, … using stable normalized group identity. */
export function assignSeriesSeasonsSequentially(
  files: readonly RenameFile[],
  start = 1,
): Map<string, number> {
  const assignments = new Map<string, number>();
  stableSeriesGroupKeys(files).forEach((groupKey, index) => assignments.set(groupKey, start + index));
  return assignments;
}

function groupSelectedFiles(files: readonly RenameFile[]): Map<string, SeriesFileGroup> {
  const groups = new Map<string, SeriesFileGroup>();

  for (const file of files) {
    const sourceGroup = resolveSourceGroup(file.originalPath, file.sourceGroup);
    const groupKey = normalizePathForIdentity(sourceGroup.groupKey);
    const group = groups.get(groupKey);

    if (group) {
      group.files.push(file);
      continue;
    }

    groups.set(groupKey, { groupKey, sourceGroup, files: [file] });
  }

  return groups;
}

function resolveGroupSeason(group: SeriesFileGroup, assignment: number | undefined): SeriesGroupResolution {
  const label = getGroupLabel(group.sourceGroup, group.groupKey);
  const candidates = collectSeasonCandidates(group.files, group.sourceGroup);
  const normalizedAssignment = normalizeSeason(assignment);

  if (normalizedAssignment !== undefined) {
    return {
      groupKey: group.groupKey,
      label,
      status: 'resolved',
      seasonNumber: normalizedAssignment,
      explicitSeasonNumber: normalizedAssignment,
      candidates,
      fileIds: group.files.map((file) => file.id),
    };
  }

  const status: SeriesResolutionStatus = candidates.length === 1
    ? 'resolved'
    : candidates.length > 1 ? 'conflict' : 'unresolved';

  return {
    groupKey: group.groupKey,
    label,
    status,
    seasonNumber: status === 'resolved' ? candidates[0] : undefined,
    candidates,
    fileIds: group.files.map((file) => file.id),
  };
}

function collectSeasonCandidates(files: readonly RenameFile[], sourceGroup: SourceGroup): number[] {
  const candidates = new Set<number>();

  for (const file of files) {
    addSeason(candidates, file.seasonNumber);
    addSeason(candidates, extractSeriesInfo(file.originalName)?.season);
    addSeason(candidates, extractSeasonNumber(file.originalName));
  }

  const selectedFolder = sourceGroup.selectedRootKind === 'file'
    ? getImportPathParent(sourceGroup.selectedRoot)
    : sourceGroup.selectedRoot;
  addSeason(candidates, extractSeasonNumber(getImportPathBasename(selectedFolder)));

  for (const pathPart of sourceGroup.relativePath.split(/[\\/]/)) {
    addSeason(candidates, extractSeasonNumber(pathPart));
  }

  return [...candidates].sort((left, right) => left - right);
}

function addSeason(candidates: Set<number>, value: number | undefined): void {
  const season = normalizeSeason(value);
  if (season !== undefined) {
    candidates.add(season);
  }
}

function normalizeSeason(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function getGroupLabel(sourceGroup: SourceGroup, fallback: string): string {
  const labelPath = sourceGroup.selectedRootKind === 'file'
    ? getImportPathParent(sourceGroup.selectedRoot)
    : sourceGroup.selectedRoot;
  const rootLabel = getImportPathBasename(labelPath);
  return rootLabel && rootLabel !== '.' && rootLabel !== '/' ? rootLabel : fallback;
}

function compareGroupKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
