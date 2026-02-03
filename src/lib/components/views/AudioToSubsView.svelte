<script lang="ts" module>
  import { Trash2, Upload, Download, X } from '@lucide/svelte';
  export interface AudioToSubsViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { tempDir } from '@tauri-apps/api/path';
  import { mkdir, exists, remove } from '@tauri-apps/plugin-fs';
  import { toast } from 'svelte-sonner';

  import type { AudioFile, DeepgramConfig, TranscriptionVersion, AudioTrackInfo, BatchTrackStrategy } from '$lib/types';
  import { AUDIO_EXTENSIONS } from '$lib/types';
  import { audioToSubsStore, settingsStore } from '$lib/stores';
  import { recentFilesStore } from '$lib/stores/recentFiles.svelte';
  import { transcribeWithDeepgram } from '$lib/services/deepgram';
  import { 
    saveTranscriptionData, 
    loadTranscriptionData 
  } from '$lib/services/transcription-storage';
  import { logAndToast } from '$lib/utils/log-toast';
  import { scanFile } from '$lib/services/ffprobe';

  import { Button } from '$lib/components/ui/button';
  import { 
    AudioDropZone, 
    AudioFileList, 
    AudioDetails,
    TranscriptionPanel,
    TranscriptionResultDialog,
    RetranscribeDialog,
    AudioTrackSelectDialog,
    BatchTrackSelectDialog
  } from '$lib/components/audio-to-subs';
  
  ;
  ;
  ;
  ;

  interface AudioToSubsViewProps {
    onNavigateToSettings?: () => void;
  }

  let { onNavigateToSettings }: AudioToSubsViewProps = $props();

  // Constants
  const MAX_CONCURRENT_TRANSCODES = 3;
  const OPUS_COMPATIBLE_EXTENSIONS = ['opus'];

  // State for result dialog
  let resultDialogOpen = $state(false);
  let resultDialogFile = $state<AudioFile | null>(null);

  // State for retranscribe dialog
  let retranscribeDialogOpen = $state(false);
  let retranscribeDialogFile = $state<AudioFile | null>(null);

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

  // Event listener cleanup
  let unlistenTranscodeProgress: UnlistenFn | null = null;

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
    return `${temp}rsextractor_opus/${baseName}_track${trackIndex}_${pathHash}.opus`;
  }

  // Helper: Get effective Deepgram config with language from track metadata
  // Priority: 1) User explicit choice (not 'multi'), 2) Track metadata, 3) 'multi' (auto)
  function getEffectiveConfig(file: AudioFile, baseConfig: DeepgramConfig): DeepgramConfig {
    // If user explicitly chose a language (not 'multi'), respect their choice
    if (baseConfig.language !== 'multi') {
      return baseConfig;
    }
    // If track has language metadata, use it
    if (file.audioTrackLanguage) {
      const trackLang = file.audioTrackLanguage.toLowerCase();
      // Handle common language code variations (e.g., 'jpn' -> 'ja', 'eng' -> 'en')
      const langMap: Record<string, string> = {
        'jpn': 'ja', 'jap': 'ja', 'japanese': 'ja',
        'eng': 'en', 'english': 'en',
        'fra': 'fr', 'fre': 'fr', 'french': 'fr',
        'deu': 'de', 'ger': 'de', 'german': 'de',
        'spa': 'es', 'spanish': 'es',
        'ita': 'it', 'italian': 'it',
        'por': 'pt', 'portuguese': 'pt',
        'rus': 'ru', 'russian': 'ru',
        'zho': 'zh', 'chi': 'zh', 'chinese': 'zh',
        'kor': 'ko', 'korean': 'ko',
        'ara': 'ar', 'arabic': 'ar',
        'hin': 'hi', 'hindi': 'hi',
        'tur': 'tr', 'turkish': 'tr',
        'vie': 'vi', 'vietnamese': 'vi',
        'tha': 'th', 'thai': 'th',
        'ind': 'id', 'indonesian': 'id',
        'msa': 'ms', 'malay': 'ms',
        'nld': 'nl', 'dut': 'nl', 'dutch': 'nl',
        'pol': 'pl', 'polish': 'pl',
        'ukr': 'uk', 'ukrainian': 'uk',
        'swe': 'sv', 'swedish': 'sv',
        'dan': 'da', 'danish': 'da',
        'nor': 'no', 'norwegian': 'no',
        'fin': 'fi', 'finnish': 'fi',
        'ces': 'cs', 'cze': 'cs', 'czech': 'cs',
        'slk': 'sk', 'slo': 'sk', 'slovak': 'sk',
        'hun': 'hu', 'hungarian': 'hu',
        'ron': 'ro', 'rum': 'ro', 'romanian': 'ro',
        'bul': 'bg', 'bulgarian': 'bg',
        'ell': 'el', 'gre': 'el', 'greek': 'el',
        'heb': 'he', 'hebrew': 'he',
        'fas': 'fa', 'per': 'fa', 'persian': 'fa',
        'tam': 'ta', 'tamil': 'ta',
        'tel': 'te', 'telugu': 'te',
        'ben': 'bn', 'bengali': 'bn',
        'cat': 'ca', 'catalan': 'ca',
      };
      const normalizedLang = langMap[trackLang] || trackLang;
      return { ...baseConfig, language: normalizedLang };
    }
    // Fallback to 'multi' (auto-detection)
    return baseConfig;
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

  // Apply batch strategy to resolve track index for a file
  function resolveTrackIndex(
    strategy: BatchTrackStrategy,
    tracks: AudioTrackInfo[]
  ): number {
    switch (strategy.type) {
      case 'default': {
        const defaultTrack = tracks.find(t => t.isDefault);
        return defaultTrack?.index ?? 0;
      }
      case 'language': {
        const langTrack = tracks.find(t => 
          t.language?.toLowerCase() === strategy.language.toLowerCase()
        );
        return langTrack?.index ?? 0;
      }
      case 'first':
        return 0;
      case 'index':
        return Math.min(strategy.index, tracks.length - 1);
      case 'individual':
      default:
        // This should not be called for 'individual' strategy
        return 0;
    }
  }

  // Initialize on mount
  onMount(async () => {
    await settingsStore.load();
    
    // Set up event listener for transcode progress
    unlistenTranscodeProgress = await listen<{ progress: number; inputPath: string }>(
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
  });

  // Cleanup on destroy
  onDestroy(() => {
    unlistenTranscodeProgress?.();
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
    
    // Type for tracking file probe results
    interface ProbedFile {
      file: AudioFile;
      probeResult: Awaited<ReturnType<typeof scanFile>>;
      audioTracks: AudioTrackInfo[];
      needsTranscoding: boolean;
    }
    
    const probedFiles: ProbedFile[] = [];
    
    // Phase 1: Probe all files and collect metadata
    for (const file of newFiles) {
      audioToSubsStore.updateFile(file.id, { status: 'scanning' });
      
      try {
        const probeResult = await scanFile(file.path);
        const audioTracks: AudioTrackInfo[] = probeResult.tracks
          .filter((t: { type: string }) => t.type === 'audio')
          .map((t, idx) => ({
            index: idx,
            codec: t.codec || 'unknown',
            channels: t.channels ?? 2,
            sampleRate: t.sampleRate ?? 48000,
            bitrate: t.bitrate,
            language: t.language,
            title: t.title,
            isDefault: t.default
          }));
        
        const firstTrack = audioTracks[0];
        
        // Initial update with first track info
        audioToSubsStore.updateFile(file.id, { 
          duration: probeResult.duration,
          format: firstTrack?.codec,
          channels: firstTrack?.channels,
          sampleRate: firstTrack?.sampleRate,
          bitrate: firstTrack?.bitrate || probeResult.bitrate,
          size: firstTrack?.bitrate && probeResult.duration 
            ? Math.round((firstTrack.bitrate * probeResult.duration) / 8)
            : probeResult.size || file.size,
          status: 'ready',
          selectedTrackIndex: 0,
          audioTrackLanguage: firstTrack?.language,
          audioTrackTitle: firstTrack?.title,
          audioTrackCount: audioTracks.length
        });

        // Load existing transcriptions if any
        const existingData = await loadTranscriptionData(file.path);
        if (existingData && existingData.transcriptionVersions.length > 0) {
          for (const version of existingData.transcriptionVersions) {
            audioToSubsStore.addTranscriptionVersion(file.id, version);
          }
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
    const allLanguages = new Set<string>();
    for (const pf of multiTrackFiles) {
      for (const track of pf.audioTracks) {
        if (track.language) {
          allLanguages.add(track.language.toLowerCase());
        }
      }
    }
    
    // Phase 3: Handle track selection
    let batchStrategy: BatchTrackStrategy | null = null;
    
    if (multiTrackFiles.length >= 2) {
      // Show batch dialog for 2+ multi-track files
      batchStrategy = await promptForBatchStrategy(multiTrackFiles.length, Array.from(allLanguages));
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
          const selectedTrack = pf.audioTracks[selectedIndex];
          if (selectedTrack) {
            audioToSubsStore.updateFile(pf.file.id, {
              format: selectedTrack.codec,
              channels: selectedTrack.channels,
              sampleRate: selectedTrack.sampleRate,
              bitrate: selectedTrack.bitrate || pf.probeResult.bitrate,
              size: selectedTrack.bitrate && pf.probeResult.duration
                ? Math.round((selectedTrack.bitrate * pf.probeResult.duration) / 8)
                : pf.probeResult.size || pf.file.size,
              selectedTrackIndex: selectedIndex,
              audioTrackLanguage: selectedTrack.language,
              audioTrackTitle: selectedTrack.title
            });
          }
          const updatedFile = audioToSubsStore.audioFiles.find(f => f.id === pf.file.id);
          if (updatedFile) {
            filesToTranscode.push({ file: updatedFile, trackIndex: selectedIndex });
          }
        }
      } else {
        // Apply batch strategy to all multi-track files
        for (const pf of multiTrackFiles) {
          const trackIndex = resolveTrackIndex(batchStrategy, pf.audioTracks);
          const selectedTrack = pf.audioTracks[trackIndex];
          
          if (selectedTrack) {
            audioToSubsStore.updateFile(pf.file.id, {
              format: selectedTrack.codec,
              channels: selectedTrack.channels,
              sampleRate: selectedTrack.sampleRate,
              bitrate: selectedTrack.bitrate || pf.probeResult.bitrate,
              size: selectedTrack.bitrate && pf.probeResult.duration
                ? Math.round((selectedTrack.bitrate * pf.probeResult.duration) / 8)
                : pf.probeResult.size || pf.file.size,
              selectedTrackIndex: trackIndex,
              audioTrackLanguage: selectedTrack.language,
              audioTrackTitle: selectedTrack.title
            });
          }
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
      const selectedTrack = pf.audioTracks[selectedIndex];
      if (selectedTrack) {
        audioToSubsStore.updateFile(pf.file.id, {
          format: selectedTrack.codec,
          channels: selectedTrack.channels,
          sampleRate: selectedTrack.sampleRate,
          bitrate: selectedTrack.bitrate || pf.probeResult.bitrate,
          size: selectedTrack.bitrate && pf.probeResult.duration
            ? Math.round((selectedTrack.bitrate * pf.probeResult.duration) / 8)
            : pf.probeResult.size || pf.file.size,
          selectedTrackIndex: selectedIndex,
          audioTrackLanguage: selectedTrack.language,
          audioTrackTitle: selectedTrack.title
        });
      }
      const updatedFile = audioToSubsStore.audioFiles.find(f => f.id === pf.file.id);
      if (updatedFile) {
        filesToTranscode.push({ file: updatedFile, trackIndex: selectedIndex });
      }
    }
    
    // Phase 5: Start transcoding files in parallel
    if (filesToTranscode.length > 0) {
      await transcodeFilesInParallel(filesToTranscode);
    }
  }

  // Transcode a single file to OPUS
  async function transcodeFile(file: AudioFile, trackIndex?: number): Promise<boolean> {
    let outputPath: string | undefined;
    const resolvedTrackIndex = trackIndex ?? file.selectedTrackIndex ?? 0;
    
    try {
      outputPath = await getOpusOutputPath(file, resolvedTrackIndex);
      
      // Check if OPUS file already exists (cached from previous transcode)
      const opusExists = await exists(outputPath);
      if (opusExists) {
        // Use cached OPUS file - no need to transcode again
        audioToSubsStore.finishTranscoding(file.id, outputPath);
        
        // Save the opus path to transcription data
        const currentFile = audioToSubsStore.audioFiles.find(f => f.id === file.id);
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
      
      audioToSubsStore.startTranscoding(file.id);
      
      const result = await invoke<string>('transcode_to_opus', {
        inputPath: file.path,
        outputPath,
        trackIndex: trackIndex ?? null
      });
      
      audioToSubsStore.finishTranscoding(file.id, result);
      
      // Save the opus path to transcription data
      const currentFile = audioToSubsStore.audioFiles.find(f => f.id === file.id);
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
      audioToSubsStore.failTranscoding(file.id, errorMsg);
      
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
      
      logAndToast.error({
        source: 'ffmpeg',
        title: `Transcode failed: ${file.name}`,
        details: errorMsg
      });
      return false;
    }
  }

  // Transcode multiple files with concurrency limit
  async function transcodeFilesInParallel(files: { file: AudioFile; trackIndex?: number }[]) {
    const pending = [...files];
    const active: Promise<void>[] = [];
    const activeFileIds = new Set<string>();
    
    async function processFile(item: { file: AudioFile; trackIndex?: number }) {
      activeFileIds.add(item.file.id);
      await transcodeFile(item.file, item.trackIndex);
      activeFileIds.delete(item.file.id);
    }
    
    while (pending.length > 0 || active.length > 0) {
      // Start new transcodes up to limit
      while (active.length < MAX_CONCURRENT_TRANSCODES && pending.length > 0) {
        const item = pending.shift()!;
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

  async function handleImportFromExtraction() {
    const audioFiles = recentFilesStore.extractedFiles.filter(f => {
      const ext = f.path.split('.').pop()?.toLowerCase() || '';
      return AUDIO_EXTENSIONS.includes(ext as typeof AUDIO_EXTENSIONS[number]);
    });

    if (audioFiles.length === 0) {
      toast.info('No audio files in recent extractions');
      return;
    }

    await addFiles(audioFiles.map(f => f.path));
    toast.success(`${audioFiles.length} audio file(s) imported`);
  }

  async function transcribeFile(file: AudioFile, versionName: string, config: DeepgramConfig, signal?: AbortSignal) {
    audioToSubsStore.updateFile(file.id, { status: 'transcribing', progress: 0 });

    try {
      // Use OPUS path if available, otherwise original path
      const audioPath = file.opusPath || file.path;
      
      const result = await transcribeWithDeepgram({
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
          await saveTranscriptionData(file.path, {
            version: 1,
            audioPath: file.path,
            opusPath: file.opusPath,
            transcriptionVersions: updatedFile.transcriptionVersions
          });
        }

        logAndToast.success({
          source: 'deepgram',
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
          source: 'deepgram',
          title: `Failed: ${file.name}`,
          details: result.error || 'Unknown error'
        });
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Transcription failed';
      audioToSubsStore.failFile(file.id, errorMsg);
      logAndToast.error({
        source: 'deepgram',
        title: `Failed: ${file.name}`,
        details: errorMsg
      });
      return false;
    }
  }

  async function handleTranscribeAll() {
    const readyFiles = audioToSubsStore.readyFiles.filter(f => f.status === 'ready');
    if (readyFiles.length === 0) return;

    audioToSubsStore.startTranscription();

    let successCount = 0;
    let failCount = 0;
    let cancelledCount = 0;

    for (const file of readyFiles) {
      if (audioToSubsStore.isCancelling || audioToSubsStore.isFileCancelled(file.id)) {
        // Abort this file's controller if it exists
        const controller = abortControllers.get(file.id);
        if (controller) {
          controller.abort();
          abortControllers.delete(file.id);
        }
        audioToSubsStore.updateFile(file.id, { status: 'ready' });
        cancelledCount++;
        continue;
      }

      // Create abort controller for this file
      const controller = new AbortController();
      abortControllers.set(file.id, controller);

      const versionName = `Version ${(file.transcriptionVersions?.length ?? 0) + 1}`;
      const effectiveConfig = getEffectiveConfig(file, audioToSubsStore.deepgramConfig);
      const success = await transcribeFile(file, versionName, effectiveConfig, controller.signal);
      
      // Clean up controller
      abortControllers.delete(file.id);
      
      if (success) {
        successCount++;
      } else if (controller.signal.aborted) {
        cancelledCount++;
      } else {
        failCount++;
      }
    }

    // Clean up any remaining controllers
    abortControllers.clear();
    
    audioToSubsStore.stopTranscription();
    
    if (successCount > 0 || failCount > 0 || cancelledCount > 0) {
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} completed`);
      if (failCount > 0) parts.push(`${failCount} failed`);
      if (cancelledCount > 0) parts.push(`${cancelledCount} cancelled`);
      toast.info(`Transcription finished: ${parts.join(', ')}`);
    }
  }

  async function handleRetranscribe(fileId: string, versionName: string, config: DeepgramConfig) {
    const file = audioToSubsStore.audioFiles.find(f => f.id === fileId);
    if (!file) return;

    // Create abort controller for this file
    const controller = new AbortController();
    abortControllers.set(fileId, controller);

    audioToSubsStore.startTranscription(fileId);
    const effectiveConfig = getEffectiveConfig(file, config);
    await transcribeFile(file, versionName, effectiveConfig, controller.signal);
    
    // Clean up controller
    abortControllers.delete(fileId);
    
    audioToSubsStore.stopTranscription();
  }

  async function handleCancelFile(id: string) {
    const file = audioToSubsStore.audioFiles.find(f => f.id === id);
    if (!file) return;

    if (file.status === 'transcoding') {
      // Cancel FFmpeg transcoding for this specific file
      try {
        await invoke('cancel_transcode_file', { inputPath: file.path });
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
      
      audioToSubsStore.failTranscoding(id, 'Cancelled');
    } else if (file.status === 'transcribing') {
      // Abort the fetch request for this file
      const controller = abortControllers.get(id);
      if (controller) {
        controller.abort();
        abortControllers.delete(id);
      }
      audioToSubsStore.cancelFile(id);
    }
    
    toast.info('Cancelled');
  }

  async function handleCancelAll() {
    // Cancel all ongoing transcodes
    try {
      await invoke('cancel_transcode');
    } catch (error) {
      console.error('Failed to cancel transcodes:', error);
    }
    
    // Abort all pending fetch requests
    for (const [, controller] of abortControllers) {
      controller.abort();
    }
    abortControllers.clear();
    
    audioToSubsStore.cancelAll();
    toast.info('Cancelling all...');
  }

  function handleViewResult(file: AudioFile) {
    resultDialogFile = file;
    resultDialogOpen = true;
  }

  function handleRetranscribeRequest(file: AudioFile) {
    retranscribeDialogFile = file;
    retranscribeDialogOpen = true;
  }

  async function handleRetryFile(file: AudioFile) {
    // Reset the file status
    audioToSubsStore.updateFile(file.id, { status: 'ready', error: undefined });
    
    // Get fresh file data from store
    const freshFile = audioToSubsStore.audioFiles.find(f => f.id === file.id);
    if (!freshFile) return;
    
    // Check if transcoding is needed first (e.g., OPUS file missing or never transcoded)
    if (needsTranscoding(freshFile)) {
      await transcodeFile(freshFile, freshFile.selectedTrackIndex);
      // After transcoding (success or failure), file status is already updated
      // User can manually click "Transcribe" to start transcription
    }
    // If transcoding not needed, file is already in 'ready' status
    // User can manually click "Transcribe" to start transcription
  }

  async function handleChangeTrack(file: AudioFile) {
    // Re-probe the file to get audio tracks
    try {
      const probeResult = await scanFile(file.path);
      const audioTracks: AudioTrackInfo[] = probeResult.tracks
        .filter((t: { type: string }) => t.type === 'audio')
        .map((t, idx) => ({
          index: idx,
          codec: t.codec || 'unknown',
          channels: t.channels ?? 2,
          sampleRate: t.sampleRate ?? 48000,
          bitrate: t.bitrate,
          language: t.language,
          title: t.title,
          isDefault: t.default
        }));

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

      const selectedTrack = audioTracks[result];
      if (!selectedTrack) return;

      // Note: We don't delete the old OPUS file - it stays in cache for potential reuse
      // The new track will either use its own cached OPUS or be transcoded fresh

      // Update file metadata with new track info
      audioToSubsStore.updateFile(file.id, {
        format: selectedTrack.codec,
        channels: selectedTrack.channels,
        sampleRate: selectedTrack.sampleRate,
        bitrate: selectedTrack.bitrate || file.bitrate,
        size: selectedTrack.bitrate && file.duration
          ? Math.round((selectedTrack.bitrate * file.duration) / 8)
          : file.size,
        selectedTrackIndex: result,
        audioTrackLanguage: selectedTrack.language,
        audioTrackTitle: selectedTrack.title,
        opusPath: undefined,  // Clear the OPUS path
        status: 'ready'
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

  function handleDeleteVersion(fileId: string, versionId: string) {
    audioToSubsStore.removeTranscriptionVersion(fileId, versionId);
    
    // Persist changes to disk
    const file = audioToSubsStore.audioFiles.find(f => f.id === fileId);
    if (file) {
      saveTranscriptionData(file.path, {
        version: 1,
        audioPath: file.path,
        opusPath: file.opusPath,
        transcriptionVersions: file.transcriptionVersions
      });
    }
  }

  async function handleOpenOutputFolder() {
    if (audioToSubsStore.outputDir) {
      await invoke('open_folder', { path: audioToSubsStore.outputDir });
    }
  }

  const hasExtractedAudioFiles = $derived(
    recentFilesStore.extractedFiles.some(f => {
      const ext = f.path.split('.').pop()?.toLowerCase() || '';
      return AUDIO_EXTENSIONS.includes(ext as typeof AUDIO_EXTENSIONS[number]);
    })
  );

  const apiKeyConfigured = $derived(settingsStore.hasDeepgramApiKey());
  const transcodingCount = $derived(audioToSubsStore.transcodingFiles.length);
  
  // Check if all files have completed transcription (no pending, ready, transcribing, or error)
  const allFilesCompleted = $derived(
    audioToSubsStore.audioFiles.length > 0 &&
    audioToSubsStore.audioFiles.every(f => f.status === 'completed')
  );
</script>

<div class="h-full flex overflow-hidden">
  <!-- Left Panel: File List -->
  <div class="w-[max(20rem,25vw)] max-w-[32rem] border-r flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="p-3 border-b shrink-0 flex items-center justify-between">
      <h2 class="font-semibold">Audio Files ({audioToSubsStore.audioFiles.length})</h2>
      <div class="flex items-center gap-1">
        {#if audioToSubsStore.isTranscribing}
          <Button
            variant="destructive"
            size="sm"
            onclick={handleCancelAll}
            title="Cancel all transcriptions"
          >
            <X class="size-4 mr-1" />
            Cancel
          </Button>
        {:else}
          {#if audioToSubsStore.audioFiles.length > 0}
            <Button
              variant="ghost"
              size="icon-sm"
              onclick={audioToSubsStore.clear}
              class="text-muted-foreground hover:text-destructive"
            >
              <Trash2 class="size-4" />
              <span class="sr-only">Clear list</span>
            </Button>
          {/if}
          <Button size="sm" onclick={handleAddFiles}>
            <Upload class="size-4 mr-1" />
            Add
          </Button>
        {/if}
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 min-h-0 overflow-auto p-2">
      {#if audioToSubsStore.audioFiles.length === 0}
        <AudioDropZone disabled={audioToSubsStore.isTranscribing} />
      {:else}
        <AudioFileList
          files={audioToSubsStore.audioFiles}
          selectedId={audioToSubsStore.selectedFileId}
          onSelect={(id) => audioToSubsStore.selectFile(id)}
          onRemove={(id) => audioToSubsStore.removeFile(id)}
          onCancel={handleCancelFile}
          onViewResult={handleViewResult}
          onRetranscribe={handleRetranscribeRequest}
          onRetry={handleRetryFile}
          disabled={audioToSubsStore.isTranscribing}
        />
      {/if}
    </div>

    <!-- Import from Extraction -->
    {#if hasExtractedAudioFiles}
      <div class="p-2 border-t shrink-0">
        <Button
          variant="outline"
          size="sm"
          class="w-full"
          onclick={handleImportFromExtraction}
          disabled={audioToSubsStore.isTranscribing}
        >
          <Download class="size-4 mr-2" />
          Import from Extraction
        </Button>
      </div>
    {/if}
  </div>

  <!-- Center Panel: File Details -->
  <div class="flex-1 flex flex-col overflow-hidden">
    <AudioDetails 
      file={audioToSubsStore.selectedFile}
      showWaveform={true}
      onChangeTrack={handleChangeTrack}
    />
  </div>

  <!-- Right Panel: Transcription Config -->
  <div class="w-80 border-l overflow-hidden flex flex-col">
    <div class="flex-1 overflow-auto">
      <TranscriptionPanel
        config={audioToSubsStore.config}
        {apiKeyConfigured}
        isTranscribing={audioToSubsStore.isTranscribing}
        isTranscoding={audioToSubsStore.isTranscoding}
        readyFilesCount={audioToSubsStore.readyFiles.filter(f => f.status === 'ready').length}
        completedFilesCount={audioToSubsStore.completedFiles.length}
        totalFilesCount={audioToSubsStore.audioFiles.length}
        {transcodingCount}
        completedFiles={audioToSubsStore.completedFiles}
        {allFilesCompleted}
        onDeepgramConfigChange={(updates) => audioToSubsStore.updateDeepgramConfig(updates)}
        onTranscribeAll={handleTranscribeAll}
        {onNavigateToSettings}
      />
    </div>
  </div>
</div>

<!-- Result Dialog -->
<TranscriptionResultDialog
  bind:open={resultDialogOpen}
  onOpenChange={(v) => { resultDialogOpen = v; }}
  file={resultDialogFile}
  onDeleteVersion={handleDeleteVersion}
/>

<!-- Retranscribe Dialog -->
<RetranscribeDialog
  bind:open={retranscribeDialogOpen}
  onOpenChange={(v) => { retranscribeDialogOpen = v; }}
  file={retranscribeDialogFile}
  onConfirm={handleRetranscribe}
/>

<!-- Audio Track Selection Dialog -->
<AudioTrackSelectDialog
  bind:open={trackSelectDialogOpen}
  onOpenChange={(open) => {
    if (!open) handleTrackSelectCancel();
  }}
  tracks={trackSelectTracks}
  fileName={trackSelectFileName}
  onSelect={handleTrackSelect}
/>

<!-- Batch Track Selection Dialog -->
<BatchTrackSelectDialog
  bind:open={batchTrackDialogOpen}
  onOpenChange={(open) => {
    if (!open) handleBatchStrategyCancel();
  }}
  fileCount={batchTrackFileCount}
  availableLanguages={batchTrackLanguages}
  onSelect={handleBatchStrategySelect}
  onCancel={handleBatchStrategyCancel}
/>
