import { LazyStore } from '@tauri-apps/plugin-store';

import {
  buildDefaultTranscodeMetadata,
  canEditTranscodeMetadata,
  clampTranscodeProfile,
  cloneAudioSettings,
  cloneSubtitleSettings,
  cloneTranscodeMetadata,
  cloneTranscodeProfile,
  cloneVideoSettings,
  createTranscodeId,
  normalizeTranscodeMetadata,
  normalizeProfileForContainerChange,
  normalizeProfileForProfileChange,
  stripAudioTrackOverrides,
} from '$lib/services/transcode';
import type {
  FileRunState,
  LLMProvider,
  TranscodeAiIntent,
  TranscodeAiSizePreference,
  TranscodeCapabilities,
  TranscodeFile,
  TranscodeMode,
  TranscodePreset,
  TranscodePresetTab,
  TranscodeProfile,
  TranscodeProgressMetrics,
  TranscodeRuntimeProgress,
  TranscodeTab,
  TranscodeAudioSettings,
  TranscodeMetadata,
  TranscodeSubtitleSettings,
  TranscodeVideoSettings,
} from '$lib/types';
import { getDefaultLLMModel, getDefaultLLMProvider, normalizeLLMSelection } from '$lib/types';

interface TranscodePresetState {
  video: TranscodePreset<TranscodeVideoSettings>[];
  audio: TranscodePreset<TranscodeAudioSettings>[];
  subtitles: TranscodePreset<TranscodeSubtitleSettings>[];
}

type TranscodeStoreStatus = 'idle' | 'processing' | 'completed' | 'error';
type CapabilitiesStatus = 'idle' | 'loading' | 'ready' | 'error';

const DEFAULT_PROVIDER = getDefaultLLMProvider();
const DEFAULT_MODEL = getDefaultLLMModel(DEFAULT_PROVIDER);

let files = $state<TranscodeFile[]>([]);
let selectedFileId = $state<string | null>(null);
let capabilities = $state<TranscodeCapabilities | null>(null);
let capabilitiesStatus = $state<CapabilitiesStatus>('idle');
let capabilitiesError = $state<string | null>(null);
let mode = $state<TranscodeMode>('advanced');
let activeTab = $state<TranscodeTab>('video');
let aiProvider = $state<LLMProvider>(DEFAULT_PROVIDER);
let aiModel = $state<string>(DEFAULT_MODEL);
let aiIntent = $state<TranscodeAiIntent>('quality');
let aiSizePreference = $state<TranscodeAiSizePreference>('balanced');
let aiUserPrompt = $state('');
let fileRunStates = $state<Map<string, FileRunState>>(new Map());
let runtimeProgress = $state<TranscodeRuntimeProgress>({
  totalFiles: 0,
  completedFiles: 0,
  currentFileId: null,
  currentFilePath: null,
  currentFileName: '',
  currentFileProgress: 0,
  currentSpeedBytesPerSec: undefined,
  currentFrame: undefined,
  totalFrames: undefined,
  framesPerSecond: undefined,
});
let status = $state<TranscodeStoreStatus>('idle');
let progress = $state(0);
let error = $state<string | null>(null);
let isCancelling = $state(false);
let presets = $state<TranscodePresetState>({
  video: [],
  audio: [],
  subtitles: [],
});
let presetsLoaded = $state(false);

const presetsStore = new LazyStore('transcode-presets.json');

function clonePresetData<TData extends TranscodeVideoSettings | TranscodeAudioSettings | TranscodeSubtitleSettings>(
  tab: TranscodePresetTab,
  data: TData,
): TData {
  switch (tab) {
    case 'video':
      return cloneVideoSettings(data as TranscodeVideoSettings) as TData;
    case 'audio':
      return stripAudioTrackOverrides(data as TranscodeAudioSettings) as TData;
    case 'subtitles':
      return cloneSubtitleSettings(data as TranscodeSubtitleSettings) as TData;
  }
}

