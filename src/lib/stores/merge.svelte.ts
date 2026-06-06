import { LazyStore } from '@tauri-apps/plugin-store';

import { isMkvMergeDisplayTrack } from '$lib/services/merge-compat';
import type {
  MergeVideoFile,
  ImportedTrack,
  MergeTrack,
  MergeTrackConfig,
  MergeAutoMatchMode,
  MergeAiStatus,
  MergeAiSuggestion,
  MergeOutputConfig,
  FileRunState,
  MergeRuntimeProgress,
  AttachedTrack,
  TrackGroup,
  TrackPreset,
  TrackType,
  LLMProvider,
} from '$lib/types';
import {
  extractSeriesInfo,
  getDefaultLLMModel,
  getDefaultLLMProvider,
  normalizeLLMSelection,
} from '$lib/types';
import { mediaflowModelCatalogStore } from './mediaflow-model-catalog.svelte';

const DEFAULT_AI_PROVIDER = getDefaultLLMProvider();
const DEFAULT_AI_MODEL = getDefaultLLMModel(DEFAULT_AI_PROVIDER);
const DEFAULT_AUTO_MATCH_MODE: MergeAutoMatchMode = 'classic';

// State
let videoFiles = $state<MergeVideoFile[]>([]);
let importedTracks = $state<ImportedTrack[]>([]);
let sourceTrackConfigs = $state<Map<string, MergeTrackConfig>>(new Map());
let selectedVideoId = $state<string | null>(null);
let fileRunStates = $state<Map<string, FileRunState>>(new Map());
let outputConfig = $state<MergeOutputConfig>({
  outputDir: '',
});
let autoMatchMode = $state<MergeAutoMatchMode>(DEFAULT_AUTO_MATCH_MODE);
let status = $state<'idle' | 'processing' | 'completed' | 'error'>('idle');
let progress = $state(0);
let runtimeProgress = $state<MergeRuntimeProgress>({
  totalFiles: 0,
  completedFiles: 0,
  currentFileId: null,
  currentFilePath: null,
  currentFileName: '',
  currentFileProgress: 0,
  currentSpeedBytesPerSec: undefined,
});
let error = $state<string | null>(null);
let aiProvider = $state<LLMProvider>(DEFAULT_AI_PROVIDER);
let aiModel = $state<string>(DEFAULT_AI_MODEL);
let aiStatus = $state<MergeAiStatus>('idle');
let aiSuggestions = $state<MergeAiSuggestion[]>([]);
let aiError = $state<string | null>(null);
let aiWarnings = $state<string[]>([]);

// Track groups for bulk editing
let trackGroups = $state<Map<string, TrackGroup>>(new Map());

// Presets storage
let trackPresets = $state<TrackPreset[]>([]);
let presetsLoaded = $state(false);
let preferencesLoaded = $state(false);
let preferencesLoadPromise: Promise<void> | null = null;

// Create lazy store instance
const presetsStore = new LazyStore('merge-presets.json');
const preferencesStore = new LazyStore('merge-settings.json');

// Load presets from Tauri Store on init
async function loadPresetsFromStore() {
  if (presetsLoaded) return;
  
  try {
    const saved = await presetsStore.get<string>('presets');
    if (saved) {
      trackPresets = JSON.parse(saved);
    }
    presetsLoaded = true;
  } catch (err) {
    console.error('Failed to load presets from store:', err);
    trackPresets = [];
    presetsLoaded = true;
  }
}

// Save presets to Tauri Store
async function savePresetsToStore() {
  if (!presetsLoaded) return;
  
  try {
    await presetsStore.set('presets', JSON.stringify(trackPresets));
    await presetsStore.save();
  } catch (err) {
    console.error('Failed to save presets to store:', err);
  }
}

