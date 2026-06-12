import { invoke } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';

import type {
  OcrConfig,
  OcrPipelineResult,
  OcrRawFrame,
  OcrRetryMode,
  OcrSubtitle,
  OcrVideoFile,
  OcrVersion,
  VideoOcrSelection,
} from '$lib/types';
import { DEFAULT_OCR_WORKER_COUNT } from '$lib/types';
import type { OcrSubtitleLike } from '$lib/utils';
import { videoOcrStore } from '$lib/stores';
import { cleanupOcrSubtitlesWithAi } from '$lib/services/ocr-ai-cleanup';
import { createOcrVersion, resolveOcrVersionRawFrameRate } from '$lib/services/ocr-storage';
import {
  analyzeOcrSubtitles,
  formatOcrSubtitleAnalysis,
  normalizeOcrRawFrames,
  normalizeOcrSubtitles,
  toRustOcrFrames,
} from '$lib/utils';
import { logAndToast } from '$lib/utils/log-toast';
import { getRetryRawSource } from './ocr-version-state';

export interface ProcessVideoOcrFileOptions {
  file: OcrVideoFile;
  operationId: string;
  versionName: string;
  mode: OcrRetryMode;
  config: OcrConfig;
  aiCleanupControllers: Map<string, AbortController>;
  getFreshFile: (fileId: string) => OcrVideoFile | undefined;
  persistFileData: (fileId: string) => Promise<boolean>;
  markPersistedVersions: (videoPath: string, versions: OcrVersion[]) => void;
  suppressFallbackToast?: boolean;
}

export interface ProcessVideoOcrFileResult {
  success: boolean;
  effectiveMode: OcrRetryMode;
}

export interface VideoOcrFileSummary {
  startTargets: OcrVideoFile[];
  retryTargets: OcrVideoFile[];
  retryAllMissingRawCount: number;
  scanningCount: number;
  transcodingCount: number;
}

export function isOcrActiveStatus(status: OcrVideoFile['status']): boolean {
  return ['transcoding', 'extracting_frames', 'ocr_processing', 'generating_subs'].includes(status);
}

export function getLatestRawVersion(file: OcrVideoFile): OcrVersion | null {
  for (let i = file.ocrVersions.length - 1; i >= 0; i -= 1) {
    const version = file.ocrVersions[i];
    if (version.rawOcr.length > 0) {
      return version;
    }
  }

  return null;
}

export function getPreferredRawVersion(file: OcrVideoFile): OcrVersion | null {
  return getRetryRawSource(file);
}

export function willRetryFallbackToFullPipeline(file: OcrVideoFile, mode: OcrRetryMode): boolean {
  return mode !== 'full_pipeline' && !getPreferredRawVersion(file);
}

export function canRunOcrRetryMode(file: OcrVideoFile, mode: OcrRetryMode): boolean {
  return !willRetryFallbackToFullPipeline(file, mode);
}

export function summarizeOcrFiles(files: OcrVideoFile[]): VideoOcrFileSummary {
  const startTargets: OcrVideoFile[] = [];
  const retryTargets: OcrVideoFile[] = [];
  let retryAllMissingRawCount = 0;
  let scanningCount = 0;
  let transcodingCount = 0;

  for (const file of files) {
    if (file.status === 'ready') {
      startTargets.push(file);
    }

    if (file.status === 'scanning') {
      scanningCount += 1;
    }

    if (file.status === 'transcoding') {
      transcodingCount += 1;
    }

    const isRetryableStatus = file.status !== 'scanning' && !isOcrActiveStatus(file.status);
    if (file.ocrVersions.length > 0 && isRetryableStatus) {
      retryTargets.push(file);
      if (!getPreferredRawVersion(file)) {
        retryAllMissingRawCount += 1;
      }
    }
  }

  return {
    startTargets,
    retryTargets,
    retryAllMissingRawCount,
    scanningCount,
    transcodingCount,
  };
}

function formatFrameRate(frameRate: number): string {
  return Number.isInteger(frameRate)
    ? `${frameRate}`
    : frameRate.toFixed(2).replace(/\.?0+$/, '');
}

function buildCleanupOptions(config: OcrConfig, disableCleanup: boolean) {
  if (disableCleanup) {
    return {
      mergeSimilar: false,
      similarityThreshold: config.similarityThreshold,
      maxGapMs: 0,
      minCueDurationMs: 0,
      filterUrlLike: false,
    };
  }

  return {
    mergeSimilar: config.mergeSimilar,
    similarityThreshold: config.similarityThreshold,
    maxGapMs: config.maxGapMs,
    minCueDurationMs: config.minCueDurationMs,
    filterUrlLike: config.filterUrlLike,
  };
}

function normalizeRuntimeConfig(config: OcrConfig): OcrConfig {
  return {
    ...config,
    threadCount: DEFAULT_OCR_WORKER_COUNT,
  };
}

