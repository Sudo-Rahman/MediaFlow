/**
 * Types for Audio to Subs transcription feature
 * Uses Deepgram Nova API for cloud-based speech-to-text transcription
 */

import type { 
  DeepgramConfig, 
  DeepgramResult, 
  TranscriptionVersion 
} from './deepgram';

// Re-export Deepgram types for convenience
export type { 
  DeepgramConfig, 
  DeepgramResult, 
  TranscriptionVersion,
  TranscriptionOutputFormat,
  DeepgramModel,
  DeepgramLanguage,
  DeepgramLanguageCode,
  TranscriptionPhrase,
  TranscriptionData,
  TranscriptionJSONOutput
} from './deepgram';

export { 
  DEEPGRAM_MODELS, 
  DEEPGRAM_LANGUAGES,
  DEFAULT_DEEPGRAM_CONFIG,
  DEFAULT_DEEPGRAM_MODEL
} from './deepgram';

// ============================================================================
// AUDIO FILE TYPES
// ============================================================================

export interface AudioFile {
  id: string;
  path: string;
  name: string;
  size: number;
  duration?: number;           // in seconds
  format?: string;             // mp3, wav, aac, opus, etc.
  sampleRate?: number;         // 44100, 48000, etc.
  channels?: number;           // 1 = mono, 2 = stereo
  bitrate?: number;
  status: AudioFileStatus;
  error?: string;
  progress?: number;           // 0-100 during transcription

  // Transcoding fields
  isTranscoding?: boolean;     // OPUS transcoding in progress
  transcodingProgress?: number;// 0-100
  opusPath?: string;           // Path to transcoded OPUS file (mono 96kbps)

  // Selected audio track info (for multi-track files)
  selectedTrackIndex?: number;      // Which audio track was selected
  audioTrackLanguage?: string;      // Language of selected track
  audioTrackTitle?: string;         // Title of selected track
  audioTrackCount?: number;         // Total number of audio tracks in source file

  // Transcription versions
  transcriptionVersions: TranscriptionVersion[];

  // Waveform persistence fields
  previewUrl?: string;         // URL blob for converted audio preview
  convertedPath?: string;      // Path to converted temp file
  waveformState?: {
    currentTime: number;
    isPlaying: boolean;
    zoomLevel: number;
  };
}

export type AudioFileStatus = 
  | 'pending'        // Just added, not probed yet
  | 'scanning'       // FFprobe in progress
  | 'transcoding'    // Converting to OPUS
  | 'ready'          // Ready for transcription
  | 'transcribing'   // Transcription in progress
  | 'completed'      // Has at least one transcription
  | 'error';         // Error occurred

// ============================================================================
// TRANSCRIPTION CONFIG (Application-level)
// ============================================================================

export interface TranscriptionConfig {
  deepgramConfig: DeepgramConfig;
  maxConcurrentTranscriptions: number;
}

export const DEFAULT_TRANSCRIPTION_CONFIG: TranscriptionConfig = {
  deepgramConfig: {
    model: 'nova-3',
    language: 'multi',
    punctuate: true,
    paragraphs: true,
    smartFormat: true,
    utterances: true,
    uttSplit: 0.8,
    diarize: false,
  },
  maxConcurrentTranscriptions: 5,
};

// ============================================================================
// SUPPORTED AUDIO FORMATS
// ============================================================================

export const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 
  'wma', 'ac3', 'dts', 'mka', 'webm', 'mp4', 'mkv'
] as const;

export type AudioExtension = typeof AUDIO_EXTENSIONS[number];

// Formats that don't need transcoding
export const OPUS_COMPATIBLE_FORMATS = ['opus'] as const;

// ============================================================================
// TRANSCRIPTION PROGRESS
// ============================================================================

export interface TranscriptionProgress {
  fileId: string;
  progress: number;  // 0-100
  phase: 'uploading' | 'processing' | 'done';
  estimatedTimeRemaining?: number;  // in seconds
}

export interface TranscriptionResult {
  success: boolean;
  versionId?: string;
  error?: string;
  duration?: number;  // Processing time in seconds
}

// ============================================================================
// AUDIO TRACK SELECTION (for video files)
// ============================================================================

export interface AudioTrackInfo {
  index: number;
  codec: string;
  channels: number;
  sampleRate: number;
  bitrate?: number;
  language?: string;
  title?: string;
  isDefault?: boolean;
}

// ============================================================================
// BATCH TRACK SELECTION STRATEGY
// ============================================================================

export type BatchTrackStrategy = 
  | { type: 'default' }                    // Use track marked as default, or first
  | { type: 'language'; language: string } // Filter by language code
  | { type: 'first' }                      // Always use first track (index 0)
  | { type: 'index'; index: number }       // Use specific track index
  | { type: 'individual' };                // Select for each file individually
