<script lang="ts" module>
  export interface AudioToSubsViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { tempDir } from '@tauri-apps/api/path';
  import { open } from '@tauri-apps/plugin-dialog';
  import { mkdir, exists, remove } from '@tauri-apps/plugin-fs';
  import { toast } from 'svelte-sonner';

  import type { AudioFile, AudioTrackInfo, BatchTrackStrategy, DeepgramConfig, TranscriptionVersion } from '$lib/types';
  import type { ImportSourceId } from '$lib/types/tool-import';
  import type { LogSource } from '$lib/stores/logs.svelte';
  import { AUDIO_EXTENSIONS } from '$lib/types';
  import { transcribeWithDeepgram } from '$lib/services/deepgram';
  import { transcribeWithMediaFlow } from '$lib/services/mediaflow-transcription';
  import { scanFile } from '$lib/services/ffprobe';
  import { transcriptionVersionToSubtitleFile } from '$lib/services/subtitle-interop';
  import { loadTranscriptionData, saveTranscriptionData } from '$lib/services/transcription-storage';
  import { audioToSubsStore, settingsStore, toolImportStore } from '$lib/stores';
  import { resolveDeepgramTrackLanguage } from '$lib/utils/audio-language';
  import { logAndToast } from '$lib/utils/log-toast';
  import {
    AudioToSubsDialogs,
    AudioToSubsSidebar,
    AudioToSubsWorkspace,
  } from '$lib/components/audio-to-subs';
  import {
    buildProbedFileUpdate,
    collectResolvedTrackLanguages,
    extractAudioTracks,
    resolveTrackIndex,
    type ProbedAudioFile,
  } from '$lib/components/audio-to-subs/audio-track-utils';

  interface AudioToSubsViewProps {
    onNavigateToSettings?: () => void;
  }

  let { onNavigateToSettings }: AudioToSubsViewProps = $props();

  // Constants
  const MAX_CONCURRENT_TRANSCODES = 3;
  const OPUS_COMPATIBLE_EXTENSIONS = ['opus'];
  const AUDIO_FORMATS = 'MP3, WAV, FLAC, AAC, OGG, M4A, OPUS';
  type TranscriptionLogSource = Extract<LogSource, 'deepgram' | 'mediaflow'>;

  let persistedTranscriptionVersionKeys = $state<Set<string>>(new Set());

  let resultDialogOpen = $state(false);
  let resultDialogFileId = $state<string | null>(null);
  const resultDialogFile = $derived(
    resultDialogFileId
      ? audioToSubsStore.audioFiles.find(f => f.id === resultDialogFileId) ?? null
      : null
  );

  // State for retranscribe dialog
  let retranscribeDialogOpen = $state(false);
  let retranscribeDialogFile = $state<AudioFile | null>(null);
  let removeDialogOpen = $state(false);
  let removeTarget = $state.raw<{ mode: 'single'; fileId: string } | { mode: 'all' } | null>(null);

  // State for track selection dialog
  let trackSelectDialogOpen = $state(false);
  let trackSelectFileName = $state('');
  let trackSelectTracks = $state<AudioTrackInfo[]>([]);
  let trackSelectResolver: ((trackIndex: number | null) => void) | null = null;

  // State for batch track selection dialog
  let batchTrackDialogOpen = $state(false);
  let batchTrackFileCount = $state(0);
  let batchTrackLanguages = $state<string[]>([]);
  let batchTrackResolver: ((strategy: BatchTrackStrategy | null) => void) | null = null;

  // Abort controllers for cancelling transcriptions
  const abortControllers = new Map<string, AbortController>();

  interface LanguageResolutionSuccess {
    ok: true;
    config: DeepgramConfig;
  }

  interface LanguageResolutionFailure {
    ok: false;
    file: AudioFile;
  }

  type LanguageResolutionResult = LanguageResolutionSuccess | LanguageResolutionFailure;

  // Event listener cleanup
  let unlistenTranscodeProgress: UnlistenFn | null = null;

  function buildTranscriptionVersionKey(audioPath: string, versionId: string): string {
    return `${audioPath}::${versionId}`;
  }

  function markPersistedTranscriptionVersions(audioPath: string, versions: TranscriptionVersion[]) {
    if (versions.length === 0) {
      return;
    }

    const next = new Set(persistedTranscriptionVersionKeys);
    for (const version of versions) {
      next.add(buildTranscriptionVersionKey(audioPath, version.id));
    }
    persistedTranscriptionVersionKeys = next;
  }

  function clearPersistedTranscriptionVersionsForPath(audioPath: string) {
    const prefix = `${audioPath}::`;
    const next = new Set(
      Array.from(persistedTranscriptionVersionKeys).filter((key) => !key.startsWith(prefix)),
    );
    persistedTranscriptionVersionKeys = next;
  }

  function unmarkPersistedTranscriptionVersion(audioPath: string, versionId: string) {
    const key = buildTranscriptionVersionKey(audioPath, versionId);
    if (!persistedTranscriptionVersionKeys.has(key)) {
      return;
    }

    const next = new Set(persistedTranscriptionVersionKeys);
    next.delete(key);
    persistedTranscriptionVersionKeys = next;
  }

  function hasAudioFile(fileId: string): boolean {
    return audioToSubsStore.audioFiles.some((file) => file.id === fileId);
  }

  function getAudioFile(fileId: string): AudioFile | undefined {
    return audioToSubsStore.audioFiles.find((file) => file.id === fileId);
  }

  function getTranscriptionLogSource(): TranscriptionLogSource {
    return audioToSubsStore.provider;
  }

  // Helper: Check if file needs transcoding to OPUS
  function needsTranscoding(file: AudioFile): boolean {
    if (file.opusPath) return false; // Already transcoded
    const ext = file.path.split('.').pop()?.toLowerCase() || '';
    return !OPUS_COMPATIBLE_EXTENSIONS.includes(ext);
  }

  // Helper: Generate a stable hash from a string (for cache paths)
  function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // Helper: Get the OPUS output path in temp directory
  // Uses a stable hash of the source path + track index for cache reuse
  async function getOpusOutputPath(file: AudioFile, trackIndex: number = 0): Promise<string> {
    const temp = await tempDir();
    const baseName = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
    const pathHash = hashString(file.path);
    return `${temp}mediaflow_opus/${baseName}_track${trackIndex}_${pathHash}.opus`;
  }

  function resolveTranscriptionConfig(file: AudioFile, baseConfig: DeepgramConfig): LanguageResolutionResult {
    if (audioToSubsStore.provider === 'mediaflow' || baseConfig.language !== 'multi') {
      return {
        ok: true,
        config: baseConfig,
      };
    }

    const resolvedTrackLanguage = resolveDeepgramTrackLanguage(file.audioTrackLanguage);
    if (!resolvedTrackLanguage) {
      return {
        ok: false,
        file,
      };
    }

    return {
      ok: true,
      config: { ...baseConfig, language: resolvedTrackLanguage },
    };
  }

  function collectFilesMissingLanguage(files: AudioFile[], baseConfig: DeepgramConfig): LanguageResolutionFailure[] {
    if (audioToSubsStore.provider === 'mediaflow' || baseConfig.language !== 'multi') {
      return [];
    }

    const missingLanguageFiles: LanguageResolutionFailure[] = [];
    for (const file of files) {
      const result = resolveTranscriptionConfig(file, baseConfig);
      if (!result.ok) {
        missingLanguageFiles.push(result);
      }
    }

    return missingLanguageFiles;
  }

  function formatAffectedFileNames(files: AudioFile[]): string {
    const names = files.map((file) => file.name);
    if (names.length <= 3) {
      return names.join(', ');
    }

    return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  }

  function buildMissingLanguageMessage(files: AudioFile[]): string {
    const hasMultipleFiles = files.length > 1;
    return `${formatAffectedFileNames(files)} ${hasMultipleFiles ? 'do' : 'does'} not have a usable audio language tag. Choose a source language manually in the right panel before transcribing.`;
  }

  function validateTranscriptionTargets(files: AudioFile[], baseConfig: DeepgramConfig): LanguageResolutionFailure[] {
    const missingLanguageFiles = collectFilesMissingLanguage(files, baseConfig);
    if (missingLanguageFiles.length > 0) {
      toast.error(buildMissingLanguageMessage(missingLanguageFiles.map((result) => result.file)));
    }

    return missingLanguageFiles;
  }

  // Helper: Prompt user to select audio track (returns Promise)
  function promptForTrackSelection(fileName: string, tracks: AudioTrackInfo[]): Promise<number | null> {
    trackSelectFileName = fileName;
    trackSelectTracks = tracks;
    trackSelectDialogOpen = true;
    
    return new Promise(resolve => {
      trackSelectResolver = resolve;
    });
  }

  // Handle track selection from dialog
  function handleTrackSelect(trackIndex: number) {
    trackSelectResolver?.(trackIndex);
    trackSelectResolver = null;
    trackSelectDialogOpen = false;
  }

  // Handle track selection dialog cancel
  function handleTrackSelectCancel() {
    trackSelectResolver?.(null);
    trackSelectResolver = null;
    trackSelectDialogOpen = false;
  }

  // Helper: Prompt user for batch track selection strategy (returns Promise)
  function promptForBatchStrategy(fileCount: number, languages: string[]): Promise<BatchTrackStrategy | null> {
    batchTrackFileCount = fileCount;
    batchTrackLanguages = languages;
    batchTrackDialogOpen = true;
    
    return new Promise(resolve => {
      batchTrackResolver = resolve;
    });
  }

  // Handle batch strategy selection from dialog
  function handleBatchStrategySelect(strategy: BatchTrackStrategy) {
    batchTrackResolver?.(strategy);
    batchTrackResolver = null;
    batchTrackDialogOpen = false;
  }

  // Handle batch strategy dialog cancel
  function handleBatchStrategyCancel() {
    batchTrackResolver?.(null);
    batchTrackResolver = null;
    batchTrackDialogOpen = false;
  }

  // Initialize on mount
  onMount(() => {
    let destroyed = false;

    const setup = async () => {
      await settingsStore.load();
      if (destroyed) {
        return;
      }

      // Set up event listener for transcode progress
      const unlisten = await listen<{ progress: number; inputPath: string }>(
        'transcode-progress',
        (event) => {
          const { progress, inputPath } = event.payload;
          // Find file by path and update progress
          const file = audioToSubsStore.audioFiles.find(f => f.path === inputPath);
          if (file) {
            audioToSubsStore.updateTranscodingProgress(file.id, progress);
          }
        }
      );

      if (destroyed) {
        unlisten();
        return;
      }

      unlistenTranscodeProgress = unlisten;
    };

    void setup();

    return () => {
      destroyed = true;
      unlistenTranscodeProgress?.();
      unlistenTranscodeProgress = null;
    };
  });

  // Exposed API for drag & drop
  export async function handleFileDrop(paths: string[]) {
    const audioExtensions = new Set(AUDIO_EXTENSIONS);
    const audioPaths = paths.filter(p => {
      const ext = p.split('.').pop()?.toLowerCase() || '';
      return audioExtensions.has(ext as typeof AUDIO_EXTENSIONS[number]);
    });

    if (audioPaths.length === 0) {
      toast.warning('No audio files found');
      return;
    }

    await addFiles(audioPaths);
  }

  async function handleAddFiles() {
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Audio files',
        extensions: [...AUDIO_EXTENSIONS]
      }]
    });

    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await addFiles(paths);
    }
  }

  async function addFiles(paths: string[]) {
    const newFiles = audioToSubsStore.addFilesFromPaths(paths);
    
    const probedFiles: ProbedAudioFile[] = [];
    
    // Phase 1: Probe all files and collect metadata
    for (const file of newFiles) {
      audioToSubsStore.updateFile(file.id, { status: 'scanning' });
      
      try {
        const probeResult = await scanFile(file.path);
        const audioTracks = extractAudioTracks(probeResult);

        audioToSubsStore.updateFile(file.id, buildProbedFileUpdate(file, probeResult, audioTracks));

        // Load existing transcriptions if any
        const existingData = await loadTranscriptionData(file.path);
        if (existingData && existingData.transcriptionVersions.length > 0) {
          for (const version of existingData.transcriptionVersions) {
            audioToSubsStore.addTranscriptionVersion(file.id, version);
          }
          markPersistedTranscriptionVersions(file.path, existingData.transcriptionVersions);
          if (existingData.opusPath) {
            const opusExists = await exists(existingData.opusPath);
            if (opusExists) {
              audioToSubsStore.updateFile(file.id, { opusPath: existingData.opusPath });
            }
          }
        }

        // Get fresh file data
        const updatedFile = audioToSubsStore.audioFiles.find(f => f.id === file.id);
        if (updatedFile) {
          probedFiles.push({
            file: updatedFile,
            probeResult,
            audioTracks,
            needsTranscoding: needsTranscoding(updatedFile)
          });
        }
      } catch (error) {
        audioToSubsStore.updateFile(file.id, { 
          status: 'error',
          error: error instanceof Error ? error.message : 'Scan failed'
        });
      }
    }
    
    // Phase 2: Identify multi-track files that need transcoding
    const multiTrackFiles = probedFiles.filter(p => p.needsTranscoding && p.audioTracks.length > 1);
    const singleTrackFiles = probedFiles.filter(p => p.needsTranscoding && p.audioTracks.length <= 1);
    
    // Collect all unique languages from multi-track files
    const allLanguages = collectResolvedTrackLanguages(multiTrackFiles);
    
    // Phase 3: Handle track selection
    let batchStrategy: BatchTrackStrategy | null = null;
    
    if (multiTrackFiles.length >= 2) {
      // Show batch dialog for 2+ multi-track files
      batchStrategy = await promptForBatchStrategy(multiTrackFiles.length, allLanguages);
      if (batchStrategy === null) {
        // User cancelled - fallback to first track strategy
        batchStrategy = { type: 'first' };
      }
    }
    
    // Phase 4: Resolve track indices and queue for transcoding
    const filesToTranscode: { file: AudioFile; trackIndex?: number }[] = [];
    
    // Add single-track files (no selection needed)
    for (const pf of singleTrackFiles) {
      filesToTranscode.push({ file: pf.file, trackIndex: 0 });
    }
    
    // Handle multi-track files based on strategy
    if (batchStrategy) {
      if (batchStrategy.type === 'individual') {
        // Use individual selection for each file
        for (const pf of multiTrackFiles) {
          const result = await promptForTrackSelection(pf.file.name, pf.audioTracks);
          // Fallback to first track if cancelled
          const selectedIndex = result ?? 0;
          audioToSubsStore.updateFile(
            pf.file.id,
            buildProbedFileUpdate(pf.file, pf.probeResult, pf.audioTracks, selectedIndex),
          );
          const updatedFile = audioToSubsStore.audioFiles.find(f => f.id === pf.file.id);
          if (updatedFile) {
            filesToTranscode.push({ file: updatedFile, trackIndex: selectedIndex });
          }
        }
      } else {
        // Apply batch strategy to all multi-track files
        for (const pf of multiTrackFiles) {
          const trackIndex = resolveTrackIndex(batchStrategy, pf.audioTracks);
          audioToSubsStore.updateFile(
            pf.file.id,
            buildProbedFileUpdate(pf.file, pf.probeResult, pf.audioTracks, trackIndex),
          );
          const updatedFile = audioToSubsStore.audioFiles.find(f => f.id === pf.file.id);
          if (updatedFile) {
            filesToTranscode.push({ file: updatedFile, trackIndex });
          }
        }
      }
    } else if (multiTrackFiles.length === 1) {
      // Single multi-track file: use individual selection
      const pf = multiTrackFiles[0];
      const result = await promptForTrackSelection(pf.file.name, pf.audioTracks);
      // Fallback to first track if cancelled
      const selectedIndex = result ?? 0;
      audioToSubsStore.updateFile(
        pf.file.id,
        buildProbedFileUpdate(pf.file, pf.probeResult, pf.audioTracks, selectedIndex),
      );
      const updatedFile = audioToSubsStore.audioFiles.find(f => f.id === pf.file.id);
      if (updatedFile) {
        filesToTranscode.push({ file: updatedFile, trackIndex: selectedIndex });
      }
    }
    
    // Phase 5: Start transcoding files in parallel
    const pendingTranscodes = filesToTranscode.filter((item) => hasAudioFile(item.file.id));
    if (pendingTranscodes.length > 0) {
      audioToSubsStore.setTranscodingScope(
        [...new Set(pendingTranscodes.map((item) => item.file.id))]
      );
      try {
        await transcodeFilesInParallel(pendingTranscodes);
      } finally {
        audioToSubsStore.clearTranscodingScope();
      }
    } else {
      audioToSubsStore.clearTranscodingScope();
    }
  }

  // Transcode a single file to OPUS
  async function transcodeFile(file: AudioFile, trackIndex?: number): Promise<boolean> {
    if (!hasAudioFile(file.id)) {
      return false;
    }

    let outputPath: string | undefined;
    const resolvedTrackIndex = trackIndex ?? file.selectedTrackIndex ?? 0;
    
    try {
      outputPath = await getOpusOutputPath(file, resolvedTrackIndex);
      if (!hasAudioFile(file.id)) {
        return false;
      }
      
      // Check if OPUS file already exists (cached from previous transcode)
      const opusExists = await exists(outputPath);
      if (opusExists) {
        if (!hasAudioFile(file.id)) {
          return false;
        }

        // Use cached OPUS file - no need to transcode again
        audioToSubsStore.finishTranscoding(file.id, outputPath);
        
        // Save the opus path to transcription data
        const currentFile = getAudioFile(file.id);
        if (currentFile) {
          await saveTranscriptionData(file.path, {
            version: 1,
            audioPath: file.path,
            opusPath: outputPath,
            transcriptionVersions: currentFile.transcriptionVersions
          });
        }
        
        return true;
      }
      
      // Ensure output directory exists
      const outputDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
      const dirExists = await exists(outputDir);
      if (!dirExists) {
        await mkdir(outputDir, { recursive: true });
      }

      if (!hasAudioFile(file.id)) {
        return false;
      }
      
      audioToSubsStore.startTranscoding(file.id);
      
      const result = await invoke<string>('transcode_to_opus', {
        inputPath: file.path,
        outputPath,
        trackIndex: trackIndex ?? null
      });

      if (!hasAudioFile(file.id)) {
        return false;
      }
      
      audioToSubsStore.finishTranscoding(file.id, result);
      
      // Save the opus path to transcription data
      const currentFile = getAudioFile(file.id);
      if (currentFile) {
        await saveTranscriptionData(file.path, {
          version: 1,
          audioPath: file.path,
          opusPath: result,
          transcriptionVersions: currentFile.transcriptionVersions
        });
      }
      
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const fileStillExists = hasAudioFile(file.id);
      if (fileStillExists) {
        audioToSubsStore.failTranscoding(file.id, errorMsg);
      }
      
      // Clean up partial output file on failure
      if (outputPath) {
        try {
          const partialExists = await exists(outputPath);
          if (partialExists) {
            await remove(outputPath);
          }
        } catch {
          // Ignore cleanup errors
        }
      }

      if (fileStillExists) {
        logAndToast.error({
          source: 'ffmpeg',
          title: `Transcode failed: ${file.name}`,
          details: errorMsg
        });
      }
      return false;
    }
  }

  // Transcode multiple files with concurrency limit
  async function transcodeFilesInParallel(files: { file: AudioFile; trackIndex?: number }[]) {
    const pending = [...files];
    const active: Promise<void>[] = [];
    
    async function processFile(item: { file: AudioFile; trackIndex?: number }) {
      if (!hasAudioFile(item.file.id)) {
        return;
      }

      const latestFile = getAudioFile(item.file.id);
      if (!latestFile) {
        return;
      }

      await transcodeFile(latestFile, item.trackIndex);
    }
    
    while (pending.length > 0 || active.length > 0) {
      // Start new transcodes up to limit
      while (active.length < MAX_CONCURRENT_TRANSCODES && pending.length > 0) {
        const item = pending.shift()!;
        if (!hasAudioFile(item.file.id)) {
          continue;
        }

        const promise = processFile(item).then(() => {
          // Remove from active when done
          const idx = active.indexOf(promise);
          if (idx !== -1) active.splice(idx, 1);
        });
        active.push(promise);
      }
      
      // Wait for at least one to complete
      if (active.length > 0) {
        await Promise.race(active);
      }
    }
  }

  async function handleImportFromSource(sourceId: ImportSourceId) {
    const { paths } = toolImportStore.resolveImport({
      targetTool: 'audio-to-subs',
      sourceId,
    });

    if (paths.length === 0) {
      toast.info('No audio files available from this source');
      return;
    }

    await addFiles(paths);
    toast.success(`${paths.length} audio file(s) imported`);
  }

  async function transcribeFile(file: AudioFile, versionName: string, config: DeepgramConfig, signal?: AbortSignal) {
    audioToSubsStore.updateFile(file.id, { status: 'transcribing', progress: 0 });

    try {
      // Use OPUS path if available, otherwise original path
      const audioPath = file.opusPath || file.path;
      const logSource = getTranscriptionLogSource();
      
      const transcribe = logSource === 'mediaflow'
        ? transcribeWithMediaFlow
        : transcribeWithDeepgram;

      const result = await transcribe({
        audioPath,
        config,
        signal,
        onProgress: (progress, phase) => {
          audioToSubsStore.setFileProgress(file.id, progress);
        }
      });

      if (result.success && result.result) {
        // Create new version
        const version: TranscriptionVersion = {
          id: `v-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          name: versionName,
          createdAt: new Date().toISOString(),
          config,
          result: result.result
        };

        // Add to store
        audioToSubsStore.addTranscriptionVersion(file.id, version);

        // Persist to disk
        const updatedFile = audioToSubsStore.audioFiles.find(f => f.id === file.id);
        if (updatedFile) {
          const saved = await saveTranscriptionData(file.path, {
            version: 1,
            audioPath: file.path,
            opusPath: file.opusPath,
            transcriptionVersions: updatedFile.transcriptionVersions
          });

          if (saved) {
            markPersistedTranscriptionVersions(file.path, [version]);
          } else {
            logAndToast.warning({
              source: logSource,
              title: 'Transcription not persisted',
              details: 'Version is available in memory only for this session',
            });
          }
        }

        logAndToast.success({
          source: logSource,
          title: 'Transcription complete',
          details: `${file.name} - ${versionName}`
        });

        return true;
      } else {
        // Check if cancelled - don't treat as error
        const isCancelled = result.error === 'Transcription cancelled';
        if (isCancelled) {
          // Reset to ready or completed based on whether file has versions
          const hasVersions = (file.transcriptionVersions?.length ?? 0) > 0;
          audioToSubsStore.updateFile(file.id, { 
            status: hasVersions ? 'completed' : 'ready',
            progress: 0 
          });
          return false;
        }
        
        audioToSubsStore.failFile(file.id, result.error || 'Unknown error');
        logAndToast.error({
          source: logSource,
          title: `Failed: ${file.name}`,
          details: result.error || 'Unknown error'
        });
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Transcription failed';
      audioToSubsStore.failFile(file.id, errorMsg);
      logAndToast.error({
        source: getTranscriptionLogSource(),
        title: `Failed: ${file.name}`,
        details: errorMsg
      });
      return false;
    }
  }

  async function handleTranscribeAll() {
    // Include both ready and completed files for re-transcription
    const readyFiles = audioToSubsStore.audioFiles.filter(f => 
      f.status === 'ready' || f.status === 'completed'
    );
    if (readyFiles.length === 0) return;

    if (validateTranscriptionTargets(readyFiles, audioToSubsStore.deepgramConfig).length > 0) {
      return;
    }

    for (const file of readyFiles) {
      audioToSubsStore.updateFile(file.id, {
        status: 'ready',
        progress: 0,
        error: undefined,
      });
    }

    audioToSubsStore.setTranscriptionScope(readyFiles.map((file) => file.id));
    audioToSubsStore.startTranscription();

    let successCount = 0;
    let failCount = 0;
    let cancelledCount = 0;
    let completedCount = 0;
    const totalFiles = readyFiles.length;

    try {
      const maxConcurrent = audioToSubsStore.config.maxConcurrentTranscriptions;

      // Create a queue of files to process (maintain order from the list)
      const queue = [...readyFiles];
      const activePromises = new Map<string, Promise<void>>();

      // Function to process the next file from the queue
      const processNext = async (): Promise<void> => {
        // Check if we should stop
        if (queue.length === 0) return;
        if (activePromises.size >= maxConcurrent) return;
        if (audioToSubsStore.isCancelling) return;

        const file = queue.shift();
        if (!file) return;

        // Check if this file was cancelled before starting
        if (audioToSubsStore.isFileCancelled(file.id)) {
          audioToSubsStore.updateFile(file.id, { status: 'ready' });
          cancelledCount++;
          completedCount++;
          // Process next file immediately
          return processNext();
        }

        // Create abort controller for this file
        const controller = new AbortController();
        abortControllers.set(file.id, controller);

        // Create the transcription promise
        const promise = (async () => {
          const versionName = `Version ${(file.transcriptionVersions?.length ?? 0) + 1}`;

          try {
            const resolution = resolveTranscriptionConfig(file, audioToSubsStore.deepgramConfig);
            if (!resolution.ok) {
              failCount++;
              return;
            }

            const success = await transcribeFile(file, versionName, resolution.config, controller.signal);

            if (success) {
              successCount++;
            } else if (controller.signal.aborted) {
              cancelledCount++;
            } else {
              failCount++;
            }
          } catch (error) {
            console.error(`Transcription error for ${file.name}:`, error);
            failCount++;
          } finally {
            // Clean up controller
            abortControllers.delete(file.id);
            completedCount++;

            // Update progress toast
            toast.info(`Transcription progress: ${completedCount}/${totalFiles} files`);

            // Remove from active promises
            activePromises.delete(file.id);

            // Immediately start next file if available
            if (!audioToSubsStore.isCancelling && queue.length > 0) {
              processNext();
            }
          }
        })();

        activePromises.set(file.id, promise);

        // Start processing immediately (don't await here)
        promise.catch(() => {
          // Errors are handled inside the promise
        });

        // Try to start more files if we haven't reached the limit
        if (activePromises.size < maxConcurrent && queue.length > 0 && !audioToSubsStore.isCancelling) {
          processNext();
        }
      };

      // Start initial batch (up to maxConcurrent files)
      const initialBatchSize = Math.min(maxConcurrent, queue.length);
      for (let i = 0; i < initialBatchSize; i++) {
        processNext();
      }

      // Wait for all active transcriptions to complete
      while (activePromises.size > 0) {
        await Promise.race(activePromises.values());
      }
    } finally {
      // Clean up any remaining controllers
      abortControllers.clear();
      audioToSubsStore.stopTranscription();
    }

    // Show final summary
    if (successCount > 0 || failCount > 0 || cancelledCount > 0) {
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} completed`);
      if (failCount > 0) parts.push(`${failCount} failed`);
      if (cancelledCount > 0) parts.push(`${cancelledCount} cancelled`);
      toast.success(`Transcription finished: ${parts.join(', ')}`);
    }
  }

  async function handleRetranscribe(fileId: string, versionName: string, config: DeepgramConfig): Promise<string | null> {
    const file = audioToSubsStore.audioFiles.find(f => f.id === fileId);
    if (!file) {
      return 'File not found.';
    }

    const resolution = resolveTranscriptionConfig(file, config);
    if (!resolution.ok) {
      const message = buildMissingLanguageMessage([file]);
      toast.error(message);
      return message;
    }

    void (async () => {
      const controller = new AbortController();
      abortControllers.set(fileId, controller);

      audioToSubsStore.updateFile(fileId, {
        status: 'ready',
        progress: 0,
        error: undefined,
      });

      audioToSubsStore.setTranscriptionScope([fileId]);
      audioToSubsStore.startTranscription(fileId);
      try {
        await transcribeFile(file, versionName, resolution.config, controller.signal);
      } finally {
        abortControllers.delete(fileId);
        audioToSubsStore.stopTranscription();
      }
    })();

    return null;
  }

  async function cancelTranscodeAndCleanup(file: AudioFile): Promise<void> {
    // Cancel FFmpeg transcoding for this specific file
    try {
      await invoke('cancel_audio_transcode_file', { inputPath: file.path });
    } catch (error) {
      console.error('Failed to cancel transcode:', error);
    }

    // Delete partial OPUS file
    try {
      const opusPath = await getOpusOutputPath(file, file.selectedTrackIndex ?? 0);
      const opusExists = await exists(opusPath);
      if (opusExists) {
        await remove(opusPath);
      }
    } catch (error) {
      console.error('Failed to delete partial OPUS file:', error);
    }
  }

  function abortTranscriptionFile(fileId: string): void {
    const controller = abortControllers.get(fileId);
    if (!controller) {
      return;
    }

    controller.abort();
    abortControllers.delete(fileId);
  }

  async function cancelActiveFileProcessing(file: AudioFile): Promise<void> {
    if (file.status === 'transcoding') {
      await cancelTranscodeAndCleanup(file);
      audioToSubsStore.failTranscoding(file.id, 'Cancelled');
      return;
    }

    if (file.status === 'transcribing') {
      abortTranscriptionFile(file.id);
      audioToSubsStore.cancelFile(file.id);
    }
  }

  async function cancelAllProcessing(): Promise<void> {
    const hasActiveTranscriptions = audioToSubsStore.isTranscribing || abortControllers.size > 0;

    try {
      await invoke('cancel_audio_transcode');
    } catch (error) {
      console.error('Failed to cancel transcodes:', error);
    }

    for (const fileId of Array.from(abortControllers.keys())) {
      abortTranscriptionFile(fileId);
    }

    audioToSubsStore.clearTranscodingScope();
    if (hasActiveTranscriptions) {
      audioToSubsStore.cancelAll();
    }
  }

  async function handleCancelFile(id: string) {
    const file = getAudioFile(id);
    if (!file) return;

    await cancelActiveFileProcessing(file);
    toast.info('Cancelled');
  }

  async function handleCancelAll() {
    await cancelAllProcessing();
    toast.info('Cancelling all...');
  }

  async function handleRequestRemoveFile(id: string) {
    const file = getAudioFile(id);
    if (!file) {
      return;
    }

    if (file.status !== 'transcoding' && file.status !== 'transcribing') {
      clearPersistedTranscriptionVersionsForPath(file.path);
      audioToSubsStore.removeFile(id);
      return;
    }

    removeTarget = { mode: 'single', fileId: id };
    removeDialogOpen = true;
  }

  function handleRequestRemoveAll() {
    const hasActive = audioToSubsStore.audioFiles.some((file) => file.status === 'transcoding' || file.status === 'transcribing');
    if (!hasActive) {
      persistedTranscriptionVersionKeys = new Set();
      audioToSubsStore.clear();
      return;
    }

    removeTarget = { mode: 'all' };
    removeDialogOpen = true;
  }

  async function handleConfirmRemove() {
    const target = removeTarget;
    if (!target) {
      return;
    }

    removeDialogOpen = false;

    if (target.mode === 'single') {
      const file = getAudioFile(target.fileId);
      if (file) {
        await cancelActiveFileProcessing(file);
        clearPersistedTranscriptionVersionsForPath(file.path);
        audioToSubsStore.removeFile(file.id);
      }
      removeTarget = null;
      return;
    }

    await cancelAllProcessing();
    for (const file of audioToSubsStore.audioFiles) {
      clearPersistedTranscriptionVersionsForPath(file.path);
    }
    persistedTranscriptionVersionKeys = new Set();
    audioToSubsStore.clear();
    removeTarget = null;
  }

  function handleViewResult(file: AudioFile) {
    resultDialogFileId = file.id;
    resultDialogOpen = true;
  }

  function handleRetranscribeRequest(file: AudioFile) {
    retranscribeDialogFile = file;
    retranscribeDialogOpen = true;
  }

  async function handleChangeTrack(file: AudioFile) {
    // Re-probe the file to get audio tracks
    try {
      const probeResult = await scanFile(file.path);
      const audioTracks = extractAudioTracks(probeResult);

      if (audioTracks.length <= 1) {
        toast.info('This file only has one audio track');
        return;
      }

      // Show track selection dialog
      const result = await promptForTrackSelection(file.name, audioTracks);
      if (result === null) {
        // User cancelled - keep current track
        return;
      }

      // Note: We don't delete the old OPUS file - it stays in cache for potential reuse
      // The new track will either use its own cached OPUS or be transcoded fresh

      // Update file metadata with new track info
      audioToSubsStore.updateFile(file.id, {
        ...buildProbedFileUpdate(file, probeResult, audioTracks, result),
        opusPath: undefined,  // Clear the OPUS path
        status: 'ready',
      });

      // Get fresh file data and start transcoding
      const freshFile = audioToSubsStore.audioFiles.find(f => f.id === file.id);
      if (freshFile && needsTranscoding(freshFile)) {
        await transcodeFile(freshFile, result);
      }

      toast.success(`Switched to track ${result + 1}`);
    } catch (error) {
      console.error('Failed to change track:', error);
      toast.error('Failed to change audio track');
    }
  }

  async function handleDeleteVersion(fileId: string, versionId: string) {
    audioToSubsStore.removeTranscriptionVersion(fileId, versionId);
    
    // Persist changes to disk
    const file = audioToSubsStore.audioFiles.find(f => f.id === fileId);
    if (file) {
      const saved = await saveTranscriptionData(file.path, {
        version: 1,
        audioPath: file.path,
        opusPath: file.opusPath,
        transcriptionVersions: file.transcriptionVersions
      });

      if (!saved) {
        logAndToast.warning({
          source: getTranscriptionLogSource(),
          title: 'Version removal not persisted',
          details: 'Disk sync failed, but version was removed from current session',
        });
      }

      unmarkPersistedTranscriptionVersion(file.path, versionId);
    }
  }

  $effect(() => {
    const versionedItems = audioToSubsStore.audioFiles.flatMap((file) =>
      file.transcriptionVersions.map((version) => ({
        key: `audio-to-subs:${file.path}:${version.id}`,
        name: `${file.name} - ${version.name}`,
        kind: 'subtitle' as const,
        createdAt: Date.parse(version.createdAt) || Date.now(),
        mediaPath: file.path,
        mediaName: file.name,
        versionId: version.id,
        versionName: version.name,
        versionCreatedAt: version.createdAt,
        persisted: persistedTranscriptionVersionKeys.has(buildTranscriptionVersionKey(file.path, version.id))
          ? 'mediaflow' as const
          : 'memory' as const,
        subtitleFile: transcriptionVersionToSubtitleFile(file.path, file.name, version),
      })),
    );

    toolImportStore.publishVersionedSource(
      'audio_to_subs_versions',
      'audio-to-subs',
      'Audio to Subs',
      versionedItems,
    );
  });

  const apiKeyConfigured = $derived(
    audioToSubsStore.provider === 'mediaflow'
      ? settingsStore.hasMediaFlowSession()
      : settingsStore.hasDeepgramApiKey()
  );
  const audioFiles = $derived(audioToSubsStore.audioFiles);
  const selectedFile = $derived(audioToSubsStore.selectedFile);
  const totalFilesCount = $derived(audioFiles.length);
  const readyFilesCount = $derived(audioFiles.filter((file) => file.status === 'ready').length);
  const completedFilesCount = $derived(audioToSubsStore.completedFiles.length);
  const transcodingCount = $derived(audioToSubsStore.transcodingFiles.length);
  const invalidAutoLanguageFiles = $derived.by(() =>
    collectFilesMissingLanguage(audioToSubsStore.readyFiles, audioToSubsStore.deepgramConfig).map(
      (result) => result.file.name,
    )
  );
</script>

<div class="h-full flex overflow-hidden">
  <AudioToSubsSidebar
    files={audioFiles}
    selectedId={audioToSubsStore.selectedFileId}
    isTranscribing={audioToSubsStore.isTranscribing}
    audioFormats={AUDIO_FORMATS}
    onBrowse={handleAddFiles}
    onImportFromSource={handleImportFromSource}
    onCancelAll={handleCancelAll}
    onClearAll={handleRequestRemoveAll}
    onSelectFile={(id) => audioToSubsStore.selectFile(id)}
    onRemoveFile={handleRequestRemoveFile}
    onCancelFile={handleCancelFile}
    onViewResult={handleViewResult}
    onRetry={handleRetranscribeRequest}
  />

  <AudioToSubsWorkspace
    file={selectedFile}
    config={audioToSubsStore.config}
    {apiKeyConfigured}
    isTranscribing={audioToSubsStore.isTranscribing}
    isTranscoding={audioToSubsStore.isTranscoding}
    {readyFilesCount}
    {completedFilesCount}
    {totalFilesCount}
    {transcodingCount}
    {invalidAutoLanguageFiles}
    onChangeTrack={handleChangeTrack}
    onProviderChange={(provider) => audioToSubsStore.setTranscriptionProvider(provider)}
    onDeepgramConfigChange={(updates) => audioToSubsStore.updateDeepgramConfig(updates)}
    onMaxConcurrentChange={(value) => audioToSubsStore.setMaxConcurrentTranscriptions(value)}
    onTranscribeAll={handleTranscribeAll}
    {onNavigateToSettings}
  />
</div>

<AudioToSubsDialogs
  bind:resultDialogOpen
  resultDialogFile={resultDialogFile}
  bind:retranscribeDialogOpen
  retranscribeDialogFile={retranscribeDialogFile}
  deepgramConfig={audioToSubsStore.deepgramConfig}
  bind:trackSelectDialogOpen
  {trackSelectTracks}
  trackSelectFileName={trackSelectFileName}
  bind:batchTrackDialogOpen
  batchTrackFileCount={batchTrackFileCount}
  batchTrackLanguages={batchTrackLanguages}
  bind:removeDialogOpen
  {removeTarget}
  onDeleteVersion={handleDeleteVersion}
  onRetranscribeConfirm={handleRetranscribe}
  onTrackSelect={handleTrackSelect}
  onTrackSelectCancel={handleTrackSelectCancel}
  onBatchStrategySelect={handleBatchStrategySelect}
  onBatchStrategyCancel={handleBatchStrategyCancel}
  onConfirmRemove={handleConfirmRemove}
  onRemoveDialogOpenChange={(open) => {
    removeDialogOpen = open;
    if (!open) {
      removeTarget = null;
    }
  }}
/>
