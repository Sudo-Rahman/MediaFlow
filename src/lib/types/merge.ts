import type { TrackType } from './media';

// Types pour le Merge

export interface MergeSourceFile {
  id: string;
  path: string;
  name: string;
  size: number;
  duration?: number;
  tracks: MergeTrack[];
  status: 'pending' | 'scanning' | 'ready' | 'error';
  error?: string;
}

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
  // Video specific
  width?: number;
  height?: number;
  frameRate?: string;
  // Audio specific
  channels?: number;
  sampleRate?: number;
  // Subtitle specific
  forced?: boolean;
  default?: boolean;
}

export interface MergeTrackConfig {
  trackId: string;
  enabled: boolean;
  // Track settings
  language?: string;
  title?: string;
  default?: boolean;
  forced?: boolean;
  // Timing
  delayMs: number;
  // Order in output
  order: number;
}

export interface MergeOutputConfig {
  outputPath: string;
  outputName: string;
  // Global settings
  title?: string;
  // Tracks configuration
  tracks: MergeTrackConfig[];
}

export interface MergeJob {
  id: string;
  sourceFiles: MergeSourceFile[];
  outputConfig: MergeOutputConfig;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
}

// Languages communes pour le dropdown
export const COMMON_LANGUAGES = [
  { code: 'und', label: 'Non défini' },
  { code: 'fra', label: 'Français' },
  { code: 'eng', label: 'Anglais' },
  { code: 'jpn', label: 'Japonais' },
  { code: 'ger', label: 'Allemand' },
  { code: 'spa', label: 'Espagnol' },
  { code: 'ita', label: 'Italien' },
  { code: 'por', label: 'Portugais' },
  { code: 'rus', label: 'Russe' },
  { code: 'kor', label: 'Coréen' },
  { code: 'chi', label: 'Chinois' },
  { code: 'ara', label: 'Arabe' },
] as const;

