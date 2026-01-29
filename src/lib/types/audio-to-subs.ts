/**
 * Types for Audio to Subs transcription feature
 * Uses whisper.cpp for local speech-to-text transcription
 */

// ============================================================================
// AUDIO FILE TYPES
// ============================================================================

export interface AudioFile {
  id: string;
  path: string;
  name: string;
  size: number;
  duration?: number;         // in seconds
  format?: string;           // mp3, wav, aac, etc.
  sampleRate?: number;       // 44100, 48000, etc.
  channels?: number;         // 1 = mono, 2 = stereo
  bitrate?: number;
  status: AudioFileStatus;
  error?: string;
  progress?: number;         // 0-100 during transcription
  outputPath?: string;       // Path to generated subtitle file
}

export type AudioFileStatus = 
  | 'pending' 
  | 'scanning' 
  | 'ready' 
  | 'transcribing' 
  | 'completed' 
  | 'error';

// ============================================================================
// TRANSCRIPTION CONFIG
// ============================================================================

export interface TranscriptionConfig {
  model: WhisperModel;
  language: string;          // 'auto' or ISO code (fr, en, es...)
  outputFormat: TranscriptionOutputFormat;
  wordTimestamps: boolean;   // For word-level timing
  translate: boolean;        // Translate to English
  maxSegmentLength: number;  // Max characters per subtitle segment (0 = no limit)
}

export type TranscriptionOutputFormat = 'srt' | 'vtt' | 'json';

export const DEFAULT_TRANSCRIPTION_CONFIG: TranscriptionConfig = {
  model: 'large-v3',
  language: 'auto',
  outputFormat: 'srt',
  wordTimestamps: false,
  translate: false,
  maxSegmentLength: 50  // ~2-3 lines of text for readable subtitles
};

// ============================================================================
// WHISPER MODELS
// ============================================================================

export type WhisperModel = 
  | 'tiny' 
  | 'tiny.en'
  | 'base' 
  | 'base.en'
  | 'small' 
  | 'small.en'
  | 'medium' 
  | 'medium.en'
  | 'large-v1'
  | 'large-v2' 
  | 'large-v3' 
  | 'large-v3-turbo';

export type ModelSpeed = 'Très rapide' | 'Rapide' | 'Moyen' | 'Lent';
export type ModelAccuracy = 'Faible' | 'Correct' | 'Bon' | 'Très bon' | 'Excellent';

export interface WhisperModelInfo {
  id: WhisperModel;
  name: string;
  size: string;
  speed: ModelSpeed;
  accuracy: ModelAccuracy;
  vram: string;
  englishOnly: boolean;
}

export const WHISPER_MODELS: WhisperModelInfo[] = [
  { id: 'tiny',           name: 'Tiny',           size: '~75 MB',   speed: 'Très rapide', accuracy: 'Faible',    vram: '~1 GB',  englishOnly: false },
  { id: 'tiny.en',        name: 'Tiny (EN)',      size: '~75 MB',   speed: 'Très rapide', accuracy: 'Correct',   vram: '~1 GB',  englishOnly: true },
  { id: 'base',           name: 'Base',           size: '~140 MB',  speed: 'Rapide',      accuracy: 'Correct',   vram: '~1 GB',  englishOnly: false },
  { id: 'base.en',        name: 'Base (EN)',      size: '~140 MB',  speed: 'Rapide',      accuracy: 'Bon',       vram: '~1 GB',  englishOnly: true },
  { id: 'small',          name: 'Small',          size: '~460 MB',  speed: 'Moyen',       accuracy: 'Bon',       vram: '~2 GB',  englishOnly: false },
  { id: 'small.en',       name: 'Small (EN)',     size: '~460 MB',  speed: 'Moyen',       accuracy: 'Très bon',  vram: '~2 GB',  englishOnly: true },
  { id: 'medium',         name: 'Medium',         size: '~1.5 GB',  speed: 'Lent',        accuracy: 'Très bon',  vram: '~5 GB',  englishOnly: false },
  { id: 'medium.en',      name: 'Medium (EN)',    size: '~1.5 GB',  speed: 'Lent',        accuracy: 'Excellent', vram: '~5 GB',  englishOnly: true },
  { id: 'large-v1',       name: 'Large v1',       size: '~3 GB',    speed: 'Lent',        accuracy: 'Excellent', vram: '~10 GB', englishOnly: false },
  { id: 'large-v2',       name: 'Large v2',       size: '~3 GB',    speed: 'Lent',        accuracy: 'Excellent', vram: '~10 GB', englishOnly: false },
  { id: 'large-v3',       name: 'Large v3',       size: '~3 GB',    speed: 'Lent',        accuracy: 'Excellent', vram: '~10 GB', englishOnly: false },
  { id: 'large-v3-turbo', name: 'Large v3 Turbo', size: '~1.5 GB',  speed: 'Rapide',      accuracy: 'Très bon',  vram: '~6 GB',  englishOnly: false },
];

// ============================================================================
// LANGUAGES
// ============================================================================

export interface WhisperLanguage {
  code: string;
  name: string;
}

export const WHISPER_LANGUAGES: WhisperLanguage[] = [
  { code: 'auto', name: 'Détection automatique' },
  { code: 'fr', name: 'Français' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文' },
  { code: 'ko', name: '한국어' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Bahasa Melayu' },
  { code: 'sv', name: 'Svenska' },
  { code: 'da', name: 'Dansk' },
  { code: 'no', name: 'Norsk' },
  { code: 'fi', name: 'Suomi' },
  { code: 'cs', name: 'Čeština' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'hu', name: 'Magyar' },
  { code: 'ro', name: 'Română' },
  { code: 'bg', name: 'Български' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'he', name: 'עברית' },
  { code: 'fa', name: 'فارسی' },
  { code: 'ur', name: 'اردو' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'ta', name: 'தமிழ்' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'ml', name: 'മലയാളം' },
  { code: 'ca', name: 'Català' },
  { code: 'eu', name: 'Euskara' },
  { code: 'gl', name: 'Galego' },
];

export type WhisperLanguageCode = typeof WHISPER_LANGUAGES[number]['code'];

// ============================================================================
// SUPPORTED AUDIO FORMATS
// ============================================================================

export const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 
  'wma', 'ac3', 'dts', 'mka', 'webm', 'mp4', 'mkv'
] as const;

export type AudioExtension = typeof AUDIO_EXTENSIONS[number];

// ============================================================================
// TRANSCRIPTION PROGRESS
// ============================================================================

export interface TranscriptionProgress {
  fileId: string;
  progress: number;  // 0-100
  currentSegment?: string;  // Current text being transcribed
  estimatedTimeRemaining?: number;  // in seconds
}

export interface TranscriptionResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;  // Processing time in seconds
}
