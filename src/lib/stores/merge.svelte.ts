import type {
  MergeVideoFile,
  ImportedTrack,
  MergeTrack,
  MergeTrackConfig,
  MergeOutputConfig,
  BatchMergeJob,
  AttachedTrack
} from '$lib/types';
import { extractEpisodeNumber } from '$lib/types/merge';

// State
let videoFiles = $state<MergeVideoFile[]>([]);
let importedTracks = $state<ImportedTrack[]>([]);
let sourceTrackConfigs = $state<Map<string, MergeTrackConfig>>(new Map());
let selectedVideoId = $state<string | null>(null);
let outputConfig = $state<MergeOutputConfig>({
  outputPath: '',
  useSourceFilename: true,
  outputNamePattern: '{filename}_merged',
});
let batchJobs = $state<BatchMergeJob[]>([]);
let status = $state<'idle' | 'processing' | 'completed' | 'error'>('idle');
let progress = $state(0);
let error = $state<string | null>(null);

let idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++idCounter}`;
}

export const mergeStore = {
  // Getters
  get videoFiles() { return videoFiles; },
  get importedTracks() { return importedTracks; },
  get selectedVideoId() { return selectedVideoId; },
  get selectedVideo(): MergeVideoFile | undefined {
    return videoFiles.find(f => f.id === selectedVideoId);
  },
  get outputConfig() { return outputConfig; },
  get batchJobs() { return batchJobs; },
  get status() { return status; },
  get progress() { return progress; },
  get error() { return error; },
  get isProcessing() { return status === 'processing'; },

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
  addVideoFile(file: Omit<MergeVideoFile, 'id' | 'attachedTracks' | 'episodeNumber'>): string {
    const episodeNumber = extractEpisodeNumber(file.name);
    const newFile: MergeVideoFile = {
      ...file,
      id: generateId('video'),
      episodeNumber,
      attachedTracks: []
    };
    videoFiles = [...videoFiles, newFile];

    if (videoFiles.length === 1) {
      selectedVideoId = newFile.id;
    }

    return newFile.id;
  },

  updateVideoFile(fileId: string, updates: Partial<MergeVideoFile>) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? { ...f, ...updates } : f
    );
  },

  removeVideoFile(fileId: string) {
    videoFiles = videoFiles.filter(f => f.id !== fileId);
    if (selectedVideoId === fileId) {
      selectedVideoId = videoFiles.length > 0 ? videoFiles[0].id : null;
    }
  },

  selectVideo(fileId: string | null) {
    selectedVideoId = fileId;
  },

  // Imported track management
  addImportedTrack(track: Omit<ImportedTrack, 'id' | 'episodeNumber' | 'config'>): string {
    const episodeNumber = extractEpisodeNumber(track.name);
    const newTrack: ImportedTrack = {
      ...track,
      id: generateId('track'),
      episodeNumber,
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

  // Auto-match tracks to videos by episode number
  autoMatchByEpisodeNumber() {
    const tracksWithEpisode = importedTracks.filter(t => t.episodeNumber !== undefined);
    const videosWithEpisode = videoFiles.filter(v => v.episodeNumber !== undefined);

    for (const track of tracksWithEpisode) {
      const matchingVideo = videosWithEpisode.find(v => v.episodeNumber === track.episodeNumber);
      if (matchingVideo) {
        this.attachTrackToVideo(track.id, matchingVideo.id);
      }
    }
  },

  // Output configuration
  setOutputPath(path: string) {
    outputConfig = { ...outputConfig, outputPath: path };
  },

  setUseSourceFilename(value: boolean) {
    outputConfig = { ...outputConfig, useSourceFilename: value };
  },

  setOutputNamePattern(pattern: string) {
    outputConfig = { ...outputConfig, outputNamePattern: pattern };
  },

  // Status management
  setStatus(newStatus: typeof status) {
    status = newStatus;
  },

  setProgress(value: number) {
    progress = value;
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
    outputConfig = {
      outputPath: '',
      useSourceFilename: true,
      outputNamePattern: '{filename}_merged',
    };
    batchJobs = [];
    status = 'idle';
    progress = 0;
    error = null;
  },

  clearAll() {
    videoFiles = [];
    importedTracks = [];
    sourceTrackConfigs = new Map();
    selectedVideoId = null;
    batchJobs = [];
    status = 'idle';
    progress = 0;
    error = null;
  }
};

