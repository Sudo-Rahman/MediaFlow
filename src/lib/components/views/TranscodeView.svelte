<script lang="ts" module>
  export interface TranscodeViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { open } from '@tauri-apps/plugin-dialog';
  import { ArrowLeft, Copy, Save, Sparkles, Wand2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';

  import { createRenameWorkspaceStore, transcodeStore } from '$lib/stores';
  import { fetchFileMetadata } from '$lib/services/file-metadata';
  import { scanFiles } from '$lib/services/ffprobe';
  import { analyzeTranscodeProfile } from '$lib/services/transcode-ai';
  import { pickOutputDirectory } from '$lib/services/output-folder';
  import {
    buildDefaultTranscodeMetadata,
    buildDefaultTranscodeProfile,
    canEditTranscodeMetadata,
    clampTranscodeProfile,
    cloneTranscodeProfile,
    createTranscodeRequest,
    extractTranscodeAnalysisFrames,
    fileHasAudio,
    fileHasVideo,
    getAvailableAudioModeOptions,
    getAvailableSubtitleModeOptions,
    getAvailableVideoModeOptions,
    getCompatibleAudioEncoders,
    getCompatibleSubtitleEncoders,
    getCompatibleVideoEncoders,
    getAudioEncoderCapability,
    getContainerCapability,
    getContainerExtension,
    getPrimaryAudioTrack,
    getPrimaryVideoTrack,
    getSubtitleEncoderCapability,
    getTranscodeCompatibilityIssues,
    getTracksByType,
    getTranscodeCapabilities,
    getVideoEncoderCapability,
    getVideoPresetOptions,
    transcodeMedia,
  } from '$lib/services/transcode';
  import { getBaseName, type ResolveRenameTargetPathContext } from '$lib/services/rename';
  import type {
    RenameFile,
    TranscodeFile,
    TranscodePresetTab,
    TranscodeProgressEvent,
    TranscodeProfile,
    TranscodeMode,
    TranscodeTab,
  } from '$lib/types';
  import { logAndToast } from '$lib/utils/log-toast';

  import { useToolHeader } from '$lib/components/layout/tool-header-context.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import * as Tabs from '$lib/components/ui/tabs';
  import {
    TranscodeAiPanel,
    TranscodeAudioTab,
    TranscodeEmptyState,
    TranscodeFileSidebar,
    TranscodeInfoDialog,
    TranscodeMetadataTab,
    TranscodeOutputNamingView,
    TranscodeOutputTab,
    TranscodePresetDialog,
    TranscodeQueueBar,
    TranscodeSelectedFileHeader,
    TranscodeSubtitlesTab,
    TranscodeVideoTab,
  } from '$lib/components/transcode';

  interface Props {
    onNavigateToSettings?: () => void;
  }

  let { onNavigateToSettings }: Props = $props();

  const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.mov', '.webm', '.m4v', '.avi', '.mxf'];
  const AUDIO_EXTENSIONS = ['.m4a', '.aac', '.mp3', '.flac', '.opus', '.wav', '.ogg', '.ac3', '.eac3', '.mka'];
  const SUPPORTED_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];
  const SUPPORTED_FORMATS = SUPPORTED_EXTENSIONS.map((extension) => extension.slice(1).toUpperCase());
  const toolHeader = useToolHeader();

  let infoDialogOpen = $state(false);
  let infoDialogFileId = $state<string | null>(null);
  let transcodeInternalView = $state<'main' | 'output-naming'>('main');
  let cancelAllRequested = $state(false);
  let cancelCurrentFileId = $state<string | null>(null);
  let isAnalyzingAi = $state(false);
  let presetManagerOpen = $state(false);
  let isDestroyed = false;
  let unlistenTranscodeProgress: UnlistenFn | null = null;

  const outputNamingWorkspace = createRenameWorkspaceStore({
    mode: 'rename',
    includeOutputDirInTargetPath: true,
    targetPathOptions: {
      resolveTargetPath: resolveTranscodeOutputTargetPath,
    },
  });

  const selectedFile = $derived(transcodeStore.selectedFile ?? null);
  const infoDialogFile = $derived(
    infoDialogFileId
      ? transcodeStore.files.find((file) => file.id === infoDialogFileId) ?? null
      : null,
  );
  const selectedVideoTrack = $derived.by(() => selectedFile ? getPrimaryVideoTrack(selectedFile) ?? null : null);
  const selectedAudioTrack = $derived.by(() => selectedFile ? getPrimaryAudioTrack(selectedFile) ?? null : null);
  const selectedAudioTracks = $derived.by(() => selectedFile ? getTracksByType(selectedFile, 'audio') : []);
  const selectedSubtitleTracks = $derived.by(() => selectedFile ? getTracksByType(selectedFile, 'subtitle') : []);
  const availableContainers = $derived.by(() => {
    if (!selectedFile || !transcodeStore.capabilities) {
      return [];
    }

    return transcodeStore.capabilities.containers.filter((container) =>
      selectedFile.hasVideo ? container.kind === 'video' : container.kind === 'audio',
    );
  });
  const selectedContainer = $derived.by(() =>
    selectedFile
      ? getContainerCapability(transcodeStore.capabilities, selectedFile.profile.containerId) ?? null
      : null,
  );
  const availableVideoEncoders = $derived.by(() =>
    selectedFile?.hasVideo ? getCompatibleVideoEncoders(transcodeStore.capabilities, selectedContainer) : [],
  );
  const availableAudioEncoders = $derived.by(() =>
    selectedFile?.hasAudio ? getCompatibleAudioEncoders(transcodeStore.capabilities, selectedContainer) : [],
  );
  const availableSubtitleEncoders = $derived.by(() =>
    selectedSubtitleTracks.length > 0
      ? getCompatibleSubtitleEncoders(transcodeStore.capabilities, selectedContainer)
      : [],
  );
  const availableVideoModeOptions = $derived.by(() =>
    selectedFile ? getAvailableVideoModeOptions(selectedFile, selectedContainer) : [],
  );
  const availableAudioModeOptions = $derived.by(() =>
    selectedFile ? getAvailableAudioModeOptions(selectedFile, selectedContainer) : [],
  );
  const availableSubtitleModeOptions = $derived.by(() =>
    selectedFile ? getAvailableSubtitleModeOptions(selectedFile, selectedContainer) : [],
  );
  const selectedVideoEncoder = $derived.by(() =>
    selectedFile
      ? getVideoEncoderCapability(transcodeStore.capabilities, selectedFile.profile.video.encoderId) ?? null
      : null,
  );
  const selectedAudioEncoder = $derived.by(() =>
    selectedFile
      ? getAudioEncoderCapability(transcodeStore.capabilities, selectedFile.profile.audio.encoderId) ?? null
      : null,
  );
  const selectedSubtitleEncoder = $derived.by(() =>
    selectedFile
      ? getSubtitleEncoderCapability(transcodeStore.capabilities, selectedFile.profile.subtitles.encoderId) ?? null
      : null,
  );
  const outputPreviewPath = $derived.by(() => selectedFile ? buildTranscodeOutputPath(selectedFile) : '');
  const readyQueueFiles = $derived.by(() => {
    const selectedIds = new Set(outputNamingWorkspace.selectedFiles.map((file) => file.id));
    return transcodeStore.files.filter((file) => file.status === 'ready' && selectedIds.has(file.id));
  });
  const outputConflictCount = $derived.by(() => {
    const selectedWorkspaceFiles = outputNamingWorkspace.files.filter((file) => file.selected);
    return outputNamingWorkspace.getConflicts(selectedWorkspaceFiles).size;
  });
  const activePresetTab = $derived.by(() =>
    transcodeStore.activeTab === 'audio' || transcodeStore.activeTab === 'subtitles'
      ? transcodeStore.activeTab
      : 'video',
  );
  const videoProfileOptions = $derived(selectedVideoEncoder?.supportedProfiles ?? []);
  const videoLevelOptions = $derived(selectedVideoEncoder?.supportedLevels ?? []);
  const videoPixelFormatOptions = $derived(selectedVideoEncoder?.supportedPixelFormats ?? []);
  const videoPresetOptions = $derived.by(() => getVideoPresetOptions(selectedVideoEncoder?.id));
  const metadataTabAvailable = $derived.by(() =>
    selectedFile ? canEditTranscodeMetadata(selectedFile, transcodeStore.capabilities) : false,
  );

  function getExtensionFromPath(path: string): string {
    const normalized = path.toLowerCase();
    const lastDot = normalized.lastIndexOf('.');
    return lastDot >= 0 ? normalized.slice(lastDot) : '';
  }

  function guessHasVideo(path: string): boolean {
    return VIDEO_EXTENSIONS.includes(getExtensionFromPath(path));
  }

  function createPlaceholderFile(path: string): TranscodeFile {
    const name = path.split('/').pop() || path.split('\\').pop() || path;
    const hasVideo = guessHasVideo(path);
    const hasAudio = true;
    const profile = buildDefaultTranscodeProfile(transcodeStore.capabilities, {
      path,
      hasVideo,
      hasAudio,
      tracks: [],
    });

    return {
      id: transcodeStore.generateId(),
      path,
      name,
      size: 0,
      duration: undefined,
      bitrate: undefined,
      format: undefined,
      tracks: [],
      status: 'scanning',
      error: undefined,
      rawData: undefined,
      createdAt: undefined,
      modifiedAt: undefined,
      hasVideo,
      hasAudio,
      profile,
      metadata: buildDefaultTranscodeMetadata({
        tracks: [],
        hasVideo,
        hasAudio,
        profile,
      }, transcodeStore.capabilities),
      analysisFrames: [],
      aiStatus: 'idle',
      aiError: undefined,
      aiRecommendation: undefined,
      lastOutputPath: undefined,
    };
  }

  function resolveTranscodeOutputTargetPath(
    file: RenameFile,
    context: ResolveRenameTargetPathContext,
  ): string {
    const nextExtension = getOutputExtensionForFileId(file.id);
    const preferred = context.buildDefaultPath({ ...file, extension: nextExtension });
    if (preferred !== file.originalPath) {
      return preferred;
    }

    return context.buildDefaultPath({
      ...file,
      extension: nextExtension,
      newName: `${file.newName}_transcoded`,
    });
  }

  function getOutputExtensionForFileId(fileId: string): string {
    const file = transcodeStore.files.find((item) => item.id === fileId);
    if (!file) {
      return '.mp4';
    }

    return getContainerExtension(transcodeStore.capabilities, file.profile.containerId);
  }

  function createTranscodeRenameFile(file: TranscodeFile, existing?: RenameFile): RenameFile {
    const baseName = getBaseName(file.name);
    return {
      id: file.id,
      originalPath: file.path,
      originalName: baseName,
      extension: getOutputExtensionForFileId(file.id),
      newName: existing?.newName ?? baseName,
      selected: existing?.selected ?? true,
      status: 'pending',
      size: file.size,
      modifiedAt: file.modifiedAt,
      createdAt: file.createdAt,
    };
  }

  function buildTranscodeOutputPath(file: TranscodeFile): string {
    const existingNamingFile = outputNamingWorkspace.files.find((item) => item.id === file.id);
    const namingFile = existingNamingFile
      ? { ...existingNamingFile, extension: getOutputExtensionForFileId(file.id) }
      : createTranscodeRenameFile(file);
    return outputNamingWorkspace.getTargetPath(namingFile);
  }

  function updateSelectedProfile(mutator: (profile: TranscodeProfile, file: TranscodeFile) => void): void {
    const file = transcodeStore.selectedFile;
    if (!file) {
      return;
    }

    const nextProfile = cloneTranscodeProfile(file.profile);
    mutator(nextProfile, file);
    transcodeStore.setFileProfile(file.id, nextProfile);
  }

  function updateSelectedContainer(containerId: string): void {
    const file = transcodeStore.selectedFile;
    if (!file) {
      return;
    }

    transcodeStore.setFileContainer(file.id, containerId);
  }

  function handleUpdateMetadata(metadata: TranscodeFile['metadata']): void {
    const file = transcodeStore.selectedFile;
    if (!file) {
      return;
    }

    transcodeStore.setFileMetadata(file.id, metadata);
  }

  function handleResetMetadata(): void {
    const file = transcodeStore.selectedFile;
    if (!file) {
      return;
    }

    transcodeStore.resetFileMetadata(file.id);
  }

  function getPresetTriggerLabel(tab: TranscodePresetTab): string {
    if (tab === 'audio') return 'Audio presets';
    if (tab === 'subtitles') return 'Subtitle presets';
    return 'Video presets';
  }

  function handleSelectFile(fileId: string): void {
    transcodeStore.selectFile(fileId);
  }

  function handleOpenInfo(fileId: string): void {
    infoDialogFileId = fileId;
    infoDialogOpen = true;
  }

  function handleRemoveFile(fileId: string): void {
    if (transcodeStore.isProcessing) {
      toast.info('Remove is disabled while transcoding is running');
      return;
    }

    transcodeStore.removeFile(fileId);
    if (infoDialogFileId === fileId) {
      infoDialogFileId = null;
      infoDialogOpen = false;
    }
  }

  function handleClearAll(): void {
    if (transcodeStore.isProcessing) {
      toast.info('Clear is disabled while transcoding is running');
      return;
    }

    transcodeStore.clearFiles();
    infoDialogOpen = false;
    infoDialogFileId = null;
    toast.info('Cleared all files');
  }

  async function handleSelectOutputDir(): Promise<void> {
    const selected = await pickOutputDirectory();

    if (selected) {
      outputNamingWorkspace.setOutputDir(selected);
    }
  }

  function handleClearOutputDir(): void {
    outputNamingWorkspace.setOutputDir('');
  }

  async function handleAnalyzeAi(scope: 'selected' | 'all'): Promise<void> {
    if (!transcodeStore.capabilities) {
      toast.error('FFmpeg capabilities are not available yet');
      return;
    }

    const files = scope === 'selected'
      ? (selectedFile ? [selectedFile] : [])
      : transcodeStore.files.filter((file) => file.status === 'ready');

    if (files.length === 0) {
      toast.info(scope === 'selected' ? 'Select a file to analyze' : 'No ready files to analyze');
      return;
    }

    isAnalyzingAi = true;
    let completed = 0;
    let failed = 0;

    try {
      for (const file of files) {
        const latestFile = transcodeStore.files.find((item) => item.id === file.id);
        if (!latestFile || latestFile.status !== 'ready') {
          continue;
        }

        transcodeStore.setAiStatus(file.id, 'analyzing', undefined);

        try {
          let analysisFrames = latestFile.analysisFrames;
          const expectedFrameCount = transcodeStore.capabilities.defaultAnalysisFrameCount;
          const needsFrameRefresh = analysisFrames.length === 0
            || analysisFrames.length < expectedFrameCount
            || analysisFrames.some((path) => !path.toLowerCase().endsWith('.png'));

          if (needsFrameRefresh) {
            analysisFrames = await extractTranscodeAnalysisFrames(
              latestFile.path,
              expectedFrameCount,
            );
            transcodeStore.setAnalysisFrames(file.id, analysisFrames);
          }

          const refreshedFile = transcodeStore.files.find((item) => item.id === file.id) ?? {
            ...latestFile,
            analysisFrames,
          };

          const recommendation = await analyzeTranscodeProfile({
            file: refreshedFile,
            capabilities: transcodeStore.capabilities,
            provider: transcodeStore.aiProvider,
            model: transcodeStore.aiModel,
            intent: transcodeStore.aiIntent,
            sizePreference: transcodeStore.aiSizePreference,
            userInstruction: transcodeStore.aiUserPrompt,
          });

          transcodeStore.setAiRecommendation(file.id, recommendation);
          completed += 1;
        } catch (error) {
          failed += 1;
          transcodeStore.setAiStatus(
            file.id,
            'error',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    } finally {
      isAnalyzingAi = false;
    }

    if (completed > 0 && failed > 0) {
      toast.info(`AI analysis finished: ${completed} completed, ${failed} failed`);
    } else if (completed > 0) {
      toast.success(`AI analysis finished for ${completed} file(s)`);
    } else if (failed > 0) {
      toast.error('AI analysis failed for every file');
    }
  }

  function handleApplyCurrentToAll(): void {
    if (!selectedFile) {
      toast.info('Select a file first');
      return;
    }

    transcodeStore.applyProfileToAll(selectedFile.profile);
    toast.success('Applied the selected profile to all files');
  }

  function handleModeChange(value: string): void {
    if (value !== 'ai' && value !== 'advanced') {
      return;
    }

    transcodeStore.setMode(value as TranscodeMode);
  }

  async function handleSavePreset(tab: TranscodePresetTab, name: string): Promise<void> {
    if (!selectedFile) {
      return;
    }

    const data = tab === 'video'
      ? selectedFile.profile.video
      : tab === 'audio'
        ? selectedFile.profile.audio
        : selectedFile.profile.subtitles;

    await transcodeStore.savePreset(tab, name, data);
    toast.success('Preset saved');
  }

  function handleApplyPreset(tab: TranscodePresetTab, presetId: string): void {
    if (!selectedFile) {
      return;
    }

    transcodeStore.applyPreset(selectedFile.id, tab, presetId);
    toast.success('Preset applied');
  }

  async function handleDeletePreset(tab: TranscodePresetTab, presetId: string): Promise<void> {
    if (!selectedFile) {
      return;
    }

    await transcodeStore.deletePreset(tab, presetId);
    toast.success('Preset deleted');
  }

  async function handleCancelFile(fileId: string): Promise<void> {
    if (!transcodeStore.isProcessing) return;
    if (transcodeStore.isCancelling) return;
    if (transcodeStore.runtimeProgress.currentFileId !== fileId) return;

    const file = transcodeStore.files.find((item) => item.id === fileId);
    if (!file) return;

    cancelCurrentFileId = fileId;
    transcodeStore.setCancelling(true);

    try {
      await invoke('cancel_transcode_file', { inputPath: file.path });
      toast.info('Cancelling current file...');
    } catch (error) {
      cancelCurrentFileId = null;
      transcodeStore.setCancelling(false);
      logAndToast.error({
        source: 'ffmpeg',
        title: 'Cancel failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleCancelAll(): Promise<void> {
    if (!transcodeStore.isProcessing) return;
    if (transcodeStore.isCancelling) return;

    cancelAllRequested = true;
    transcodeStore.setCancelling(true);

    try {
      await invoke('cancel_transcode');
      toast.info('Cancelling transcode queue...');
    } catch (error) {
      cancelAllRequested = false;
      transcodeStore.setCancelling(false);
      logAndToast.error({
        source: 'ffmpeg',
        title: 'Cancel failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleStartTranscode(): Promise<void> {
    if (transcodeStore.isProcessing) {
      return;
    }

    const filesToProcess = readyQueueFiles;
    if (filesToProcess.length === 0) {
      toast.warning('No ready files selected for transcoding');
      return;
    }

    if (outputConflictCount > 0) {
      toast.error('Please resolve output naming conflicts before transcoding');
      return;
    }

    if (!transcodeStore.capabilities) {
      toast.error('FFmpeg capabilities are not available yet');
      return;
    }

    for (const file of filesToProcess) {
      const compatibilityIssues = getTranscodeCompatibilityIssues(file, transcodeStore.capabilities);
      if (compatibilityIssues.length > 0) {
        transcodeStore.selectFile(file.id);
        transcodeStore.setActiveTab('subtitles');
        toast.error(`${file.name}: ${compatibilityIssues[0]}`);
        return;
      }

      const outputPath = buildTranscodeOutputPath(file);
      const expectedExtension = getContainerExtension(transcodeStore.capabilities, file.profile.containerId);
      if (getExtensionFromPath(outputPath) !== expectedExtension) {
        transcodeStore.selectFile(file.id);
        transcodeStore.setActiveTab('output');
        toast.error(`${file.name}: output file extension must match the selected container (${expectedExtension}).`);
        return;
      }
    }

    transcodeStore.setStatus('processing');
    transcodeStore.setError(null);
    transcodeStore.startRuntimeProgress(filesToProcess.length);
    transcodeStore.initializeFileRunStates(filesToProcess.map((file) => file.path));
    cancelAllRequested = false;
    cancelCurrentFileId = null;
    transcodeStore.setCancelling(false);

    let completed = 0;
    let cancelled = 0;
    let transcodeError: string | null = null;

    for (const file of filesToProcess) {
      if (cancelAllRequested) {
        break;
      }

      transcodeStore.setFileProcessing(file.path);
      transcodeStore.setCurrentRuntimeFile(file.id, file.path, file.name);

      try {
        const outputPath = buildTranscodeOutputPath(file);
        const result = await transcodeMedia(createTranscodeRequest(file, outputPath));
        completed += 1;
        transcodeStore.setFileCompleted(file.path);
        transcodeStore.updateFile(file.id, {
          lastOutputPath: result,
        });
      } catch (error) {
        if (cancelAllRequested || cancelCurrentFileId === file.id) {
          cancelled += 1;
          transcodeStore.setFileCancelled(file.path);
        } else {
          transcodeError = error instanceof Error ? error.message : String(error);
          transcodeStore.setFileError(file.path, transcodeError);
          break;
        }
      } finally {
        transcodeStore.markRuntimeFileCompleted();

        if (cancelCurrentFileId === file.id) {
          cancelCurrentFileId = null;
          if (!cancelAllRequested) {
            transcodeStore.setCancelling(false);
          }
        }
      }
    }

    if (cancelAllRequested) {
      for (const file of filesToProcess) {
        const runState = transcodeStore.getFileRunState(file.path);
        if (runState.status === 'queued') {
          transcodeStore.setFileCancelled(file.path);
        }
      }
    }

    if (transcodeError) {
      transcodeStore.setError(transcodeError);
      transcodeStore.resetRuntimeProgress();
      logAndToast.error({
        source: 'ffmpeg',
        title: 'Transcode failed',
        details: transcodeError,
      });
    } else if (cancelAllRequested || cancelled > 0) {
      transcodeStore.setStatus('idle');
      transcodeStore.resetRuntimeProgress();
      toast.info(`Transcode finished: ${completed} completed, ${cancelled} cancelled`);
    } else {
      transcodeStore.setStatus('completed');
      toast.success(`Successfully transcoded ${completed} file(s)`);
    }

    cancelAllRequested = false;
    cancelCurrentFileId = null;
    transcodeStore.setCancelling(false);
  }

  async function addFiles(paths: string[]): Promise<void> {
    let added = 0;
    let skipped = 0;
    const scanPaths: string[] = [];
    const fileIdsByPath = new Map<string, string>();

    for (const path of paths) {
      if (transcodeStore.hasFile(path)) {
        skipped += 1;
        continue;
      }

      const placeholder = createPlaceholderFile(path);
      transcodeStore.addFiles([placeholder]);
      scanPaths.push(path);
      fileIdsByPath.set(path, placeholder.id);
    }

    if (scanPaths.length > 0) {
      const [scannedFiles, metadataEntries] = await Promise.all([
        scanFiles(scanPaths, 3),
        Promise.all(scanPaths.map(async (path) => [path, await fetchFileMetadata(path)] as const)),
      ]);
      const metadataByPath = new Map(metadataEntries);

      for (const scanned of scannedFiles) {
        const fileId = fileIdsByPath.get(scanned.path);
        if (!fileId) {
          continue;
        }

        const fileMetadata = metadataByPath.get(scanned.path);
        if (scanned.status === 'error') {
          transcodeStore.updateFile(fileId, {
            status: 'error',
            error: scanned.error,
            size: fileMetadata?.size ?? scanned.size,
            createdAt: fileMetadata?.createdAt,
            modifiedAt: fileMetadata?.modifiedAt,
          });
          continue;
        }

        const hasVideo = fileHasVideo(scanned.rawData);
        const hasAudio = fileHasAudio(scanned.rawData);
        if (!hasVideo && !hasAudio) {
          transcodeStore.updateFile(fileId, {
            status: 'error',
            error: 'This tool supports video or audio-only media files.',
            size: fileMetadata?.size ?? scanned.size,
            createdAt: fileMetadata?.createdAt,
            modifiedAt: fileMetadata?.modifiedAt,
          });
          continue;
        }

        const nextFileData = {
          id: fileId,
          path: scanned.path,
          name: scanned.name,
          size: fileMetadata?.size ?? scanned.size,
          duration: scanned.duration,
          bitrate: scanned.bitrate,
          format: scanned.format,
          tracks: scanned.tracks,
          rawData: scanned.rawData,
          createdAt: fileMetadata?.createdAt,
          modifiedAt: fileMetadata?.modifiedAt,
          hasVideo,
          hasAudio,
        };

        const profile = clampTranscodeProfile(
          buildDefaultTranscodeProfile(transcodeStore.capabilities, nextFileData),
          transcodeStore.capabilities,
          nextFileData,
        );
        const transcodeMetadata = buildDefaultTranscodeMetadata({
          ...nextFileData,
          profile,
        }, transcodeStore.capabilities);

        transcodeStore.updateFile(fileId, {
          ...nextFileData,
          status: 'ready',
          error: undefined,
          profile,
          metadata: transcodeMetadata,
        });
        added += 1;
      }
    }

    if (added > 0 && skipped > 0) {
      toast.success(`Added ${added} file(s), ${skipped} duplicate(s) skipped`);
    } else if (added > 0) {
      toast.success(`Added ${added} file(s)`);
    } else if (skipped > 0) {
      toast.info(`${skipped} file(s) already imported`);
    }
  }

  export async function handleFileDrop(paths: string[]): Promise<void> {
    const supportedPaths = paths.filter((path) => SUPPORTED_EXTENSIONS.includes(getExtensionFromPath(path)));
    if (supportedPaths.length === 0) {
      toast.warning('No supported media files detected');
      return;
    }

    await addFiles(supportedPaths);
  }

  async function handleAddFiles(): Promise<void> {
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Media files',
        extensions: SUPPORTED_EXTENSIONS.map((extension) => extension.slice(1)),
      }],
    });

    if (!selected) {
      return;
    }

    const paths = Array.isArray(selected) ? selected : [selected];
    await addFiles(paths);
  }

  async function initializeView(): Promise<void> {
    await transcodeStore.loadPresets();
    if (isDestroyed) {
      return;
    }

    transcodeStore.setCapabilitiesLoading();

    try {
      const capabilities = await getTranscodeCapabilities();
      if (isDestroyed) {
        return;
      }

      transcodeStore.setCapabilities(capabilities);
    } catch (error) {
      if (isDestroyed) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      transcodeStore.setCapabilitiesError(message);
      logAndToast.error({
        source: 'ffmpeg',
        title: 'Failed to load FFmpeg capabilities',
        details: message,
      });
    }

    if (isDestroyed) {
      return;
    }

    const unlisten = await listen<TranscodeProgressEvent>('media-transcode-progress', (event) => {
      if (!transcodeStore.isProcessing) {
        return;
      }

      const runtime = transcodeStore.runtimeProgress;
      if (!runtime.currentFilePath || runtime.currentFilePath !== event.payload.inputPath) {
        return;
      }

      transcodeStore.updateRuntimeCurrentFile(
        event.payload.progress,
        event.payload.speedBytesPerSec,
      );
      transcodeStore.updateFileRunProgress(
        event.payload.inputPath,
        event.payload.progress,
        event.payload.speedBytesPerSec,
      );
    });

    if (isDestroyed) {
      unlisten();
      return;
    }

    unlistenTranscodeProgress = unlisten;
  }

  onMount(() => {
    void initializeView();
  });

  onDestroy(() => {
    isDestroyed = true;
    unlistenTranscodeProgress?.();
    outputNamingWorkspace.destroy();
    toolHeader.clearHeader('transcode');
  });

  $effect(() => {
    const existingById = untrack(() => new Map(outputNamingWorkspace.files.map((file) => [file.id, file])));
    const nextFiles = transcodeStore.files.map((file) =>
      createTranscodeRenameFile(file, existingById.get(file.id)),
    );

    untrack(() => {
      outputNamingWorkspace.replaceFiles(nextFiles, { preserveSelection: true });
    });
  });

  $effect(() => {
    const headerConfig = {
      title: transcodeInternalView === 'output-naming' ? 'Output Naming' : undefined,
      description: transcodeInternalView === 'output-naming'
        ? 'Review selected outputs and resolve naming conflicts before transcoding.'
        : undefined,
      actions: transcodeHeaderActions,
    };

    toolHeader.setHeader('transcode', headerConfig);

    return () => {
      toolHeader.clearHeader('transcode', headerConfig);
    };
  });
</script>

{#snippet transcodeHeaderActions()}
  {#if transcodeInternalView === 'output-naming'}
    <Button
      variant="outline"
      size="sm"
      class="mr-2"
      onclick={() => transcodeInternalView = 'main'}
    >
      <ArrowLeft class="size-4 mr-2" />
      Back to Transcode
    </Button>
  {:else if selectedFile}
    <ToggleGroup.Root
      type="single"
      value={transcodeStore.mode}
      variant="outline"
      size="sm"
      spacing={0}
      class="border border-border/50 bg-muted/20 p-0.5 shadow-none"
      onValueChange={handleModeChange}
    >
      <ToggleGroup.Item
        value="ai"
        class="border-transparent gap-2 data-[state=on]:border-transparent data-[state=on]:bg-primary/90 data-[state=on]:text-primary-foreground"
      >
        <Wand2 class="size-4" />
        AI
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="advanced"
        class="border-transparent gap-2 data-[state=on]:border-transparent data-[state=on]:bg-primary/90 data-[state=on]:text-primary-foreground"
      >
        <Sparkles class="size-4" />
        Advanced
      </ToggleGroup.Item>
    </ToggleGroup.Root>

    <Button variant="outline" size="sm" onclick={handleApplyCurrentToAll}>
      <Copy class="size-4 mr-2" />
      Apply to All
    </Button>
  {/if}
{/snippet}

{#if transcodeInternalView === 'output-naming'}
  <TranscodeOutputNamingView
    workspace={outputNamingWorkspace}
    outputConflictCount={outputConflictCount}
    onClearAll={handleClearAll}
    onRemoveFile={handleRemoveFile}
    onSelectOutputDir={handleSelectOutputDir}
    onClearOutputDir={handleClearOutputDir}
  />
{:else}
  <div class="h-full flex overflow-hidden">
    <TranscodeFileSidebar
      files={transcodeStore.files}
      selectedFileId={selectedFile?.id ?? null}
      fileRunStates={transcodeStore.fileRunStates}
      isProcessing={transcodeStore.isProcessing}
      currentProcessingFileId={transcodeStore.runtimeProgress.currentFileId}
      supportedFormats={SUPPORTED_FORMATS}
      onSelectFile={handleSelectFile}
      onOpenInfo={handleOpenInfo}
      onRemoveFile={handleRemoveFile}
      onCancelFile={handleCancelFile}
      onAddFiles={handleAddFiles}
      onClearAll={handleClearAll}
    />

    <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
      {#if !selectedFile}
        <TranscodeEmptyState onAddFiles={handleAddFiles} />
      {:else}
        <TranscodeSelectedFileHeader file={selectedFile} />

        <div class="flex-1 min-h-0 overflow-auto p-4 space-y-4">
          {#if transcodeStore.mode === 'ai'}
            <TranscodeAiPanel
              selectedFile={selectedFile}
              provider={transcodeStore.aiProvider}
              model={transcodeStore.aiModel}
              intent={transcodeStore.aiIntent}
              sizePreference={transcodeStore.aiSizePreference}
              userPrompt={transcodeStore.aiUserPrompt}
              isAnalyzing={isAnalyzingAi}
              onProviderChange={(provider) => transcodeStore.setAiProvider(provider)}
              onModelChange={(model) => transcodeStore.setAiModel(model)}
              onIntentChange={(intent) => transcodeStore.setAiIntent(intent)}
              onSizePreferenceChange={(sizePreference) => transcodeStore.setAiSizePreference(sizePreference)}
              onUserPromptChange={(value) => transcodeStore.setAiUserPrompt(value)}
              onNavigateToSettings={onNavigateToSettings}
              onAnalyzeSelected={() => void handleAnalyzeAi('selected')}
              onAnalyzeAll={() => void handleAnalyzeAi('all')}
            />
          {/if}

          <Tabs.Root
            value={transcodeStore.activeTab}
            onValueChange={(value) => transcodeStore.setActiveTab(value as TranscodeTab)}
            class="gap-4"
          >
            <Tabs.List class="w-full">
              <Tabs.Trigger value="video">Video</Tabs.Trigger>
              <Tabs.Trigger value="audio">Audio</Tabs.Trigger>
              <Tabs.Trigger value="subtitles">Subtitles</Tabs.Trigger>
              {#if metadataTabAvailable}
                <Tabs.Trigger value="metadata">Metadata</Tabs.Trigger>
              {/if}
              <Tabs.Trigger value="output">Output</Tabs.Trigger>
            </Tabs.List>

            {#if transcodeStore.activeTab !== 'output' && transcodeStore.activeTab !== 'metadata'}
              <div class="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                <p class="min-w-0 flex-1 text-sm text-muted-foreground">
                  Saved presets for the current <span class="font-medium text-foreground">{activePresetTab}</span> tab.
                </p>
                <Button variant="outline" size="sm" class="shrink-0" onclick={() => presetManagerOpen = true}>
                  <Save class="size-4 mr-2" />
                  {getPresetTriggerLabel(activePresetTab)}
                </Button>
              </div>
            {/if}

            <Tabs.Content value="video" class="space-y-4">
              <TranscodeVideoTab
                file={selectedFile}
                selectedVideoTrack={selectedVideoTrack}
                selectedVideoEncoder={selectedVideoEncoder}
                availableVideoModeOptions={availableVideoModeOptions}
                availableVideoEncoders={availableVideoEncoders}
                videoProfileOptions={videoProfileOptions}
                videoLevelOptions={videoLevelOptions}
                videoPixelFormatOptions={videoPixelFormatOptions}
                videoPresetOptions={videoPresetOptions}
                updateProfile={updateSelectedProfile}
                createId={transcodeStore.generateId}
              />
            </Tabs.Content>

            <Tabs.Content value="audio" class="space-y-4">
              <TranscodeAudioTab
                file={selectedFile}
                audioTracks={selectedAudioTracks}
                selectedAudioTrack={selectedAudioTrack}
                selectedAudioEncoder={selectedAudioEncoder}
                selectedContainer={selectedContainer}
                availableAudioModeOptions={availableAudioModeOptions}
                availableAudioEncoders={availableAudioEncoders}
                updateProfile={updateSelectedProfile}
                createId={transcodeStore.generateId}
              />
            </Tabs.Content>

            <Tabs.Content value="subtitles" class="space-y-4">
              <TranscodeSubtitlesTab
                file={selectedFile}
                selectedSubtitleTracks={selectedSubtitleTracks}
                selectedSubtitleEncoder={selectedSubtitleEncoder}
                availableSubtitleModeOptions={availableSubtitleModeOptions}
                availableSubtitleEncoders={availableSubtitleEncoders}
                updateProfile={updateSelectedProfile}
                createId={transcodeStore.generateId}
              />
            </Tabs.Content>

            {#if metadataTabAvailable}
              <Tabs.Content value="metadata" class="space-y-4">
                <TranscodeMetadataTab
                  file={selectedFile}
                  capabilities={transcodeStore.capabilities}
                  selectedContainer={selectedContainer}
                  isProcessing={transcodeStore.isProcessing}
                  onUpdateMetadata={handleUpdateMetadata}
                  onResetMetadata={handleResetMetadata}
                />
              </Tabs.Content>
            {/if}

            <Tabs.Content value="output" class="space-y-4">
              <TranscodeOutputTab
                file={selectedFile}
                selectedContainer={selectedContainer}
                availableContainers={availableContainers}
                outputPreviewPath={outputPreviewPath}
                workspace={outputNamingWorkspace}
                readyQueueFiles={readyQueueFiles}
                outputConflictCount={outputConflictCount}
                buildOutputPath={buildTranscodeOutputPath}
                updateContainer={updateSelectedContainer}
                onSelectOutputDir={handleSelectOutputDir}
                onClearOutputDir={handleClearOutputDir}
                onOpenRenameWorkspace={() => transcodeInternalView = 'output-naming'}
              />
            </Tabs.Content>
          </Tabs.Root>
        </div>

        <TranscodeQueueBar
          readyCount={readyQueueFiles.length}
          conflictCount={outputConflictCount}
          isProcessing={transcodeStore.isProcessing}
          isCancelling={transcodeStore.isCancelling}
          progress={transcodeStore.progress}
          totalFiles={transcodeStore.runtimeProgress.totalFiles}
          currentSpeedBytesPerSec={transcodeStore.runtimeProgress.currentSpeedBytesPerSec}
          onOpenOutput={() => transcodeStore.setActiveTab('output')}
          onCancelAll={() => void handleCancelAll()}
          onStartTranscode={() => void handleStartTranscode()}
        />
      {/if}
    </div>
  </div>
{/if}

<TranscodePresetDialog
  bind:open={presetManagerOpen}
  tab={activePresetTab}
  selectedFile={selectedFile}
  presets={transcodeStore.getPresets(activePresetTab)}
  onApply={(presetId) => handleApplyPreset(activePresetTab, presetId)}
  onDelete={(presetId) => void handleDeletePreset(activePresetTab, presetId)}
  onSave={(name) => void handleSavePreset(activePresetTab, name)}
/>

<TranscodeInfoDialog bind:open={infoDialogOpen} file={infoDialogFile} />
