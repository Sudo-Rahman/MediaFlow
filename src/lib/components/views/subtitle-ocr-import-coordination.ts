import { invoke } from '@tauri-apps/api/core';

import {
  buildStandaloneSubtitleOcrItems,
  getSubtitleOcrImportKind,
} from '$lib/services/subtitle-ocr-import';
import {
  loadSubtitleOcrData,
} from '$lib/services/subtitle-ocr-storage';
import { subtitleOcrStore } from '$lib/stores';
import type {
  SubtitleOcrMediaInfo,
  SubtitleOcrSourceItem,
  SubtitleOcrTrackMetadata,
  SubtitleOcrVobSubPair,
} from '$lib/types';
import { getFileName } from '$lib/utils/format';
import { logAndToast } from '$lib/utils/log-toast';
import {
  expandToolImportRoots,
  pickAndExpandToolImport,
  toolImportPolicy,
} from '$lib/services/import-coordination';

import type {
  SubtitleOcrImportLease,
} from './subtitle-ocr-import-generation';
import type { SubtitleOcrPreviewRestoreOutcome } from './subtitle-ocr-preview-coordination';
import type { SubtitleOcrTrackImportSelection } from '$lib/components/subtitle-ocr';
import { filterSubtitleOcrPersistenceForItem } from './subtitle-ocr-view-state';

export interface SubtitleOcrTrackDialogState {
  open: boolean;
  sourcePath: string;
  sourceDuration?: number;
  tracks: SubtitleOcrTrackMetadata[];
  lease: SubtitleOcrImportLease | null;
}

interface TrackDialogRequest {
  sourcePath: string;
  sourceDuration?: number;
  tracks: SubtitleOcrTrackMetadata[];
  generation: number;
  lease: SubtitleOcrImportLease;
}

export interface SubtitleOcrImportCoordinationContext {
  beginImportGeneration(): SubtitleOcrImportLease;
  retainImportGeneration(generation: number): SubtitleOcrImportLease | null;
  releaseImportGeneration(lease: SubtitleOcrImportLease): void;
  isImportGenerationCurrent(generation: number): boolean;
  isImportGenerationCancelled(generation: number): boolean;
  restoreMissingPreviewAssets(
    itemId: string,
    hydrationToken: string,
    generation: number,
  ): Promise<SubtitleOcrPreviewRestoreOutcome>;
  requestPendingPreviewRestoreFlush(): void;
  resolveVobSubPair(path: string): Promise<SubtitleOcrVobSubPair>;
  sanitizeProcessingMessage(error: unknown): string;
  reportImportError(error: unknown): void;
  onDialogStateChange(state: SubtitleOcrTrackDialogState): void;
  onActivity(): void;
}

export interface SubtitleOcrImportCoordination {
  readonly hasDialogWork: boolean;
  readonly hasHydrationWork: boolean;
  importPaths(paths: string[]): Promise<void>;
  handleImport(): Promise<void>;
  handleImportFolders(): Promise<void>;
  handleFileDrop(paths: string[]): Promise<void>;
  handleImportTracks(selection: SubtitleOcrTrackImportSelection): Promise<void>;
  handleDialogOpenChange(open: boolean): void;
  cancelQueuedAndCurrent(): void;
  invalidateHydration(itemId: string): void;
  invalidateHydrations(): void;
  clear(): void;
}