async function loadPreferencesFromStore() {
  if (preferencesLoaded) return;

  if (!preferencesLoadPromise) {
    preferencesLoadPromise = (async () => {
      try {
        const saved = await preferencesStore.get<string>('autoMatchMode');
        if (saved === 'classic' || saved === 'ai') {
          autoMatchMode = saved;
        }
      } catch (err) {
        console.error('Failed to load merge preferences from store:', err);
      } finally {
        preferencesLoaded = true;
      }
    })();
  }

  await preferencesLoadPromise;
  preferencesLoadPromise = null;
}

async function savePreferencesToStore() {
  if (!preferencesLoaded) return;

  try {
    await preferencesStore.set('autoMatchMode', autoMatchMode);
    await preferencesStore.save();
  } catch (err) {
    console.error('Failed to save merge preferences to store:', err);
  }
}

let idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++idCounter}`;
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function getDefaultFileRunState(): FileRunState {
  return {
    status: 'idle',
    progress: 0,
    speedBytesPerSec: undefined,
    error: undefined,
  };
}

function computeOverallProgress(value: MergeRuntimeProgress): number {
  if (value.totalFiles <= 0) {
    return 0;
  }

  const doneUnits = value.completedFiles + (clampPercentage(value.currentFileProgress) / 100);
  return clampPercentage((doneUnits / value.totalFiles) * 100);
}

function resetRuntimeProgressState(): MergeRuntimeProgress {
  return {
    totalFiles: 0,
    completedFiles: 0,
    currentFileId: null,
    currentFilePath: null,
    currentFileName: '',
    currentFileProgress: 0,
    currentSpeedBytesPerSec: undefined,
  };
}

function resetAiState(): void {
  aiStatus = 'idle';
  aiSuggestions = [];
  aiError = null;
  aiWarnings = [];
}

export const mergeStore = {
  // Getters
  get videoFiles() { return videoFiles; },
  get importedTracks() { return importedTracks; },
  get selectedVideoId() { return selectedVideoId; },
  get selectedVideo(): MergeVideoFile | undefined {
    return videoFiles.find(f => f.id === selectedVideoId);
  },
  get fileRunStates() { return fileRunStates; },
  get outputConfig() { return outputConfig; },
  get autoMatchMode() { return autoMatchMode; },
  get status() { return status; },
  get progress() { return progress; },
  get runtimeProgress() { return runtimeProgress; },
  get error() { return error; },
  get isProcessing() { return status === 'processing'; },
  get aiProvider() { return aiProvider; },
  get aiModel() { return aiModel; },
  get aiStatus() { return aiStatus; },
  get aiSuggestions() { return aiSuggestions; },
  get aiError() { return aiError; },
  get aiWarnings() { return aiWarnings; },

  async loadUiPreferences() {
    await loadPreferencesFromStore();
  },

  async setAutoMatchMode(mode: MergeAutoMatchMode) {
    await loadPreferencesFromStore();
    if (autoMatchMode === mode) return;

    autoMatchMode = mode;
    await savePreferencesToStore();
  },

  // Get all tracks attached to a specific video
  getAttachedTracks(videoId: string): ImportedTrack[] {
    const video = videoFiles.find(v => v.id === videoId);
    if (!video) return [];
    return video.attachedTracks
      .sort((a, b) => a.order - b.order)
      .map(at => importedTracks.find(t => t.id === at.trackId))
      .filter((t): t is ImportedTrack => t !== undefined);
  },

  // Get unassigned tracks (not attached to any video)
  get unassignedTracks(): ImportedTrack[] {
    const assignedIds = new Set(
      videoFiles.flatMap(v => v.attachedTracks.map(at => at.trackId))
    );
    return importedTracks.filter(t => !assignedIds.has(t.id));
  },

  // Check if a file path already exists
  isFileAlreadyImported(path: string): boolean {
    return videoFiles.some(f => f.path === path) ||
           importedTracks.some(t => t.path === path);
  },

  // Video file management
  addVideoFile(file: Omit<MergeVideoFile, 'id' | 'attachedTracks' | 'episodeNumber' | 'seasonNumber'>): string {
    const seriesInfo = extractSeriesInfo(file.name);
    const newFile: MergeVideoFile = {
      ...file,
      id: generateId('video'),
      seasonNumber: seriesInfo?.season,
      episodeNumber: seriesInfo?.episode,
      attachedTracks: []
    };
    videoFiles = [...videoFiles, newFile];

    if (videoFiles.length === 1) {
      selectedVideoId = newFile.id;
    }

    resetAiState();
    return newFile.id;
  },

  updateVideoFile(fileId: string, updates: Partial<MergeVideoFile>) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? { ...f, ...updates } : f
    );
  },

  removeVideoFile(fileId: string) {
    const file = videoFiles.find(f => f.id === fileId);
    videoFiles = videoFiles.filter(f => f.id !== fileId);
    if (file) {
      fileRunStates = new Map(fileRunStates);
      fileRunStates.delete(file.path);
    }
    if (selectedVideoId === fileId) {
      selectedVideoId = videoFiles.length > 0 ? videoFiles[0].id : null;
    }
    aiSuggestions = aiSuggestions.filter(suggestion => suggestion.videoId !== fileId);
    if (aiStatus === 'preview' && aiSuggestions.length === 0) {
      resetAiState();
    }
  },

  selectVideo(fileId: string | null) {
    selectedVideoId = fileId;
  },

  // Imported track management
  addImportedTrack(track: Omit<ImportedTrack, 'id' | 'episodeNumber' | 'seasonNumber' | 'config'>): string {
    const seriesInfo = extractSeriesInfo(track.name);
    const newTrack: ImportedTrack = {
      ...track,
      id: generateId('track'),
      seasonNumber: seriesInfo?.season,
      episodeNumber: seriesInfo?.episode,
      config: {
        trackId: '',
        enabled: true,
        language: track.language,
        title: track.title,
        default: false,
        forced: false,
        delayMs: 0,
        order: importedTracks.length
      }
    };
    newTrack.config.trackId = newTrack.id;
    importedTracks = [...importedTracks, newTrack];
    resetAiState();
    return newTrack.id;
  },

  updateImportedTrack(trackId: string, updates: Partial<ImportedTrack>) {
    importedTracks = importedTracks.map(t =>
      t.id === trackId ? { ...t, ...updates } : t
    );
  },

  updateTrackConfig(trackId: string, updates: Partial<MergeTrackConfig>) {
    importedTracks = importedTracks.map(t =>
      t.id === trackId ? { ...t, config: { ...t.config, ...updates } } : t
    );
    // Reset status if completed so user can re-merge
    if (status === 'completed') status = 'idle';
  },

  // Source track config management
  initSourceTrackConfig(track: MergeTrack) {
    if (!sourceTrackConfigs.has(track.id)) {
      const config: MergeTrackConfig = {
        trackId: track.id,
        enabled: true,
        language: track.language,
        title: track.title,
        default: track.default,
        forced: track.forced,
        delayMs: 0,
        order: sourceTrackConfigs.size
      };
      sourceTrackConfigs = new Map(sourceTrackConfigs);
      sourceTrackConfigs.set(track.id, config);
    }
  },

  getSourceTrackConfig(trackId: string): MergeTrackConfig | undefined {
    return sourceTrackConfigs.get(trackId);
  },

  updateSourceTrackConfig(trackId: string, updates: Partial<MergeTrackConfig>) {
    const current = sourceTrackConfigs.get(trackId);
    if (current) {
      sourceTrackConfigs = new Map(sourceTrackConfigs);
      sourceTrackConfigs.set(trackId, { ...current, ...updates });
      // Reset status if completed so user can re-merge
      if (status === 'completed') status = 'idle';
    }
  },

  toggleSourceTrack(trackId: string) {
    const current = sourceTrackConfigs.get(trackId);
    if (current) {
      sourceTrackConfigs = new Map(sourceTrackConfigs);
      sourceTrackConfigs.set(trackId, { ...current, enabled: !current.enabled });
      // Reset status if completed so user can re-merge
      if (status === 'completed') status = 'idle';
    }
  },

  removeImportedTrack(trackId: string) {
    // Remove from all video attachments
    videoFiles = videoFiles.map(v => ({
      ...v,
      attachedTracks: v.attachedTracks.filter(at => at.trackId !== trackId)
    }));
    importedTracks = importedTracks.filter(t => t.id !== trackId);
    aiSuggestions = aiSuggestions.filter(suggestion => suggestion.trackId !== trackId);
    if (aiStatus === 'preview' && aiSuggestions.length === 0) {
      resetAiState();
    }
    // Reset status if completed so user can re-merge
    if (status === 'completed') status = 'idle';
  },

  // Attach track to video
  attachTrackToVideo(trackId: string, videoId: string) {
    const video = videoFiles.find(v => v.id === videoId);
    if (!video) return;

    // Check if already attached
    if (video.attachedTracks.some(at => at.trackId === trackId)) return;

    // Remove from other videos first
    videoFiles = videoFiles.map(v => ({
      ...v,
      attachedTracks: v.id === videoId
        ? [...v.attachedTracks, { trackId, order: v.attachedTracks.length }]
        : v.attachedTracks.filter(at => at.trackId !== trackId)
    }));
    // Reset status if completed so user can re-merge
    if (status === 'completed') status = 'idle';
  },

  // Detach track from video
  detachTrackFromVideo(trackId: string, videoId: string) {
    videoFiles = videoFiles.map(v =>
      v.id === videoId
        ? { ...v, attachedTracks: v.attachedTracks.filter(at => at.trackId !== trackId) }
        : v
    );
    // Reset status if completed so user can re-merge
    if (status === 'completed') status = 'idle';
  },

  // Reorder attached tracks within a video
  reorderAttachedTracks(videoId: string, trackIds: string[]) {
    videoFiles = videoFiles.map(v => {
      if (v.id !== videoId) return v;
      const newAttached: AttachedTrack[] = trackIds.map((trackId, index) => ({
        trackId,
        order: index
      }));
      return { ...v, attachedTracks: newAttached };
    });
  },

  // Auto-match tracks to videos by series info (Season/Episode)
  autoMatchByEpisodeNumber() {
    const tracksWithInfo = importedTracks.filter(t => t.episodeNumber !== undefined);
    const videosWithInfo = videoFiles.filter(v => v.episodeNumber !== undefined);

    for (const track of tracksWithInfo) {
      // Find ALL valid candidates (both strict and lenient)
      const candidates = videosWithInfo.filter(v => {
        // Episode number must match
        if (v.episodeNumber !== track.episodeNumber) return false;

        // If both have season, season must match
        if (v.seasonNumber !== undefined && track.seasonNumber !== undefined) {
          return v.seasonNumber === track.seasonNumber;
        }

        // If one has season and the other doesn't, allow it
        return true;
      });

      if (candidates.length === 0) continue;

      let bestMatch: MergeVideoFile | undefined;

      // If we have multiple candidates, prioritize "Strict Match" (Season matches Season)
      if (candidates.length > 1) {
        // Filter for strict matches
        const strictMatches = candidates.filter(v => 
          v.seasonNumber !== undefined && 
          track.seasonNumber !== undefined && 
          v.seasonNumber === track.seasonNumber
        );

        if (strictMatches.length === 1) {
          bestMatch = strictMatches[0];
        } else if (strictMatches.length === 0) {
          // No strict matches, but multiple lenient matches. Ambiguous?
          // If track has NO season, and we have multiple videos (S1E1, S2E1), it's ambiguous. 
          // We can't safely match.
          // Unless... maybe there is only one video imported? No, length > 1.
          bestMatch = undefined;
        }
      } else {
        // Only 1 candidate (either strict or lenient)
        bestMatch = candidates[0];
      }

      if (bestMatch) {
        this.attachTrackToVideo(track.id, bestMatch.id);
      }
    }
  },

  setAiProvider(provider: LLMProvider) {
    const selection = normalizeLLMSelection(provider, '', import.meta.env.DEV, mediaflowModelCatalogStore.chatModels);
    aiProvider = selection.provider;
    aiModel = selection.model;
  },

  setAiModel(model: string) {
    const selection = normalizeLLMSelection(aiProvider, model, import.meta.env.DEV, mediaflowModelCatalogStore.chatModels);
    aiProvider = selection.provider;
    aiModel = selection.model;
  },

  startAiAnalysis() {
    aiStatus = 'analyzing';
    aiSuggestions = [];
    aiError = null;
    aiWarnings = [];
  },

  setAiPreview(suggestions: MergeAiSuggestion[], warnings: string[] = []) {
    aiStatus = 'preview';
    aiSuggestions = suggestions;
    aiError = null;
    aiWarnings = warnings;
  },

  setAiError(message: string) {
    aiStatus = 'error';
    aiSuggestions = [];
    aiError = message;
    aiWarnings = [];
  },

  clearAiState() {
    resetAiState();
  },

  setAiSuggestionSelected(trackId: string, selected: boolean) {
    aiSuggestions = aiSuggestions.map(suggestion =>
      suggestion.trackId === trackId ? { ...suggestion, selected } : suggestion
    );
  },

  applySelectedAiSuggestions(): number {
    const availableTrackIds = new Set(importedTracks.map(track => track.id));
    const availableVideoIds = new Set(videoFiles.map(video => video.id));
    const assignedTrackIds = new Set(
      videoFiles.flatMap(video => video.attachedTracks.map(attachedTrack => attachedTrack.trackId))
    );
    const suggestionsToApply: Array<{ trackId: string; videoId: string }> = [];

    for (const suggestion of aiSuggestions) {
      const { videoId } = suggestion;
      if (
        suggestion.selected
        && videoId !== null
        && availableTrackIds.has(suggestion.trackId)
        && !assignedTrackIds.has(suggestion.trackId)
        && availableVideoIds.has(videoId)
      ) {
        suggestionsToApply.push({ trackId: suggestion.trackId, videoId });
      }
    }

    for (const suggestion of suggestionsToApply) {
      this.attachTrackToVideo(suggestion.trackId, suggestion.videoId);
    }

    resetAiState();
    return suggestionsToApply.length;
  },

  // Output configuration
  setOutputDir(dir: string) {
    outputConfig = { ...outputConfig, outputDir: dir };
  },

  // Status management
  setStatus(newStatus: typeof status) {
    status = newStatus;
  },

  setProgress(value: number) {
    progress = value;
  },

  initializeFileRunStates(filePaths: string[]) {
    const next = new Map<string, FileRunState>();
    for (const path of filePaths) {
      next.set(path, {
        ...getDefaultFileRunState(),
        status: 'queued',
        progress: 0,
      });
    }
    fileRunStates = next;
  },

  setFileRunState(filePath: string, updates: Partial<FileRunState>) {
    const current = fileRunStates.get(filePath) ?? getDefaultFileRunState();
    fileRunStates = new Map(fileRunStates);
    fileRunStates.set(filePath, { ...current, ...updates });
  },

  setFileQueued(filePath: string) {
    this.setFileRunState(filePath, {
      status: 'queued',
      progress: 0,
      speedBytesPerSec: undefined,
      error: undefined,
    });
  },

  setFileProcessing(filePath: string) {
    this.setFileRunState(filePath, {
      status: 'processing',
      progress: 0,
      speedBytesPerSec: undefined,
      error: undefined,
    });
  },

  updateFileRunProgress(filePath: string, progressValue: number, speedBytesPerSec?: number) {
    this.setFileRunState(filePath, {
      status: 'processing',
      progress: clampPercentage(progressValue),
      speedBytesPerSec,
      error: undefined,
    });
  },

  setFileCompleted(filePath: string) {
    this.setFileRunState(filePath, {
      status: 'completed',
      progress: 100,
      speedBytesPerSec: undefined,
      error: undefined,
    });
  },

  setFileCancelled(filePath: string) {
    this.setFileRunState(filePath, {
      status: 'cancelled',
      speedBytesPerSec: undefined,
    });
  },

  setFileError(filePath: string, fileError?: string) {
    this.setFileRunState(filePath, {
      status: 'error',
      speedBytesPerSec: undefined,
      error: fileError,
    });
  },

  getFileRunState(filePath: string): FileRunState {
    return fileRunStates.get(filePath) ?? getDefaultFileRunState();
  },

  clearFileRunStates() {
    fileRunStates = new Map();
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
    };
    progress = computeOverallProgress(runtimeProgress);
  },

  updateRuntimeCurrentFile(currentFileProgress: number, currentSpeedBytesPerSec?: number) {
    runtimeProgress = {
      ...runtimeProgress,
      currentFileProgress: clampPercentage(currentFileProgress),
      currentSpeedBytesPerSec,
    };
    progress = computeOverallProgress(runtimeProgress);
  },

  markRuntimeFileCompleted() {
    runtimeProgress = {
      ...runtimeProgress,
      completedFiles: Math.min(runtimeProgress.totalFiles, runtimeProgress.completedFiles + 1),
      currentFileProgress: 0,
      currentSpeedBytesPerSec: undefined,
    };
    progress = computeOverallProgress(runtimeProgress);
  },

  resetRuntimeProgress() {
    runtimeProgress = resetRuntimeProgressState();
    progress = 0;
  },

  setError(err: string | null) {
    error = err;
    if (err) status = 'error';
  },

  // Get videos ready for merge (just need to be ready, attached tracks are optional)
  get videosReadyForMerge(): MergeVideoFile[] {
    return videoFiles.filter(v => v.status === 'ready');
  },

  // Get total tracks to merge
  get totalTracksToMerge(): number {
    return videoFiles.reduce((sum, v) => sum + v.attachedTracks.length, 0);
  },

  // Reset
  reset() {
    videoFiles = [];
    importedTracks = [];
    sourceTrackConfigs = new Map();
    selectedVideoId = null;
    fileRunStates = new Map();
    outputConfig = {
      outputDir: '',
    };
    status = 'idle';
    runtimeProgress = resetRuntimeProgressState();
    progress = 0;
    error = null;
    resetAiState();
  },

  clearAll() {
    videoFiles = [];
    importedTracks = [];
    sourceTrackConfigs = new Map();
    selectedVideoId = null;
    fileRunStates = new Map();
    status = 'idle';
    runtimeProgress = resetRuntimeProgressState();
    progress = 0;
    error = null;
    trackGroups = new Map();
    resetAiState();
  },

  // ========== TRACK GROUPS ==========

  get trackGroups(): TrackGroup[] {
    return Array.from(trackGroups.values()).sort((a, b) => {
      // Sort by type first, then by language
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return (a.language || '').localeCompare(b.language || '');
    });
  },

  // Generate groups from all tracks (source + imported)
  generateTrackGroups() {
    const groups = new Map<string, TrackGroup>();

    // Helper to add track to group
    const addToGroup = (trackId: string, type: TrackType, language: string | undefined) => {
      const langKey = language || 'und';
      const groupId = `${type}-${langKey}`;

      if (!groups.has(groupId)) {
        groups.set(groupId, {
          id: groupId,
          type,
          language: language || null,
          trackIds: [],
          collapsed: true // Default collapsed
        });
      }

      const group = groups.get(groupId)!;
      if (!group.trackIds.includes(trackId)) {
        group.trackIds.push(trackId);
      }
    };

    // Add source tracks
    videoFiles.forEach(video => {
      video.tracks.filter(isMkvMergeDisplayTrack).forEach(track => {
        const config = sourceTrackConfigs.get(track.id);
        const lang = config?.language ?? track.language;
        addToGroup(track.id, track.type, lang);
      });
    });

    // Add imported tracks
    importedTracks.forEach(track => {
      const lang = track.config.language ?? track.language;
      addToGroup(track.id, track.type, lang);
    });

    // Preserve collapsed state from existing groups
    trackGroups.forEach((existingGroup, id) => {
      if (groups.has(id)) {
        groups.get(id)!.collapsed = existingGroup.collapsed;
      }
    });

    trackGroups = groups;
  },

  toggleGroupCollapsed(groupId: string) {
    const group = trackGroups.get(groupId);
    if (group) {
      trackGroups = new Map(trackGroups);
      trackGroups.set(groupId, { ...group, collapsed: !group.collapsed });
    }
  },

  expandAllGroups() {
    trackGroups = new Map(
      Array.from(trackGroups.entries()).map(([id, group]) => [
        id,
        { ...group, collapsed: false }
      ])
    );
  },

  collapseAllGroups() {
    trackGroups = new Map(
      Array.from(trackGroups.entries()).map(([id, group]) => [
        id,
        { ...group, collapsed: true }
      ])
    );
  },

  // Get track by ID (searches both source and imported)
  getTrackById(trackId: string): MergeTrack | ImportedTrack | undefined {
    // Search in source tracks
    for (const video of videoFiles) {
      const track = video.tracks.find(t => t.id === trackId);
      if (track) return track;
    }
    // Search in imported tracks
    return importedTracks.find(t => t.id === trackId);
  },

  // Apply updates to all tracks in a group
  applyToGroup(groupId: string, updates: Partial<MergeTrackConfig>) {
    const group = trackGroups.get(groupId);
    if (!group) return;

    for (const trackId of group.trackIds) {
      // Check if it's a source track
      let isSourceTrack = false;
      for (const video of videoFiles) {
        if (video.tracks.some(t => t.id === trackId)) {
          isSourceTrack = true;
          break;
        }
      }

      if (isSourceTrack) {
        this.updateSourceTrackConfig(trackId, updates);
      } else {
        this.updateTrackConfig(trackId, updates);
      }
    }
  },

  // ========== PRESETS ==========

  get presets(): TrackPreset[] {
    return trackPresets;
  },

  async savePreset(preset: Omit<TrackPreset, 'id' | 'createdAt'>) {
    await loadPresetsFromStore();
    const newPreset: TrackPreset = {
      ...preset,
      id: generateId('preset'),
      createdAt: Date.now()
    };
    trackPresets = [...trackPresets, newPreset];
    await savePresetsToStore();
  },

  async deletePreset(presetId: string) {
    await loadPresetsFromStore();
    trackPresets = trackPresets.filter(p => p.id !== presetId);
    await savePresetsToStore();
  },

  async applyPreset(presetId: string, target?: { type: TrackType; language?: string }) {
    await loadPresetsFromStore();
    const preset = trackPresets.find(p => p.id === presetId);
    if (!preset) return;

    const updates: Partial<MergeTrackConfig> = {
      language: preset.language,
      title: preset.title,
      default: preset.default,
      forced: preset.forced,
      delayMs: preset.delayMs
    };

    // Remove undefined values
    Object.keys(updates).forEach(key => {
      if (updates[key as keyof MergeTrackConfig] === undefined) {
        delete updates[key as keyof MergeTrackConfig];
      }
    });

    if (target) {
      // Apply to specific group
      const groupId = target.language
        ? `${target.type}-${target.language}`
        : `${target.type}-und`;
      this.applyToGroup(groupId, updates);
    } else {
      // Apply to all tracks matching preset type
      this.trackGroups
        .filter(g => g.type === preset.type)
        .forEach(group => this.applyToGroup(group.id, updates));
    }
  },

  async loadPresets() {
    await loadPresetsFromStore();
  }
};