function logPipelineTimings(fileId: string, timings: OcrPipelineResult['timings']): void {
  videoOcrStore.addLog(
    'info',
    `Pipeline timings: extract ${timings.extractMs}ms, OCR ${timings.ocrMs}ms, subtitles ${timings.subtitleMs}ms, total ${timings.totalMs}ms`,
    fileId,
  );
}

function logPipelineTelemetry(fileId: string, result: OcrPipelineResult, rawOcr: OcrRawFrame[]): void {
  const { telemetry } = result;
  videoOcrStore.addLog('info', `Extracted ${result.frameCount} frames`, fileId);
  videoOcrStore.addLog(
    'info',
    `OCR attempted ${telemetry.ocrAttemptedFrames}/${telemetry.extractedFrames} frames (${telemetry.textFrames} with text, ${telemetry.unchangedSkippedFrames} unchanged skipped, ${telemetry.noTextSkippedFrames} low-detail skipped)`,
    fileId,
  );
  videoOcrStore.addLog(
    'info',
    `OCR workers: ${telemetry.effectiveWorkers}, engine threads: ${telemetry.engineThreads}, raw frames kept: ${rawOcr.length}`,
    fileId,
  );
}

async function runAiCleanup(
  fileId: string,
  subtitles: OcrSubtitle[],
  config: OcrConfig,
  aiCleanupControllers: Map<string, AbortController>,
): Promise<OcrSubtitle[]> {
  const controller = new AbortController();
  aiCleanupControllers.set(fileId, controller);
  videoOcrStore.addLog('info', 'Running AI subtitle cleanup...', fileId);

  try {
    const cleanupResult = await cleanupOcrSubtitlesWithAi(subtitles, {
      provider: config.aiCleanupProvider,
      model: config.aiCleanupModel,
      maxGapMs: config.maxGapMs,
      signal: controller.signal,
    });

    if (cleanupResult.cancelled || controller.signal.aborted || videoOcrStore.isFileCancelled(fileId)) {
      throw new Error('OCR cancelled');
    }

    if (cleanupResult.success) {
      if (cleanupResult.error) {
        videoOcrStore.addLog(
          'warning',
          `AI cleanup partially applied: ${cleanupResult.error}`,
          fileId,
        );
      }

      videoOcrStore.addLog(
        'info',
        `AI cleanup completed (${cleanupResult.batchesProcessed}/${cleanupResult.totalBatches} batches, ${subtitles.length} -> ${cleanupResult.subtitles.length} subtitles)`,
        fileId,
      );
      return cleanupResult.subtitles;
    }

    videoOcrStore.addLog(
      'warning',
      `AI cleanup failed, using non-AI subtitles: ${cleanupResult.error ?? 'Unknown error'}`,
      fileId,
    );
    return subtitles;
  } finally {
    aiCleanupControllers.delete(fileId);
  }
}

async function runFromRaw(
  file: OcrVideoFile,
  operationId: string,
  rawOcr: OcrRawFrame[],
  mode: OcrRetryMode,
  config: OcrConfig,
  aiCleanupControllers: Map<string, AbortController>,
  rawFrameRate: number = config.frameRate,
): Promise<OcrSubtitle[]> {
  const disableCleanup = mode === 'ai_only';
  const shouldRunAi = mode === 'cleanup_and_ai'
    || mode === 'ai_only'
    || (mode === 'full_pipeline' && config.aiCleanupEnabled);

  videoOcrStore.setFileStatus(file.id, 'generating_subs');
  videoOcrStore.setPhase(file.id, 'generating', 0, 1);

  const rawSubtitles = await invoke<OcrSubtitleLike[]>('generate_subtitles_from_ocr', {
    fileId: file.id,
    operationId,
    frameResults: toRustOcrFrames(rawOcr),
    fps: rawFrameRate,
    minConfidence: config.confidenceThreshold,
    cleanup: buildCleanupOptions(config, disableCleanup),
  });

  const subtitles = normalizeOcrSubtitles(rawSubtitles);
  if (rawSubtitles.length > 0 && subtitles.length === 0) {
    throw new Error('Failed to parse OCR subtitle timing data');
  }

  if (subtitles.length !== rawSubtitles.length) {
    videoOcrStore.addLog(
      'warning',
      `Dropped ${rawSubtitles.length - subtitles.length} subtitle(s) with invalid timing`,
      file.id,
    );
  }

  return shouldRunAi
    ? runAiCleanup(file.id, subtitles, config, aiCleanupControllers)
    : subtitles;
}

