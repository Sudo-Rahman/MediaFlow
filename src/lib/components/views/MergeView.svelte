<script lang="ts" module>
  export interface MergeViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { open } from '@tauri-apps/plugin-dialog';
  import { toast } from 'svelte-sonner';

  import { useToolHeader } from '$lib/components/layout/tool-header-context.svelte';
  import { MergeAiMatchView, MergeHomeView, MergeOutputNamingView, MergeTrackGroups, MergeTrackSettings, MergeTrackTable, MergeViewModeActions } from '$lib/components/merge';
  import { ProcessingRemoveDialog } from '$lib/components/shared';
  import { fetchFileMetadata } from '$lib/services/file-metadata';
  import { scanFiles } from '$lib/services/ffprobe';
  import { analyzeMergeAiMatches } from '$lib/services/merge-ai';
  import { pickOutputDirectory } from '$lib/services/output-folder';
  import { getBaseName, getDirectoryFromPath, getExtension, type ResolveRenameTargetPathContext } from '$lib/services/rename';
  import { createRenameWorkspaceStore, mergeStore, settingsStore, toolImportStore } from '$lib/stores';
  import { getFileName, resolveOutputFolderDisplay } from '$lib/utils';
  import { logAndToast } from '$lib/utils/log-toast';
  import { getCodecFromExtension, type ImportedTrack, type MergeTrackConfig, type MergeProgressEvent, type MergeVideoFile, type RenameFile } from '$lib/types';
  import type { ImportItem, ImportSourceId, ImportableKind } from '$lib/types/tool-import';

  interface Props {
    onNavigateToSettings?: () => void;
  }

  let { onNavigateToSettings }: Props = $props();

  const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.webm', '.m4v', '.mks', '.mka'];
  const SUBTITLE_EXTENSIONS = ['.ass', '.ssa', '.srt', '.sub', '.idx', '.vtt', '.sup'];
  const AUDIO_EXTENSIONS = ['.aac', '.ac3', '.dts', '.flac', '.mp3', '.ogg', '.wav', '.eac3', '.opus'];
  const ALL_EXTENSIONS = [...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS, ...AUDIO_EXTENSIONS];
  const VIDEO_FORMATS = VIDEO_EXTENSIONS.map((extension) => extension.slice(1).toUpperCase());
  const STALE_AI_MATCH_MESSAGE = 'Files changed while AI Match was running. Run AI Match again.';

  type ForcedImportType = 'video' | 'subtitle' | 'audio';

  const toolHeader = useToolHeader();
  const outputNamingWorkspace = createRenameWorkspaceStore({
    mode: 'rename',
    includeOutputDirInTargetPath: true,
    targetPathOptions: {
      extension: '.mkv',
      resolveTargetPath: resolveMergeOutputTargetPath,
    },
  });

  let settingsOpen = $state(false);
  let editingTrackId = $state<string | null>(null);
  let editingTrackType = $state<'imported' | 'source'>('imported');
  let mergeInternalView = $state<'main' | 'output-naming' | 'ai-match'>('main');
  let viewMode = $state<'home' | 'groups' | 'table'>('home');

  let currentMergingId = $state<string | null>(null);
  let isCancelling = $state(false);
  let cancelAllRequested = $state(false);
  let cancelCurrentFileId = $state<string | null>(null);
  let removeDialogOpen = $state(false);
  let removeInProgress = $state(false);
  let removeTarget = $state.raw<{ mode: 'single'; fileId: string } | { mode: 'all' } | null>(null);
  let removeAfterCancelIds = new Set<string>();
  let clearAllAfterCancel = false;
  let unlistenMergeProgress: UnlistenFn | null = null;
  let activeAiPreviewContextKey = $state<string | null>(null);
  let mergedOutputItems = $state<Array<{
    key: string;
    path: string;
    name: string;
    kind: 'generic_file';
    createdAt: number;
  }>>([]);

  const autoMatchMode = $derived.by(() => mergeStore.autoMatchMode);
  const editingImportedTrack = $derived.by(() => {
    if (!editingTrackId || editingTrackType !== 'imported') {
      return null;
    }

    return mergeStore.importedTracks.find((track) => track.id === editingTrackId) ?? null;
  });
  const editingSourceTrack = $derived.by(() => {
    if (!editingTrackId || editingTrackType !== 'source') {
      return null;
    }

    for (const video of mergeStore.videoFiles) {
      const track = video.tracks.find((candidate) => candidate.id === editingTrackId);
      if (track) {
        return track;
      }
    }

    return null;
  });
  const editingTrackPreview = $derived.by(() => {
    const importedTrack = editingImportedTrack;
    if (!importedTrack) {
      return editingSourceTrack;
    }

    return createImportedTrackSettingsPreview(importedTrack);
  });
  const editingTrackConfig = $derived.by(() => {
    if (editingTrackType === 'imported') {
      return editingImportedTrack?.config ?? null;
    }

    const sourceTrack = editingSourceTrack;
    return sourceTrack ? mergeStore.getSourceTrackConfig(sourceTrack.id) ?? null : null;
  });
  const editingTrackTitle = $derived.by(() =>
    editingTrackType === 'imported' ? editingImportedTrack?.name ?? null : null,
  );
  const isProcessing = $derived.by(() => mergeStore.status === 'processing');
  const currentMergingFileName = $derived.by(() => {
    if (!currentMergingId) {
      return '';
    }

    return mergeStore.videoFiles.find((video) => video.id === currentMergingId)?.name ?? '';
  });
  const selectedOutputVideoIds = $derived.by(() =>
    new Set(outputNamingWorkspace.selectedFiles.map((file) => file.id)),
  );
  const selectedVideosToMerge = $derived.by(() =>
    mergeStore.videosReadyForMerge.filter((video) => selectedOutputVideoIds.has(video.id)),
  );
  const selectedVideosToMergeCount = $derived.by(() => selectedVideosToMerge.length);
  const selectedMergeSourcePaths = $derived.by(() => selectedVideosToMerge.map((video) => video.path));
  const selectedTracksToMergeCount = $derived.by(() =>
    selectedVideosToMerge.reduce((sum, video) => sum + video.attachedTracks.length, 0),
  );
  const outputNamingFolderDisplay = $derived.by(() =>
    resolveOutputFolderDisplay({
      explicitPath: outputNamingWorkspace.outputDir,
      sourcePaths: selectedMergeSourcePaths,
      allowSourceFallback: true,
      fallbackLabel: 'Use each source folder',
    }),
  );
  const readyVideos = $derived.by(() => mergeStore.videoFiles.filter((video) => video.status === 'ready'));
  const aiCandidateTracks = $derived.by(() => mergeStore.unassignedTracks);
  const aiApiKey = $derived.by(() => settingsStore.getLLMApiKey(mergeStore.aiProvider));
  const canRunAiAutoMatch = $derived.by(() =>
    readyVideos.length > 0
      && aiCandidateTracks.length > 0
      && aiApiKey.trim().length > 0
      && mergeStore.aiModel.trim().length > 0
      && mergeStore.aiStatus !== 'analyzing',
  );
  const aiPreviewContextKey = $derived.by(() =>
    `${readyVideos.map((video) => video.id).join('|')}::${aiCandidateTracks.map((track) => track.id).join('|')}`,
  );
  const mergeHeaderTitle = $derived.by(() => {
    if (mergeInternalView === 'output-naming') {
      return 'Output Naming';
    }

    if (mergeInternalView === 'ai-match') {
      return 'AI Auto-match';
    }

    return undefined;
  });

  function resolveMergeOutputTargetPath(
    file: RenameFile,
    context: ResolveRenameTargetPathContext,
  ): string {
    const nextPath = context.buildDefaultPath(file);
    if (nextPath !== file.originalPath) {
      return nextPath;
    }

    return context.buildDefaultPath({
      ...file,
      newName: `${file.newName}_merged`,
    });
  }

  function createImportedTrackSettingsPreview(importedTrack: ImportedTrack) {
    return {
      id: importedTrack.id,
      sourceFileId: '',
      originalIndex: 0,
      type: importedTrack.type,
      codec: importedTrack.codec,
      codecLong: undefined,
      language: importedTrack.language,
      title: importedTrack.title,
      bitrate: undefined,
      width: undefined,
      height: undefined,
      frameRate: undefined,
      channels: undefined,
      sampleRate: undefined,
      forced: importedTrack.config.forced,
      default: importedTrack.config.default,
    };
  }

  function createMergeOutputRenameFile(video: MergeVideoFile): RenameFile {
    const baseName = getBaseName(video.name);

    return {
      id: video.id,
      originalPath: video.path,
      originalName: baseName,
      extension: getExtension(video.name),
      newName: baseName,
      selected: true,
      status: 'pending',
      size: video.size,
      modifiedAt: video.modifiedAt,
      createdAt: video.createdAt,
    };
  }

  function buildMergeOutputPath(video: MergeVideoFile): string {
    const namingFile = outputNamingWorkspace.files.find((file) => file.id === video.id)
      ?? createMergeOutputRenameFile(video);
    return outputNamingWorkspace.getTargetPath(namingFile);
  }

  function appendMergedOutputs(paths: string[]): void {
    if (paths.length === 0) {
      return;
    }

    const now = Date.now();
    const byPath = new Map(mergedOutputItems.map((item) => [item.path, item]));

    for (const path of paths) {
      byPath.set(path, {
        key: `merge-output:${path}`,
        path,
        name: getFileName(path),
        kind: 'generic_file',
        createdAt: now,
      });
    }

    mergedOutputItems = Array.from(byPath.values());
  }

  function kindToForcedImportType(kind: ImportableKind): ForcedImportType | null {
    if (kind === 'track_video') {
      return 'video';
    }

    if (kind === 'track_subtitle') {
      return 'subtitle';
    }

    if (kind === 'track_audio') {
      return 'audio';
    }

    return null;
  }

  function buildSourceImportPayload(items: ImportItem[]): {
    paths: string[];
    forcedTypes: Map<string, ForcedImportType>;
  } {
    const pathSet = new Set<string>();
    const forcedTypes = new Map<string, ForcedImportType>();

    for (const item of items) {
      if (item.itemType !== 'path') {
        continue;
      }

      pathSet.add(item.path);
      const forcedType = kindToForcedImportType(item.kind);
      if (forcedType) {
        forcedTypes.set(item.path, forcedType);
      }
    }

    return { paths: Array.from(pathSet), forcedTypes };
  }

  export async function handleFileDrop(paths: string[]) {
    const supportedPaths = paths.filter((path) => {
      const extension = path.toLowerCase().substring(path.lastIndexOf('.'));
      return ALL_EXTENSIONS.includes(extension);
    });

    if (supportedPaths.length === 0) {
      toast.warning('No supported files detected');
      return;
    }

    await addFiles(supportedPaths);
  }

  async function handleAddVideoFiles(): Promise<void> {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Video files', extensions: VIDEO_EXTENSIONS.map((extension) => extension.slice(1)) }],
    });

    if (selected) {
      await addFiles(Array.isArray(selected) ? selected : [selected]);
    }
  }

  async function handleAddTrackFiles(): Promise<void> {
    const selected = await open({
      multiple: true,
      filters: [
        { name: 'All tracks', extensions: [...SUBTITLE_EXTENSIONS, ...AUDIO_EXTENSIONS].map((extension) => extension.slice(1)) },
        { name: 'Subtitles', extensions: SUBTITLE_EXTENSIONS.map((extension) => extension.slice(1)) },
        { name: 'Audio', extensions: AUDIO_EXTENSIONS.map((extension) => extension.slice(1)) },
      ],
    });

    if (selected) {
      await addFiles(Array.isArray(selected) ? selected : [selected]);
    }
  }

  async function addFiles(paths: string[], forcedTypes?: Map<string, ForcedImportType>): Promise<void> {
    if (mergeStore.status === 'completed') {
      mergeStore.reset();
    }

    let videosAdded = 0;
    let tracksAdded = 0;
    let skipped = 0;

    const videoPaths: string[] = [];
    const videoFileIds = new Map<string, string>();

    for (const path of paths) {
      if (mergeStore.isFileAlreadyImported(path)) {
        skipped += 1;
        continue;
      }

      const name = getFileName(path);
      const extension = path.toLowerCase().substring(path.lastIndexOf('.'));
      const forcedType = forcedTypes?.get(path);

      if (forcedType === 'video' || (!forcedType && VIDEO_EXTENSIONS.includes(extension))) {
        const fileId = mergeStore.addVideoFile({
          path,
          name,
          size: 0,
          tracks: [],
          status: 'scanning',
        });
        videoPaths.push(path);
        videoFileIds.set(path, fileId);
      } else {
        const type: 'subtitle' | 'audio' = (forcedType === 'subtitle' || forcedType === 'audio')
          ? forcedType
          : (SUBTITLE_EXTENSIONS.includes(extension) ? 'subtitle' : 'audio');

        mergeStore.addImportedTrack({
          path,
          name,
          type,
          codec: getCodecFromExtension(extension),
          language: undefined,
          title: name,
        });
        tracksAdded += 1;
      }
    }

    if (videoPaths.length > 0) {
      const [scannedFiles, metadataEntries] = await Promise.all([
        scanFiles(videoPaths, 3),
        Promise.all(videoPaths.map(async (path) => [path, await fetchFileMetadata(path)] as const)),
      ]);
      const metadataByPath = new Map(metadataEntries);

      for (const scanned of scannedFiles) {
        const fileId = videoFileIds.get(scanned.path);
        if (!fileId) {
          continue;
        }

        const metadata = metadataByPath.get(scanned.path);

        if (scanned.status === 'error') {
          mergeStore.updateVideoFile(fileId, {
            status: 'error',
            error: scanned.error,
            modifiedAt: metadata?.modifiedAt,
            createdAt: metadata?.createdAt,
          });
          continue;
        }

        const tracks = scanned.tracks.map((track) => ({
          id: `${fileId}-track-${track.id}`,
          sourceFileId: fileId,
          originalIndex: track.index,
          type: track.type,
          codec: track.codec,
          codecLong: track.codecLong,
          language: track.language,
          title: track.title,
          bitrate: track.bitrate,
          width: track.width,
          height: track.height,
          frameRate: track.frameRate,
          channels: track.channels,
          sampleRate: track.sampleRate,
          forced: track.forced,
          default: track.default,
        }));

        mergeStore.updateVideoFile(fileId, {
          size: scanned.size,
          modifiedAt: metadata?.modifiedAt,
          createdAt: metadata?.createdAt,
          duration: scanned.duration,
          tracks,
          status: 'ready',
        });

        for (const track of tracks) {
          mergeStore.initSourceTrackConfig(track);
        }

        videosAdded += 1;
      }
    }

    const parts: string[] = [];
    if (videosAdded > 0) {
      parts.push(`${videosAdded} video(s)`);
    }
    if (tracksAdded > 0) {
      parts.push(`${tracksAdded} track(s)`);
    }
    if (skipped > 0) {
      parts.push(`${skipped} skipped`);
    }

    if (parts.length > 0) {
      toast.success(`Added: ${parts.join(', ')}`);
    }
  }

  async function handleImportFromSource(sourceId: ImportSourceId): Promise<void> {
    const items = toolImportStore.getItems(sourceId, 'merge');
    if (items.length === 0) {
      toast.info('No compatible tracks available from this source');
      return;
    }

    const { paths, forcedTypes } = buildSourceImportPayload(items);
    if (paths.length === 0) {
      toast.info('No compatible tracks available from this source');
      return;
    }

    await addFiles(paths, forcedTypes);
  }

  function handleAutoMatch(): void {
    mergeStore.autoMatchByEpisodeNumber();
    const matched = mergeStore.videoFiles.filter((video) => video.attachedTracks.length > 0).length;

    if (matched > 0) {
      toast.success(`Auto-matched ${matched} video(s) with tracks`);
      return;
    }

    toast.info('No matches found. Check episode numbers in filenames.');
  }

  function handleAutoMatchAction(): void {
    if (autoMatchMode === 'classic') {
      handleAutoMatch();
      return;
    }

    mergeInternalView = 'ai-match';
  }

  async function handleRunAiAutoMatch(): Promise<void> {
    if (!canRunAiAutoMatch) {
      if (readyVideos.length === 0) {
        toast.info('Add ready video files before running Auto-match AI');
      } else if (aiCandidateTracks.length === 0) {
        toast.info('There are no unassigned tracks to analyze');
      } else if (!aiApiKey.trim()) {
        toast.error('Configure an API key before running Auto-match AI');
      } else if (!mergeStore.aiModel.trim()) {
        toast.error('Select an AI model before running Auto-match AI');
      }
      return;
    }

    const analysisContextKey = aiPreviewContextKey;
    mergeStore.startAiAnalysis();

    try {
      const result = await analyzeMergeAiMatches({
        videos: readyVideos,
        tracks: aiCandidateTracks,
        provider: mergeStore.aiProvider,
        model: mergeStore.aiModel,
      });

      if (analysisContextKey !== aiPreviewContextKey) {
        mergeStore.setAiError(STALE_AI_MATCH_MESSAGE);
        return;
      }

      mergeStore.setAiPreview(result.suggestions, result.warnings);
    } catch (error) {
      if (analysisContextKey !== aiPreviewContextKey) {
        mergeStore.setAiError(STALE_AI_MATCH_MESSAGE);
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      mergeStore.setAiError(message);
    }
  }

  function handleApplyAiSuggestions(): void {
    const applied = mergeStore.applySelectedAiSuggestions();

    if (applied > 0) {
      toast.success(`Applied ${applied} AI match(es)`);
      return;
    }

    toast.info('No AI matches were selected');
  }

  function handleClearAiSuggestions(): void {
    mergeStore.clearAiState();
  }

  async function handleSelectOutputDir(): Promise<void> {
    const selected = await pickOutputDirectory();
    if (selected) {
      mergeStore.setOutputDir(selected);
      outputNamingWorkspace.setOutputDir(selected);
    }
  }

  function handleClearOutputDir(): void {
    mergeStore.setOutputDir('');
    outputNamingWorkspace.setOutputDir('');
  }

  function handleOpenOutputNaming(): void {
    mergeInternalView = 'output-naming';
  }

  function handleBackToMerge(): void {
    mergeInternalView = 'main';
  }

  async function handleMerge(): Promise<void> {
    const videosToMerge = selectedVideosToMerge;
    if (videosToMerge.length === 0) {
      toast.warning('No videos ready to merge.');
      return;
    }

    const selectedNamingFiles = outputNamingWorkspace.files.filter((file) =>
      videosToMerge.some((video) => video.id === file.id) && file.selected,
    );
    const conflictCount = outputNamingWorkspace.getConflicts(selectedNamingFiles).size;
    if (conflictCount > 0) {
      toast.error('Please resolve output naming conflicts before merging.');
      return;
    }

    mergeStore.setStatus('processing');
    mergeStore.startRuntimeProgress(videosToMerge.length);
    mergeStore.initializeFileRunStates(videosToMerge.map((video) => video.path));
    currentMergingId = null;
    isCancelling = false;
    cancelAllRequested = false;
    cancelCurrentFileId = null;
    removeAfterCancelIds = new Set();
    clearAllAfterCancel = false;

    const mergedPaths: string[] = [];
    let completed = 0;
    let cancelled = 0;
    let mergeError: string | null = null;

    for (const video of videosToMerge) {
      if (cancelAllRequested) {
        break;
      }

      currentMergingId = video.id;
      mergeStore.setFileProcessing(video.path);
      mergeStore.setCurrentRuntimeFile(video.id, video.path, video.name);

      const attachedTracks = mergeStore.getAttachedTracks(video.id);
      const fullOutputPath = buildMergeOutputPath(video);
      const trackArgs = attachedTracks.map((track) => ({
        inputPath: track.path,
        trackIndex: 0,
        config: track.config,
      }));
      const sourceTrackConfigs = video.tracks.map((track) => {
        const config = mergeStore.getSourceTrackConfig(track.id);
        return {
          originalIndex: track.originalIndex,
          type: track.type,
          config: config || {
            trackId: track.id,
            enabled: true,
            language: track.language,
            title: track.title,
            default: track.default,
            forced: track.forced,
            delayMs: 0,
            order: 0,
          },
        };
      });

      try {
        await invoke('merge_tracks', {
          videoPath: video.path,
          tracks: trackArgs,
          sourceTrackConfigs,
          outputPath: fullOutputPath,
          durationUs: video.duration ? Math.round(video.duration * 1_000_000) : undefined,
        });

        mergedPaths.push(fullOutputPath);
        completed += 1;
        mergeStore.setFileCompleted(video.path);
      } catch (error) {
        if (cancelAllRequested || cancelCurrentFileId === video.id) {
          cancelled += 1;
          mergeStore.setFileCancelled(video.path);
        } else {
          mergeError = error instanceof Error ? error.message : String(error);
          mergeStore.setFileError(video.path, mergeError);
          break;
        }
      } finally {
        mergeStore.markRuntimeFileCompleted();

        if (cancelCurrentFileId === video.id) {
          cancelCurrentFileId = null;
          if (!cancelAllRequested) {
            isCancelling = false;
          }
        }
      }
    }

    currentMergingId = null;

    if (cancelAllRequested) {
      for (const video of videosToMerge) {
        const runState = mergeStore.getFileRunState(video.path);
        if (runState.status === 'queued') {
          mergeStore.setFileCancelled(video.path);
        }
      }
    }

    const pendingRemoveIds = new Set(removeAfterCancelIds);
    const shouldClearAllAfterCancel = clearAllAfterCancel;

    if (mergeError) {
      mergeStore.setError(mergeError);
      mergeStore.resetRuntimeProgress();
      logAndToast.error({
        source: 'merge',
        title: 'Merge failed',
        details: mergeError,
      });
    } else if (cancelAllRequested || cancelled > 0) {
      mergeStore.setStatus('idle');
      mergeStore.resetRuntimeProgress();
      appendMergedOutputs(mergedPaths);

      if (shouldClearAllAfterCancel) {
        mergeStore.clearAll();
        mergedOutputItems = [];
      } else if (pendingRemoveIds.size > 0) {
        for (const fileId of pendingRemoveIds) {
          mergeStore.removeVideoFile(fileId);
        }
      }

      const parts: string[] = [];
      if (completed > 0) {
        parts.push(`${completed} completed`);
      }
      if (cancelled > 0) {
        parts.push(`${cancelled} cancelled`);
      }
      toast.info(parts.length > 0 ? `Merge finished: ${parts.join(', ')}` : 'Merge cancelled');
    } else {
      mergeStore.setStatus('completed');
      appendMergedOutputs(mergedPaths);
      toast.success(`Successfully merged ${completed} file(s)!`);
    }

    isCancelling = false;
    cancelAllRequested = false;
    cancelCurrentFileId = null;
    clearAllAfterCancel = false;
    removeAfterCancelIds = new Set();
  }

  async function handleCancelFile(fileId: string): Promise<boolean> {
    if (!mergeStore.isProcessing || isCancelling || currentMergingId !== fileId) {
      return false;
    }

    const video = mergeStore.videoFiles.find((candidate) => candidate.id === fileId);
    if (!video) {
      return false;
    }

    cancelCurrentFileId = fileId;
    isCancelling = true;

    try {
      await invoke('cancel_merge_file', { videoPath: video.path });
      toast.info('Cancelling current file...');
      return true;
    } catch (error) {
      cancelCurrentFileId = null;
      isCancelling = false;
      logAndToast.error({
        source: 'merge',
        title: 'Cancel failed',
        details: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async function handleCancelAll(): Promise<boolean> {
    if (!mergeStore.isProcessing || isCancelling) {
      return false;
    }

    cancelAllRequested = true;
    isCancelling = true;

    try {
      await invoke('cancel_merge');
      toast.info('Cancelling merge...');
      return true;
    } catch (error) {
      cancelAllRequested = false;
      isCancelling = false;
      logAndToast.error({
        source: 'merge',
        title: 'Cancel failed',
        details: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async function handleOpenFolder(): Promise<void> {
    const basePath = mergeStore.outputConfig.outputDir || mergedOutputItems[0]?.path;
    if (!basePath) {
      toast.info('No output folder available yet');
      return;
    }

    const folderPath = mergeStore.outputConfig.outputDir || getDirectoryFromPath(basePath);
    await invoke('open_folder', { path: folderPath });
  }

  function handleClearAll(): void {
    mergeStore.clearAll();
    mergedOutputItems = [];
    toast.info('Cleared all files');
  }

  function handleRequestRemoveFile(fileId: string): void {
    const isCurrentProcessing = mergeStore.isProcessing && currentMergingId === fileId;
    if (isCurrentProcessing) {
      removeTarget = { mode: 'single', fileId };
      removeDialogOpen = true;
      return;
    }

    if (!mergeStore.isProcessing) {
      mergeStore.removeVideoFile(fileId);
    }
  }

  function handleRequestClearAll(): void {
    if (mergeStore.isProcessing) {
      removeTarget = { mode: 'all' };
      removeDialogOpen = true;
      return;
    }

    handleClearAll();
  }

  async function handleConfirmRemove(): Promise<void> {
    const target = removeTarget;
    if (!target) {
      return;
    }

    removeInProgress = true;

    if (target.mode === 'single') {
      removeAfterCancelIds = new Set([...removeAfterCancelIds, target.fileId]);
      const cancelled = await handleCancelFile(target.fileId);
      if (!cancelled) {
        removeAfterCancelIds = new Set(
          Array.from(removeAfterCancelIds).filter((fileId) => fileId !== target.fileId),
        );
        removeInProgress = false;
        return;
      }
    } else {
      clearAllAfterCancel = true;
      const cancelled = await handleCancelAll();
      if (!cancelled) {
        clearAllAfterCancel = false;
        removeInProgress = false;
        return;
      }
    }

    removeDialogOpen = false;
    removeTarget = null;
    removeInProgress = false;
  }

  function handleCancelRemoveDialog(): void {
    removeDialogOpen = false;
    removeTarget = null;
    removeAfterCancelIds = new Set();
    clearAllAfterCancel = false;
  }

  function handleEditImportedTrack(trackId: string): void {
    editingTrackId = trackId;
    editingTrackType = 'imported';
    settingsOpen = true;
  }

  function handleEditSourceTrack(trackId: string): void {
    editingTrackId = trackId;
    editingTrackType = 'source';
    settingsOpen = true;
  }

  function handleCloseSettings(): void {
    settingsOpen = false;
    editingTrackId = null;
  }

  function handleSaveTrackSettings(updates: Partial<MergeTrackConfig>): void {
    if (!editingTrackId) {
      return;
    }

    if (editingTrackType === 'imported') {
      mergeStore.updateTrackConfig(editingTrackId, updates);
      return;
    }

    mergeStore.updateSourceTrackConfig(editingTrackId, updates);
  }

  onMount(() => {
    let destroyed = false;

    const setup = async () => {
      await mergeStore.loadUiPreferences();
      if (destroyed) {
        return;
      }

      const unlisten = await listen<MergeProgressEvent>('merge-progress', (event) => {
        if (!mergeStore.isProcessing) {
          return;
        }

        const runtime = mergeStore.runtimeProgress;
        if (!runtime.currentFilePath || runtime.currentFilePath !== event.payload.videoPath) {
          return;
        }

        mergeStore.updateRuntimeCurrentFile(
          event.payload.progress,
          event.payload.speedBytesPerSec,
        );
        mergeStore.updateFileRunProgress(
          runtime.currentFilePath,
          event.payload.progress,
          event.payload.speedBytesPerSec,
        );
      });

      if (destroyed) {
        unlisten();
        return;
      }

      unlistenMergeProgress = unlisten;
    };

    void setup();

    return () => {
      destroyed = true;
      unlistenMergeProgress?.();
      unlistenMergeProgress = null;
    };
  });

  $effect(() => {
    const nextFiles = mergeStore.videoFiles.map((video) => createMergeOutputRenameFile(video));
    untrack(() => {
      outputNamingWorkspace.replaceFiles(nextFiles, { preserveSelection: true });
    });
  });

  $effect(() => {
    const mergeOutputDir = mergeStore.outputConfig.outputDir;
    untrack(() => {
      if (outputNamingWorkspace.outputDir !== mergeOutputDir) {
        outputNamingWorkspace.setOutputDir(mergeOutputDir);
      }
    });
  });

  $effect(() => {
    const mediaItems = mergeStore.videoFiles
      .filter((file) => file.status === 'ready')
      .map((file) => ({
        key: `merge-media:${file.path}`,
        path: file.path,
        name: file.name,
        kind: 'media' as const,
        createdAt: Date.now(),
      }));

    toolImportStore.publishPathSource('merge_media', 'merge', 'Merge', mediaItems);

    return () => {
      toolImportStore.clearSource('merge_media');
    };
  });

  $effect(() => {
    toolImportStore.publishPathSource('merge_outputs', 'merge', 'Merge', mergedOutputItems);

    return () => {
      toolImportStore.clearSource('merge_outputs');
    };
  });

  $effect(() => {
    const contextKey = aiPreviewContextKey;

    if (mergeStore.aiStatus === 'preview') {
      if (activeAiPreviewContextKey && activeAiPreviewContextKey !== contextKey) {
        mergeStore.clearAiState();
        activeAiPreviewContextKey = null;
        return;
      }

      activeAiPreviewContextKey = contextKey;
      return;
    }

    activeAiPreviewContextKey = null;
  });

  $effect(() => {
    const headerConfig = {
      title: mergeHeaderTitle,
      actions: mergeHeaderActions,
    };

    toolHeader.setHeader('merge', headerConfig);

    return () => {
      toolHeader.clearHeader('merge', headerConfig);
    };
  });

  onDestroy(() => {
    outputNamingWorkspace.destroy();
    toolHeader.clearHeader('merge');
  });
</script>

{#snippet mergeHeaderActions()}
  <MergeViewModeActions
    internalView={mergeInternalView}
    {viewMode}
    onBack={handleBackToMerge}
    onViewModeChange={(nextViewMode) => viewMode = nextViewMode}
  />
{/snippet}

{#if mergeInternalView === 'output-naming'}
  <MergeOutputNamingView
    workspace={outputNamingWorkspace}
    outputFolderDisplay={outputNamingFolderDisplay}
    selectedVideosCount={selectedVideosToMergeCount}
    selectedTracksCount={selectedTracksToMergeCount}
    onClearAll={handleRequestClearAll}
    onRemoveFile={handleRequestRemoveFile}
    onBrowseOutputDir={handleSelectOutputDir}
    onResetOutputDir={handleClearOutputDir}
  />
{:else if mergeInternalView === 'ai-match'}
  <MergeAiMatchView
    videos={readyVideos}
    importedTracks={mergeStore.importedTracks}
    unassignedTracks={aiCandidateTracks}
    provider={mergeStore.aiProvider}
    model={mergeStore.aiModel}
    status={mergeStore.aiStatus}
    error={mergeStore.aiError}
    suggestions={mergeStore.aiSuggestions}
    warnings={mergeStore.aiWarnings}
    canAnalyze={canRunAiAutoMatch}
    onProviderChange={(provider) => mergeStore.setAiProvider(provider)}
    onModelChange={(model) => mergeStore.setAiModel(model)}
    onAnalyze={() => void handleRunAiAutoMatch()}
    onApply={handleApplyAiSuggestions}
    onClear={handleClearAiSuggestions}
    onToggleSuggestion={(trackId, selected) => mergeStore.setAiSuggestionSelected(trackId, selected)}
    onNavigateToSettings={onNavigateToSettings}
  />
{:else if viewMode === 'groups'}
  <div class="h-full">
    <MergeTrackGroups />
  </div>
{:else if viewMode === 'table'}
  <div class="h-full">
    <MergeTrackTable />
  </div>
{:else}
  <MergeHomeView
    autoMatchMode={autoMatchMode}
    videoFormats={VIDEO_FORMATS}
    selectedMergeSourcePaths={selectedMergeSourcePaths}
    selectedTracksToMergeCount={selectedTracksToMergeCount}
    selectedVideosToMergeCount={selectedVideosToMergeCount}
    currentFileName={currentMergingFileName}
    currentFileProgress={mergeStore.runtimeProgress.currentFileProgress}
    currentSpeedBytesPerSec={mergeStore.runtimeProgress.currentSpeedBytesPerSec}
    completedFiles={mergeStore.runtimeProgress.completedFiles}
    status={mergeStore.status}
    isProcessing={isProcessing}
    {isCancelling}
    currentProcessingPath={mergeStore.runtimeProgress.currentFilePath}
    onAddVideoFiles={handleAddVideoFiles}
    onRequestClearAll={handleRequestClearAll}
    onSelectVideo={(fileId) => mergeStore.selectVideo(fileId)}
    onCancelFile={(fileId) => { void handleCancelFile(fileId); }}
    onRequestRemoveFile={handleRequestRemoveFile}
    onAutoMatch={handleAutoMatchAction}
    onAutoMatchModeChange={(mode) => mergeStore.setAutoMatchMode(mode)}
    onEditSourceTrack={handleEditSourceTrack}
    onAddTrackFiles={handleAddTrackFiles}
    onEditImportedTrack={handleEditImportedTrack}
    onImportFromSource={handleImportFromSource}
    onSelectOutputDir={handleSelectOutputDir}
    onClearOutputDir={handleClearOutputDir}
    onEditOutputNames={handleOpenOutputNaming}
    onMerge={handleMerge}
    onOpenFolder={handleOpenFolder}
    onCancelAll={() => { void handleCancelAll(); }}
  />
{/if}

<MergeTrackSettings
  open={settingsOpen}
  track={editingTrackPreview}
  config={editingTrackConfig}
  title={editingTrackTitle}
  onClose={handleCloseSettings}
  onSave={handleSaveTrackSettings}
/>

<ProcessingRemoveDialog
  bind:open={removeDialogOpen}
  mode={removeTarget?.mode ?? null}
  inProgress={removeInProgress}
  onConfirm={handleConfirmRemove}
  onCancel={handleCancelRemoveDialog}
/>