function getDefaultFileRunState(): FileRunState {
  return {
    status: 'idle',
    progress: 0,
    speedBytesPerSec: undefined,
    error: undefined,
  };
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function computeOverallProgress(value: TranscodeRuntimeProgress): number {
  if (value.totalFiles <= 0) {
    return 0;
  }

  const doneUnits = value.completedFiles + (clampPercentage(value.currentFileProgress) / 100);
  return clampPercentage((doneUnits / value.totalFiles) * 100);
}

function resetRuntimeProgressState(): TranscodeRuntimeProgress {
  return {
    totalFiles: 0,
    completedFiles: 0,
    currentFileId: null,
    currentFilePath: null,
    currentFileName: '',
    currentFileProgress: 0,
    currentSpeedBytesPerSec: undefined,
    currentFrame: undefined,
    totalFrames: undefined,
    framesPerSecond: undefined,
  };
}

function normalizePositiveMetric(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeNonNegativeMetric(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function loadPresetsFromStore(): Promise<void> {
  if (presetsLoaded) return;

  try {
    const saved = await presetsStore.get<string>('presets');
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<TranscodePresetState>;
      presets = {
        video: parsed.video ?? [],
        audio: parsed.audio ?? [],
        subtitles: parsed.subtitles ?? [],
      };
    }
    presetsLoaded = true;
  } catch (storeError) {
    console.error('Failed to load transcode presets from store:', storeError);
    presets = {
      video: [],
      audio: [],
      subtitles: [],
    };
    presetsLoaded = true;
  }
}

async function savePresetsToStore(): Promise<void> {
  if (!presetsLoaded) return;

  try {
    await presetsStore.set('presets', JSON.stringify(presets));
    await presetsStore.save();
  } catch (storeError) {
    console.error('Failed to save transcode presets to store:', storeError);
  }
}

function updateFileInternal(fileId: string, updates: Partial<TranscodeFile>): void {
  files = files.map((file) => (file.id === fileId ? { ...file, ...updates } : file));
}

function setFileRunState(filePath: string, updates: Partial<FileRunState>): void {
  const current = fileRunStates.get(filePath) ?? getDefaultFileRunState();
  fileRunStates = new Map(fileRunStates);
  fileRunStates.set(filePath, { ...current, ...updates });
}

function normalizeProfileChange(file: TranscodeFile, profile: TranscodeProfile): TranscodeProfile {
  return normalizeProfileForProfileChange(profile, capabilities, file);
}

function normalizeContainerChange(file: TranscodeFile, containerId: string): TranscodeProfile {
  return normalizeProfileForContainerChange(file.profile, containerId, capabilities, file);
}

function getSelectedFile(): TranscodeFile | undefined {
  return files.find((file) => file.id === selectedFileId);
}

function normalizeActiveTabForFile(file: TranscodeFile | undefined): void {
  if (activeTab === 'metadata' && file && !canEditTranscodeMetadata(file, capabilities)) {
    activeTab = 'audio';
  }
}

function normalizeActiveTabForSelectedFile(): void {
  normalizeActiveTabForFile(getSelectedFile());
}

function resolveActiveTab(nextTab: TranscodeTab): TranscodeTab {
  const selectedFile = getSelectedFile();
  return nextTab === 'metadata' && selectedFile && !canEditTranscodeMetadata(selectedFile, capabilities)
    ? 'audio'
    : nextTab;
}

export const transcodeStore = {
  get files() {
    return files;
  },

  get selectedFileId() {
    return selectedFileId;
  },

  get selectedFile(): TranscodeFile | undefined {
    return getSelectedFile();
  },

  get hasFiles(): boolean {
    return files.length > 0;
  },

  get readyFiles(): TranscodeFile[] {
    return files.filter((file) => file.status === 'ready');
  },

  get capabilities() {
    return capabilities;
  },

  get capabilitiesStatus() {
    return capabilitiesStatus;
  },

  get capabilitiesError() {
    return capabilitiesError;
  },

  get mode() {
    return mode;
  },

  get activeTab() {
    return activeTab;
  },

  get aiProvider() {
    return aiProvider;
  },

  get aiModel() {
    return aiModel;
  },

  get aiIntent() {
    return aiIntent;
  },

  get aiSizePreference() {
    return aiSizePreference;
  },

  get aiUserPrompt() {
    return aiUserPrompt;
  },

  get status() {
    return status;
  },

  get progress() {
    return progress;
  },

  get error() {
    return error;
  },

  get isProcessing(): boolean {
    return status === 'processing';
  },

  get isCancelling() {
    return isCancelling;
  },

  get fileRunStates() {
    return fileRunStates;
  },

  get runtimeProgress() {
    return runtimeProgress;
  },

  get presets() {
    return presets;
  },

  generateId(prefix: string = 'transcode-file'): string {
    return createTranscodeId(prefix);
  },

  hasFile(path: string): boolean {
    return files.some((file) => file.path === path);
  },

  setMode(nextMode: TranscodeMode) {
    mode = nextMode;
  },

  setActiveTab(nextTab: TranscodeTab) {
    activeTab = resolveActiveTab(nextTab);
  },

  setAiProvider(provider: LLMProvider) {
    const selection = normalizeLLMSelection(provider, '');
    aiProvider = selection.provider;
    aiModel = selection.model;
  },

  setAiModel(model: string) {
    const selection = normalizeLLMSelection(aiProvider, model);
    aiProvider = selection.provider;
    aiModel = selection.model;
  },

  setAiIntent(intent: TranscodeAiIntent) {
    aiIntent = intent;
  },

  setAiSizePreference(sizePreference: TranscodeAiSizePreference) {
    aiSizePreference = sizePreference;
  },

  setAiUserPrompt(nextPrompt: string) {
    aiUserPrompt = nextPrompt;
  },

  setCapabilitiesLoading() {
    capabilitiesStatus = 'loading';
    capabilitiesError = null;
  },

  setCapabilities(nextCapabilities: TranscodeCapabilities) {
    capabilities = nextCapabilities;
    capabilitiesStatus = 'ready';
    capabilitiesError = null;
    files = files.map((file) => {
      const profile = clampTranscodeProfile(file.profile, nextCapabilities, file);
      const fileWithProfile = { ...file, profile };
      return {
        ...file,
        profile,
        metadata: normalizeTranscodeMetadata(file.metadata, fileWithProfile, nextCapabilities),
      };
    });
    normalizeActiveTabForSelectedFile();
  },

  setCapabilitiesError(nextError: string) {
    capabilitiesStatus = 'error';
    capabilitiesError = nextError;
  },

  addFiles(newFiles: TranscodeFile[]) {
    const existingPaths = new Set(files.map((file) => file.path));
    const uniqueFiles = newFiles.filter((file) => !existingPaths.has(file.path));
    if (uniqueFiles.length === 0) {
      return;
    }

    files = [...files, ...uniqueFiles];
    if (!selectedFileId) {
      selectedFileId = uniqueFiles[0]?.id ?? null;
    }
    normalizeActiveTabForSelectedFile();
  },

  updateFile(fileId: string, updates: Partial<TranscodeFile>) {
    updateFileInternal(fileId, updates);
    if (fileId === selectedFileId) {
      normalizeActiveTabForSelectedFile();
    }
  },

  setFileProfile(fileId: string, profile: TranscodeProfile) {
    const file = files.find((item) => item.id === fileId);
    if (!file) return;

    const nextProfile = normalizeProfileChange(file, profile);
    const fileWithProfile = { ...file, profile: nextProfile };

    updateFileInternal(fileId, {
      profile: nextProfile,
      metadata: normalizeTranscodeMetadata(file.metadata, fileWithProfile, capabilities),
    });
    if (fileId === selectedFileId) {
      normalizeActiveTabForFile(fileWithProfile);
    }
  },

  setFileContainer(fileId: string, containerId: string) {
    const file = files.find((item) => item.id === fileId);
    if (!file) return;

    const nextProfile = normalizeContainerChange(file, containerId);
    const fileWithProfile = { ...file, profile: nextProfile };

    updateFileInternal(fileId, {
      profile: nextProfile,
      metadata: normalizeTranscodeMetadata(file.metadata, fileWithProfile, capabilities),
    });
    if (fileId === selectedFileId) {
      normalizeActiveTabForFile(fileWithProfile);
    }
  },

  applyProfileToAll(profile: TranscodeProfile) {
    files = files.map((file) => {
      const nextProfile = normalizeProfileChange(file, {
        ...cloneTranscodeProfile(profile),
        audio: stripAudioTrackOverrides(profile.audio),
      });
      const fileWithProfile = { ...file, profile: nextProfile };

      return {
        ...file,
        profile: nextProfile,
        metadata: normalizeTranscodeMetadata(file.metadata, fileWithProfile, capabilities),
      };
    });
    normalizeActiveTabForSelectedFile();
  },

  setFileMetadata(fileId: string, metadata: TranscodeMetadata) {
    const file = files.find((item) => item.id === fileId);
    if (!file) return;

    updateFileInternal(fileId, {
      metadata: normalizeTranscodeMetadata(cloneTranscodeMetadata(metadata), file, capabilities),
    });
  },

  resetFileMetadata(fileId: string) {
    const file = files.find((item) => item.id === fileId);
    if (!file) return;

    updateFileInternal(fileId, {
      metadata: buildDefaultTranscodeMetadata(file, capabilities),
    });
  },

  selectFile(fileId: string | null) {
    selectedFileId = fileId && files.some((file) => file.id === fileId) ? fileId : files[0]?.id ?? null;
    normalizeActiveTabForSelectedFile();
  },

  removeFile(fileId: string) {
    const file = files.find((item) => item.id === fileId);
    files = files.filter((item) => item.id !== fileId);
    if (file) {
      fileRunStates = new Map(fileRunStates);
      fileRunStates.delete(file.path);
    }
    if (selectedFileId === fileId) {
      selectedFileId = files[0]?.id ?? null;
      normalizeActiveTabForSelectedFile();
    }
  },

  clearFiles() {
    files = [];
    selectedFileId = null;
    fileRunStates = new Map();
    runtimeProgress = resetRuntimeProgressState();
    progress = 0;
    status = 'idle';
    error = null;
    isCancelling = false;
  },

  setAiStatus(fileId: string, nextStatus: TranscodeFile['aiStatus'], aiError?: string) {
    updateFileInternal(fileId, {
      aiStatus: nextStatus,
      aiError,
    });
  },

  setAnalysisFrames(fileId: string, analysisFrames: string[]) {
    updateFileInternal(fileId, { analysisFrames });
  },

  setAiRecommendation(fileId: string, recommendation: NonNullable<TranscodeFile['aiRecommendation']>) {
    const file = files.find((item) => item.id === fileId);
    if (!file) return;

    const normalizedProfile = normalizeProfileChange(file, recommendation.profile);
    const fileWithProfile = { ...file, profile: normalizedProfile };
    updateFileInternal(fileId, {
      aiStatus: 'completed',
      aiError: undefined,
      aiRecommendation: {
        ...recommendation,
        profile: normalizedProfile,
      },
      profile: normalizedProfile,
      metadata: normalizeTranscodeMetadata(file.metadata, fileWithProfile, capabilities),
    });
  },

  initializeFileRunStates(filePaths: string[]) {
    const next = new Map<string, FileRunState>();
    for (const filePath of filePaths) {
      next.set(filePath, {
        ...getDefaultFileRunState(),
        status: 'queued',
        progress: 0,
      });
    }
    fileRunStates = next;
  },

  clearFileRunStates() {
    fileRunStates = new Map();
  },

  getFileRunState(filePath: string): FileRunState {
    return fileRunStates.get(filePath) ?? getDefaultFileRunState();
  },

  setFileQueued(filePath: string) {
    setFileRunState(filePath, {
      status: 'queued',
      progress: 0,
      speedBytesPerSec: undefined,
      error: undefined,
    });
  },

  setFileProcessing(filePath: string) {
    setFileRunState(filePath, {
      status: 'processing',
      progress: 0,
      speedBytesPerSec: undefined,
      error: undefined,
    });
  },

  updateFileRunProgress(filePath: string, progressValue: number, speedBytesPerSec?: number) {
    setFileRunState(filePath, {
      status: 'processing',
      progress: clampPercentage(progressValue),
      speedBytesPerSec,
      error: undefined,
    });
  },

  setFileCompleted(filePath: string) {
    setFileRunState(filePath, {
      status: 'completed',
      progress: 100,
      speedBytesPerSec: undefined,
      error: undefined,
    });
  },

  setFileCancelled(filePath: string) {
    setFileRunState(filePath, {
      status: 'cancelled',
      speedBytesPerSec: undefined,
    });
  },

  setFileError(filePath: string, fileError?: string) {
    setFileRunState(filePath, {
      status: 'error',
      speedBytesPerSec: undefined,
      error: fileError,
    });
  },

  startRuntimeProgress(totalFiles: number) {
    runtimeProgress = {
      ...resetRuntimeProgressState(),
      totalFiles: Math.max(totalFiles, 0),
    };
    progress = 0;
  },

  setCurrentRuntimeFile(fileId: string, filePath: string, fileName: string) {
    runtimeProgress = {
      ...runtimeProgress,
      currentFileId: fileId,
      currentFilePath: filePath,
      currentFileName: fileName,
      currentFileProgress: 0,
      currentSpeedBytesPerSec: undefined,
      currentFrame: undefined,
      totalFrames: undefined,
      framesPerSecond: undefined,
    };
    progress = computeOverallProgress(runtimeProgress);
  },

  updateRuntimeCurrentFile(
    currentFileProgress: number,
    currentSpeedBytesPerSec?: number,
    metrics?: TranscodeProgressMetrics,
  ) {
    runtimeProgress = {
      ...runtimeProgress,
      currentFileProgress: clampPercentage(currentFileProgress),
      currentSpeedBytesPerSec,
      currentFrame: normalizeNonNegativeMetric(metrics?.currentFrame) ?? runtimeProgress.currentFrame,
      totalFrames: normalizePositiveMetric(metrics?.totalFrames) ?? runtimeProgress.totalFrames,
      framesPerSecond: normalizeNonNegativeMetric(metrics?.framesPerSecond) ?? runtimeProgress.framesPerSecond,
    };
    progress = computeOverallProgress(runtimeProgress);
  },

  markRuntimeFileCompleted() {
    runtimeProgress = {
      ...runtimeProgress,
      completedFiles: Math.min(runtimeProgress.totalFiles, runtimeProgress.completedFiles + 1),
      currentFileProgress: 0,
      currentSpeedBytesPerSec: undefined,
      currentFrame: undefined,
      totalFrames: undefined,
      framesPerSecond: undefined,
    };
    progress = computeOverallProgress(runtimeProgress);
  },

  resetRuntimeProgress() {
    runtimeProgress = resetRuntimeProgressState();
    progress = 0;
  },

  setStatus(nextStatus: TranscodeStoreStatus) {
    status = nextStatus;
  },

  setProgress(nextProgress: number) {
    progress = clampPercentage(nextProgress);
  },

  setError(nextError: string | null) {
    error = nextError;
    if (nextError) {
      status = 'error';
    }
  },

  setCancelling(nextIsCancelling: boolean) {
    isCancelling = nextIsCancelling;
  },

  async loadPresets() {
    await loadPresetsFromStore();
  },

  getPresets(tab: TranscodePresetTab) {
    return presets[tab];
  },

  async savePreset<TData extends TranscodeVideoSettings | TranscodeAudioSettings | TranscodeSubtitleSettings>(
    tab: TranscodePresetTab,
    name: string,
    data: TData,
  ): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    const now = Date.now();
    const nextPreset: TranscodePreset<TData> = {
      id: createTranscodeId(`transcode-preset-${tab}`),
      name: trimmedName,
      tab,
      data: clonePresetData(tab, data),
      createdAt: now,
      updatedAt: now,
    };

    presets = {
      ...presets,
      [tab]: [nextPreset, ...presets[tab]],
    };

    await savePresetsToStore();
  },

  async deletePreset(tab: TranscodePresetTab, presetId: string): Promise<void> {
    presets = {
      ...presets,
      [tab]: presets[tab].filter((preset) => preset.id !== presetId),
    };

    await savePresetsToStore();
  },

  applyPreset(fileId: string, tab: TranscodePresetTab, presetId: string) {
    const preset = presets[tab].find((item) => item.id === presetId);
    const file = files.find((item) => item.id === fileId);
    if (!preset || !file) {
      return;
    }

    const nextProfile = cloneTranscodeProfile(file.profile);
    switch (tab) {
      case 'video':
        nextProfile.video = cloneVideoSettings(preset.data as TranscodeVideoSettings);
        break;
      case 'audio':
        nextProfile.audio = {
          ...cloneAudioSettings(preset.data as TranscodeAudioSettings),
          trackOverrides: cloneAudioSettings(file.profile.audio).trackOverrides,
        };
        break;
      case 'subtitles':
        nextProfile.subtitles = cloneSubtitleSettings(preset.data as TranscodeSubtitleSettings);
        break;
    }

    const normalizedProfile = normalizeProfileChange(file, nextProfile);
    const fileWithProfile = { ...file, profile: normalizedProfile };

    updateFileInternal(fileId, {
      profile: normalizedProfile,
      metadata: normalizeTranscodeMetadata(file.metadata, fileWithProfile, capabilities),
    });
    if (fileId === selectedFileId) {
      normalizeActiveTabForFile(fileWithProfile);
    }
  },

  reset() {
    files = [];
    selectedFileId = null;
    mode = 'advanced';
    activeTab = 'video';
    aiProvider = DEFAULT_PROVIDER;
    aiModel = DEFAULT_MODEL;
    aiIntent = 'quality';
    aiUserPrompt = '';
    fileRunStates = new Map();
    runtimeProgress = resetRuntimeProgressState();
    status = 'idle';
    progress = 0;
    error = null;
    isCancelling = false;
  },
};