async function runFullPipeline(
  file: OcrVideoFile,
  operationId: string,
  config: OcrConfig,
  getFreshFile: (fileId: string) => OcrVideoFile | undefined,
  aiCleanupControllers: Map<string, AbortController>,
  selectionSnapshot: VideoOcrSelection,
): Promise<{ rawOcr: OcrRawFrame[]; finalSubtitles: OcrSubtitle[] }> {
  const current = getFreshFile(file.id) ?? file;

  videoOcrStore.setFileStatus(file.id, 'extracting_frames');
  videoOcrStore.setPhase(file.id, 'extracting', 0, 100);

  const pipelineResult = await invoke<OcrPipelineResult>('run_ocr_pipeline', {
    videoPath: current.path,
    fileId: file.id,
    operationId,
    language: config.language,
    fps: config.frameRate,
    useGpu: config.useGpu,
    numWorkers: config.threadCount,
    minConfidence: config.confidenceThreshold,
    cleanup: buildCleanupOptions(config, false),
    selection: selectionSnapshot,
  });

  const rawOcr = normalizeOcrRawFrames(pipelineResult.rawOcr);
  const subtitles = normalizeOcrSubtitles(pipelineResult.subtitles);
  if (pipelineResult.subtitles.length > 0 && subtitles.length === 0) {
    throw new Error('Failed to parse OCR subtitle timing data');
  }

  if (subtitles.length !== pipelineResult.subtitles.length) {
    videoOcrStore.addLog(
      'warning',
      `Dropped ${pipelineResult.subtitles.length - subtitles.length} subtitle(s) with invalid timing`,
      file.id,
    );
  }

  logPipelineTelemetry(file.id, pipelineResult, rawOcr);
  logPipelineTimings(file.id, pipelineResult.timings);

  return {
    rawOcr,
    finalSubtitles: config.aiCleanupEnabled
      ? await runAiCleanup(file.id, subtitles, config, aiCleanupControllers)
      : subtitles,
  };
}

export async function processVideoOcrFile({
  file,
  operationId,
  versionName,
  mode,
  config,
  aiCleanupControllers,
  getFreshFile,
  persistFileData,
  markPersistedVersions,
  suppressFallbackToast = false,
}: ProcessVideoOcrFileOptions): Promise<ProcessVideoOcrFileResult> {
  let effectiveMode = mode;
  let rawSource: OcrRawFrame[] = [];
  const runtimeConfig = normalizeRuntimeConfig(config);
  let rawFrameRate = runtimeConfig.frameRate;

  const freshFile = getFreshFile(file.id) ?? file;
  const selectionSnapshot = videoOcrStore.getActiveOcrSelection(file.id);
  if (mode !== 'full_pipeline') {
    const sourceVersion = getPreferredRawVersion(freshFile);
    if (!sourceVersion) {
      effectiveMode = 'full_pipeline';
      videoOcrStore.addLog('warning', 'Raw OCR not found. Falling back to full pipeline.', file.id);
      if (!suppressFallbackToast) {
        toast.info('Raw OCR not found for partial retry. Running full pipeline.');
      }
    } else {
      rawSource = sourceVersion.rawOcr;
      rawFrameRate = resolveOcrVersionRawFrameRate(sourceVersion, runtimeConfig.frameRate);
    }
  }

  try {
    let rawOcr: OcrRawFrame[];
    let finalSubtitles: OcrSubtitle[];

    if (effectiveMode === 'full_pipeline') {
      const result = await runFullPipeline(
        file,
        operationId,
        runtimeConfig,
        getFreshFile,
        aiCleanupControllers,
        selectionSnapshot,
      );
      rawOcr = result.rawOcr;
      finalSubtitles = result.finalSubtitles;
      rawFrameRate = runtimeConfig.frameRate;
    } else {
      rawOcr = rawSource;
      videoOcrStore.addLog(
        'info',
        `Partial retry reuses original raw OCR timing (${formatFrameRate(rawFrameRate)} fps)`,
        file.id,
      );
      finalSubtitles = await runFromRaw(
        file,
        operationId,
        rawOcr,
        effectiveMode,
        runtimeConfig,
        aiCleanupControllers,
        rawFrameRate,
      );
    }

    const version = createOcrVersion(
      versionName,
      effectiveMode,
      runtimeConfig,
      rawOcr,
      finalSubtitles,
      rawFrameRate,
      selectionSnapshot,
    );

    videoOcrStore.addOcrVersion(file.id, version);
    const saved = await persistFileData(file.id);
    if (!saved) {
      videoOcrStore.addLog('warning', 'Failed to persist OCR version to .mediaflow.json file', file.id);
    } else {
      markPersistedVersions(file.path, [version]);
    }

    videoOcrStore.addLog('info', `Generated ${finalSubtitles.length} subtitles`, file.id);
    videoOcrStore.addLog('info', formatOcrSubtitleAnalysis(analyzeOcrSubtitles(finalSubtitles)), file.id);

    return { success: true, effectiveMode };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'OCR failed';
    const cancelled = videoOcrStore.isFileCancelled(file.id) || errorMsg.toLowerCase().includes('cancel');

    if (cancelled) {
      const latestFile = getFreshFile(file.id);
      videoOcrStore.updateFile(file.id, {
        status: (latestFile?.ocrVersions.length ?? 0) > 0 ? 'completed' : 'ready',
        progress: undefined,
        error: undefined,
      });
    } else {
      videoOcrStore.failFile(file.id, errorMsg);
      logAndToast.error({
        source: 'system',
        title: `OCR failed: ${file.name}`,
        details: errorMsg,
      });
    }

    return { success: false, effectiveMode };
  }
}