export function createSubtitleOcrImportCoordination(
  context: SubtitleOcrImportCoordinationContext,
): SubtitleOcrImportCoordination {
  const hydrationTokensByItemId = new Map<string, string>();
  let dialogState: SubtitleOcrTrackDialogState = {
    open: false,
    sourcePath: '',
    tracks: [],
    lease: null,
  };
  let queuedTrackDialogs: TrackDialogRequest[] = [];

  function publishDialogState(next: SubtitleOcrTrackDialogState): void {
    dialogState = next;
    context.onDialogStateChange(next);
    context.onActivity();
  }

  function showImportWarnings(warnings: readonly string[]): void {
    for (const warning of warnings) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'Subtitle OCR import warning',
        details: warning,
        showAction: false,
      });
    }
  }

  async function hydrateImportedItem(
    item: SubtitleOcrSourceItem,
    hydrationToken: string,
    generation: number,
  ): Promise<void> {
    let hydrationFinished = false;
    try {
      const data = await loadSubtitleOcrData(item.sourcePath);
      if (
        !context.isImportGenerationCurrent(generation)
        || !subtitleOcrStore.isHydrationCurrent(item.id, hydrationToken)
        || !data
      ) {
        return;
      }

      const matchingData = filterSubtitleOcrPersistenceForItem(item, data);
      if (
        !context.isImportGenerationCurrent(generation)
        || !subtitleOcrStore.isHydrationCurrent(item.id, hydrationToken)
        || !matchingData
      ) {
        return;
      }

      if (!subtitleOcrStore.replaceHydratedItemVersions(
        item.id,
        hydrationToken,
        matchingData.versions,
        matchingData.activeVersionId,
        { status: 'completed' },
      )) {
        return;
      }
      subtitleOcrStore.finishHydration(item.id, hydrationToken);
      hydrationFinished = true;
      await context.restoreMissingPreviewAssets(item.id, hydrationToken, generation);
    } catch (error) {
      if (context.isImportGenerationCancelled(generation)) {
        return;
      }
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'Could not load saved Subtitle OCR versions',
        details: context.sanitizeProcessingMessage(error),
        showAction: false,
      });
    } finally {
      if (!hydrationFinished) {
        subtitleOcrStore.finishHydration(item.id, hydrationToken);
      }
      if (hydrationTokensByItemId.get(item.id) === hydrationToken) {
        hydrationTokensByItemId.delete(item.id);
        context.onActivity();
      }
      if (context.isImportGenerationCurrent(generation)) {
        context.requestPendingPreviewRestoreFlush();
      }
    }
  }

  async function addImportedItems(
    nextItems: readonly SubtitleOcrSourceItem[],
    generation: number,
  ): Promise<void> {
    if (nextItems.length === 0 || !context.isImportGenerationCurrent(generation)) {
      return;
    }

    const addedItems = subtitleOcrStore.addItems([...nextItems]);
    if (addedItems.length === 0) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'Subtitle sources are already imported',
        details: 'No new Subtitle OCR sources were added because every selected source is already in the workspace.',
        showAction: false,
      });
    } else if (addedItems.length < nextItems.length) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'Some subtitle sources were already imported',
        details: `${addedItems.length} of ${nextItems.length} selected Subtitle OCR sources were added.`,
        showAction: false,
      });
    } else {
      logAndToast.success({
        source: 'subtitle-ocr',
        title: addedItems.length === 1 ? 'Subtitle source imported' : 'Subtitle sources imported',
        details: `${addedItems.length} Subtitle OCR source${addedItems.length === 1 ? '' : 's'} added.`,
        showAction: false,
      });
    }

    for (const item of addedItems) {
      if (!context.isImportGenerationCurrent(generation)) {
        break;
      }

      const hydrationToken = subtitleOcrStore.startHydration(item.id);
      hydrationTokensByItemId.set(item.id, hydrationToken);
      context.onActivity();
      await hydrateImportedItem(item, hydrationToken, generation);
    }
  }

  async function importStandalonePaths(paths: string[], generation: number): Promise<void> {
    if (paths.length === 0 || !context.isImportGenerationCurrent(generation)) {
      return;
    }

    const result = await buildStandaloneSubtitleOcrItems(paths, context.resolveVobSubPair);
    if (!context.isImportGenerationCurrent(generation)) {
      return;
    }

    await addImportedItems(result.items, generation);
    showImportWarnings(result.warnings);
    if (result.items.length === 0 && result.warnings.length === 0) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'No complete standalone subtitle sources found',
        details: 'Standalone Subtitle OCR imports must be SUP files or complete IDX/SUB pairs.',
        showAction: false,
      });
    }
  }

  async function probeContainerPath(path: string, generation: number): Promise<Omit<TrackDialogRequest, 'lease'> | null> {
    try {
      const mediaInfo = await invoke<SubtitleOcrMediaInfo>('probe_subtitle_ocr_media', { path });
      if (!context.isImportGenerationCurrent(generation)) {
        return null;
      }
      if (mediaInfo.tracks.length === 0) {
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: `No bitmap subtitle tracks found in ${getFileName(path)}`,
          details: `MediaFlow could not find PGS or VobSub subtitle tracks in ${path}.`,
          context: { filePath: path },
          showAction: false,
        });
        return null;
      }

      return {
        sourcePath: path,
        sourceDuration: mediaInfo.durationSeconds,
        tracks: mediaInfo.tracks,
        generation,
      };
    } catch (error) {
      if (!context.isImportGenerationCurrent(generation)) {
        return null;
      }
      logAndToast.error({
        source: 'subtitle-ocr',
        title: `Could not inspect ${getFileName(path)}`,
        details: context.sanitizeProcessingMessage(error),
        context: { filePath: path },
      });
      return null;
    }
  }

  function openTrackDialog(request: TrackDialogRequest): void {
    publishDialogState({
      open: true,
      sourcePath: request.sourcePath,
      sourceDuration: request.sourceDuration,
      tracks: request.tracks,
      lease: request.lease,
    });
  }

  function closeTrackDialog(): void {
    const lease = dialogState.lease;
    publishDialogState({ open: false, sourcePath: '', tracks: [], lease: null });
    if (lease) {
      context.releaseImportGeneration(lease);
    }
  }

  function enqueueTrackDialogs(requests: Array<Omit<TrackDialogRequest, 'lease'>>): void {
    const retainedRequests = requests.flatMap((request) => {
      const lease = context.retainImportGeneration(request.generation);
      return lease ? [{ ...request, lease }] : [];
    });
    if (retainedRequests.length === 0) {
      return;
    }

    if (dialogState.open) {
      queuedTrackDialogs = [...queuedTrackDialogs, ...retainedRequests];
      context.onActivity();
      return;
    }

    const [nextRequest, ...remainingRequests] = retainedRequests;
    queuedTrackDialogs = [...queuedTrackDialogs, ...remainingRequests];
    if (nextRequest) {
      openTrackDialog(nextRequest);
    }
  }

  async function importContainerPaths(paths: string[], generation: number): Promise<void> {
    if (paths.length === 0 || !context.isImportGenerationCurrent(generation)) {
      return;
    }

    const requests: Array<Omit<TrackDialogRequest, 'lease'>> = [];
    for (const path of paths) {
      if (!context.isImportGenerationCurrent(generation)) {
        return;
      }
      const request = await probeContainerPath(path, generation);
      if (request) requests.push(request);
    }

    if (context.isImportGenerationCurrent(generation)) {
      enqueueTrackDialogs(requests);
    }
  }

  async function importPaths(paths: string[]): Promise<void> {
    const rootLease = context.beginImportGeneration();
    const generation = rootLease.generation;
    const standalonePaths: string[] = [];
    const containerPaths: string[] = [];

    for (const path of paths) {
      const kind = getSubtitleOcrImportKind(path);
      if (kind === 'container') containerPaths.push(path);
      else if (kind === 'standalone_sup' || kind === 'standalone_vobsub_part') standalonePaths.push(path);
    }

    try {
      if (standalonePaths.length === 0 && containerPaths.length === 0) {
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: 'No supported subtitle OCR sources found',
          details: 'Supported Subtitle OCR sources are containers with bitmap subtitle tracks, SUP files, or IDX/SUB pairs.',
          showAction: false,
        });
        return;
      }
      await importStandalonePaths(standalonePaths, generation);
      await importContainerPaths(containerPaths, generation);
    } finally {
      context.releaseImportGeneration(rootLease);
    }
  }

  async function handleImport(): Promise<void> {
    try {
      const expandedFiles = await pickAndExpandToolImport(
        toolImportPolicy('subtitle-ocr'),
        'subtitle-ocr',
        'files',
      );
      await importPaths(expandedFiles.map(({ path }) => path));
    } catch (error) {
      context.reportImportError(error);
    }
  }

  async function handleImportFolders(): Promise<void> {
    try {
      const expandedFiles = await pickAndExpandToolImport(
        toolImportPolicy('subtitle-ocr'),
        'subtitle-ocr',
        'folders',
      );
      await importPaths(expandedFiles.map(({ path }) => path));
    } catch (error) {
      context.reportImportError(error);
    }
  }

  async function handleFileDrop(paths: string[]): Promise<void> {
    try {
      const expandedFiles = await expandToolImportRoots(
        paths,
        toolImportPolicy('subtitle-ocr'),
        'subtitle-ocr',
      );
      await importPaths(expandedFiles.map(({ path }) => path));
    } catch (error) {
      context.reportImportError(error);
    }
  }

  async function handleImportTracks(selection: SubtitleOcrTrackImportSelection): Promise<void> {
    const lease = context.retainImportGeneration(selection.generation);
    if (!lease || context.isImportGenerationCancelled(selection.generation)) {
      return;
    }

    try {
      await addImportedItems(selection.items, selection.generation);
    } finally {
      context.releaseImportGeneration(lease);
    }
  }

  function openNextTrackDialog(): void {
    const [nextRequest, ...remainingRequests] = queuedTrackDialogs;
    queuedTrackDialogs = remainingRequests;
    if (nextRequest) openTrackDialog(nextRequest);
  }

  function handleDialogOpenChange(openState: boolean): void {
    if (openState) {
      publishDialogState({ ...dialogState, open: true });
      return;
    }

    closeTrackDialog();
    if (queuedTrackDialogs.length > 0) queueMicrotask(openNextTrackDialog);
  }

  function cancelQueuedAndCurrent(): void {
    for (const request of queuedTrackDialogs) {
      context.releaseImportGeneration(request.lease);
    }
    queuedTrackDialogs = [];
    context.onActivity();
    if (dialogState.open) closeTrackDialog();
  }

  function invalidateHydrations(): void {
    for (const [itemId, token] of hydrationTokensByItemId) {
      subtitleOcrStore.invalidateHydration(itemId, token);
    }
    hydrationTokensByItemId.clear();
    context.onActivity();
  }

  function invalidateHydration(itemId: string): void {
    const token = hydrationTokensByItemId.get(itemId);
    if (token) {
      subtitleOcrStore.invalidateHydration(itemId, token);
      hydrationTokensByItemId.delete(itemId);
      context.onActivity();
    }
  }

  function clear(): void {
    cancelQueuedAndCurrent();
    invalidateHydrations();
  }

  return {
    get hasDialogWork(): boolean {
      return dialogState.open || queuedTrackDialogs.length > 0;
    },
    get hasHydrationWork(): boolean {
      return hydrationTokensByItemId.size > 0 || subtitleOcrStore.hydratingItemIds.size > 0;
    },
    importPaths,
    handleImport,
    handleImportFolders,
    handleFileDrop,
    handleImportTracks,
    handleDialogOpenChange,
    cancelQueuedAndCurrent,
    invalidateHydration,
    invalidateHydrations,
    clear,
  };
}
