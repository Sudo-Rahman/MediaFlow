import type { TrackType } from './media';

// Types for Batch Merge

// Source video file (episode)
export interface MergeVideoFile {
  id: string;
  path: string;
  name: string;
  size: number;
  duration?: number;
  tracks: MergeTrack[];
  status: 'pending' | 'scanning' | 'ready' | 'error';
  error?: string;
  // Series info extracted from filename
  seasonNumber?: number;
  episodeNumber?: number;
  // Tracks to be merged into this file
  attachedTracks: AttachedTrack[];
}

// Imported track (to merge)
export interface ImportedTrack {
  id: string;
  path: string;
  name: string;
  type: TrackType;
  codec: string;
  language?: string;
  title?: string;
  // Series info extracted from filename (for auto-matching)
  seasonNumber?: number;
  episodeNumber?: number;
  // Track config
  config: MergeTrackConfig;
}

// Track attached to a video file
export interface AttachedTrack {
  trackId: string; // Reference to ImportedTrack.id
  order: number;
}

// Existing track in a source file
export interface MergeTrack {
  id: string;
  sourceFileId: string;
  originalIndex: number;
  type: TrackType;
  codec: string;
  codecLong?: string;
  language?: string;
  title?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  frameRate?: string;
  channels?: number;
  sampleRate?: number;
  forced?: boolean;
  default?: boolean;
}

export interface MergeTrackConfig {
  trackId: string;
  enabled: boolean;
  language?: string;
  title?: string;
  default?: boolean;
  forced?: boolean;
  delayMs: number;
  order: number;
}

export interface MergeOutputConfig {
  outputPath: string;
  // Use source filename pattern or custom
  useSourceFilename: boolean;
  outputNamePattern: string;
  title?: string;
}

export interface BatchMergeJob {
  videoFileId: string;
  attachedTrackIds: string[];
  outputPath: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
}

// Track group for bulk editing (by language + type)
export interface TrackGroup {
  id: string;
  type: TrackType;
  language: string | null;
  trackIds: string[]; // Track IDs in this group
  collapsed: boolean;
}

// Property preset for tracks
export interface TrackPreset {
  id: string;
  name: string;
  type: TrackType;
  language?: string;
  title?: string;
  default?: boolean;
  forced?: boolean;
  delayMs?: number;
  createdAt: number;
}

// Union type for editable tracks
export type EditableTrack = MergeTrack | ImportedTrack;

// Common languages for dropdown
export const COMMON_LANGUAGES = [
  { code: 'und', label: 'Undefined' },
  { code: 'fra', label: 'French' },
  { code: 'eng', label: 'English' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'ger', label: 'German' },
  { code: 'spa', label: 'Spanish' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'rus', label: 'Russian' },
  { code: 'kor', label: 'Korean' },
  { code: 'chi', label: 'Chinese' },
  { code: 'ara', label: 'Arabic' },
] as const;

// Utility to extract series info from filename
// Returns undefined for movies/non-series content
export function extractSeriesInfo(filename: string): { season?: number; episode: number } | undefined {
  // Remove extension for analysis
  const cleanName = filename.replace(/\.[^/.]+$/, "");

  // 1. Strict SxxExx or Sxx.Exx (Most reliable)
  // Matches: S01E01, s1e1, S01.E01, S01_E01, S01 - E01, S01xE01
  const sxe = /\b[sS](\d{1,4})[\s._-]?[eExX](\d{1,4})\b/;
  const sxeMatch = cleanName.match(sxe);
  if (sxeMatch) {
    return { season: parseInt(sxeMatch[1]), episode: parseInt(sxeMatch[2]) };
  }

  // 2. XxYY pattern
  // Matches: 1x01, 10x05
  const xyy = /\b(\d{1,2})x(\d{1,3})\b/;
  const xyyMatch = cleanName.match(xyy);
  if (xyyMatch) {
    return { season: parseInt(xyyMatch[1]), episode: parseInt(xyyMatch[2]) };
  }

  // 3. "Season X Episode Y"
  const verbose = /Season\s*(\d+).*?Episode\s*(\d+)/i;
  const verboseMatch = cleanName.match(verbose);
  if (verboseMatch) {
    return { season: parseInt(verboseMatch[1]), episode: parseInt(verboseMatch[2]) };
  }

  // 4. Safe Episode Patterns (No Season)
  // "Ep. 01", "Episode 1", "Vol.1", "Part 1", "E01", "Episode - 01"
  // Added [eE] to support "E01" shorthand
  // Added [_-] to support "Episode - 01" separator style
  const ep = /\b(?:ep|episode|vol|part|[eE])[\s._-]*(\d{1,4})\b/i;
  const epMatch = cleanName.match(ep);
  if (epMatch) {
    return { episode: parseInt(epMatch[1]) };
  }

  // 5. Japanese format 第01話
  const jp = /第\s*(\d+)\s*話/;
  const jpMatch = cleanName.match(jp);
  if (jpMatch) {
    return { episode: parseInt(jpMatch[1]) };
  }

  // 6. Absolute number strict check (e.g. Anime [Group] Show - 01 [1080p])
  // We handle both " - 01" and "[01]" styles
  // Must be 2-3 digits to avoid confusion with movies (years) or single digit parts
  
  // Style A: Separator based ( - 01, _01_ )
  // Added |$ to allow match at end of string
  const separator = /[\s\[\(](?:-|_)[\s]*(\d{2,3})(?:[\s\]\)\.]|$)/;
  const sepMatch = cleanName.match(separator);
  if (sepMatch) {
    const num = parseInt(sepMatch[1]);
    if (![480, 576, 720, 1080, 2160].includes(num)) {
       return { episode: num };
    }
  }

  // Style B: Brackets [01] - commonly used in fansubs
  // Be careful not to match [2024] or [1080p]
  const brackets = /\[(\d{2,3})\]/;
  const brMatch = cleanName.match(brackets);
  if (brMatch) {
    const num = parseInt(brMatch[1]);
    // Extra safety: 19xx and 20xx are likely years, skip them
    // (regex is 2-3 digits so 4 digits years are already excluded by regex,
    // but just in case of logic change)
    if (![480, 576, 720, 1080].includes(num)) {
       return { episode: num };
    }
  }

  // 7. Simple number at end of filename (e.g., "High School DxD 01")
  // Matches: "Name 01", "Name 01 " (before extension was removed)
  // The number must be preceded by whitespace and at the end or followed by metadata
  // Excludes common video resolutions to avoid false positives
  const simpleEnd = /\s(\d{2,3})(?:\s*$|\s+(?=\[|$))/;
  const simpleMatch = cleanName.match(simpleEnd);
  if (simpleMatch) {
    const num = parseInt(simpleMatch[1]);
    if (![480, 576, 720, 1080, 2160].includes(num)) {
      return { episode: num };
    }
  }

  return undefined;
}
