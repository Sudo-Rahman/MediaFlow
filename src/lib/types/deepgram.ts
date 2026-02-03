/**
 * Types for Deepgram Nova transcription API
 * Supports Nova 2 and Nova 3 models for high-quality speech-to-text
 */

// ============================================================================
// DEEPGRAM MODELS
// ============================================================================

export const DEEPGRAM_MODELS = [
  { 
    id: 'nova-3', 
    name: 'Nova 3', 
    description: 'Latest generation, best quality',
    tier: 'latest'
  },
  { 
    id: 'nova-3-general', 
    name: 'Nova 3 General', 
    description: 'Nova 3 optimized multilingual',
    tier: 'latest'
  },
  { 
    id: 'nova-2', 
    name: 'Nova 2', 
    description: 'Stable and performant model',
    tier: 'stable'
  },
  { 
    id: 'nova-2-general', 
    name: 'Nova 2 General', 
    description: 'Nova 2 optimized multilingual',
    tier: 'stable'
  },
] as const;

export type DeepgramModel = typeof DEEPGRAM_MODELS[number]['id'];

export const DEFAULT_DEEPGRAM_MODEL: DeepgramModel = 'nova-3';

// ============================================================================
// DEEPGRAM LANGUAGES
// ============================================================================

export interface DeepgramLanguage {
  code: string;
  name: string;
  flag?: string;
}

export const DEEPGRAM_LANGUAGES: DeepgramLanguage[] = [
  { code: 'multi', name: 'Auto-detection', flag: '🌐' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'th', name: 'ไทย', flag: '🇹🇭' },
  { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ms', name: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'sv', name: 'Svenska', flag: '🇸🇪' },
  { code: 'da', name: 'Dansk', flag: '🇩🇰' },
  { code: 'no', name: 'Norsk', flag: '🇳🇴' },
  { code: 'fi', name: 'Suomi', flag: '🇫🇮' },
  { code: 'cs', name: 'Čeština', flag: '🇨🇿' },
  { code: 'sk', name: 'Slovenčina', flag: '🇸🇰' },
  { code: 'hu', name: 'Magyar', flag: '🇭🇺' },
  { code: 'ro', name: 'Română', flag: '🇷🇴' },
  { code: 'bg', name: 'Български', flag: '🇧🇬' },
  { code: 'el', name: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'he', name: 'עברית', flag: '🇮🇱' },
  { code: 'fa', name: 'فارسی', flag: '🇮🇷' },
  { code: 'ta', name: 'தமிழ்', flag: '🇮🇳' },
  { code: 'te', name: 'తెలుగు', flag: '🇮🇳' },
  { code: 'bn', name: 'বাংলা', flag: '🇧🇩' },
  { code: 'ca', name: 'Català', flag: '🏴' },
];

export type DeepgramLanguageCode = typeof DEEPGRAM_LANGUAGES[number]['code'];

// ============================================================================
// DEEPGRAM CONFIG
// ============================================================================

export interface DeepgramConfig {
  model: DeepgramModel;
  language: string;           // 'multi' for auto-detection or ISO code
  punctuate: boolean;         // Automatic punctuation
  paragraphs: boolean;        // Paragraph detection
  smartFormat: boolean;       // Smart formatting (numbers, dates, etc.)
  utterances: boolean;        // Return utterance-level segments
  uttSplit: number;           // Pause threshold for new utterance (0.5 - 2.0 sec)
  diarize: boolean;           // Speaker diarization
}

export const DEFAULT_DEEPGRAM_CONFIG: DeepgramConfig = {
  model: 'nova-3',
  language: 'multi',
  punctuate: true,
  paragraphs: true,
  smartFormat: true,
  utterances: true,
  uttSplit: 0.5,
  diarize: false,
};

// ============================================================================
// DEEPGRAM API RESPONSE TYPES
// ============================================================================

export interface DeepgramWord {
  word: string;
  start: number;              // Start time in seconds
  end: number;                // End time in seconds
  confidence: number;         // 0.0 - 1.0
  punctuated_word?: string;   // Word with punctuation
  speaker?: number;           // Speaker ID (from diarization)
  speaker_confidence?: number; // Speaker detection confidence 0.0 - 1.0
}

export interface DeepgramUtterance {
  id: string;
  start: number;
  end: number;
  confidence: number;
  channel: number;
  transcript: string;
  words: DeepgramWord[];
  speaker?: number;
}

export interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

export interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

export interface DeepgramModelInfo {
  name: string;
  version: string;
  arch: string;
}

export interface DeepgramMetadata {
  transaction_key: string;
  request_id: string;
  sha256: string;
  created: string;
  duration: number;           // Audio duration in seconds
  channels: number;
  models: string[];
  model_info: Record<string, DeepgramModelInfo>;
}

export interface DeepgramAPIResponse {
  metadata: DeepgramMetadata;
  results: {
    channels: DeepgramChannel[];
    utterances?: DeepgramUtterance[];
  };
}

// ============================================================================
// TRANSCRIPTION RESULT (Processed)
// ============================================================================

export interface TranscriptionPhrase {
  id: string;
  start: number;              // Start time in seconds
  end: number;                // End time in seconds
  text: string;
  confidence: number;
}

export interface DeepgramResult {
  transcript: string;         // Full text
  phrases: TranscriptionPhrase[];  // Segmented by utterances
  duration: number;           // Audio duration
  confidence: number;         // Average confidence
  language?: string;          // Detected language (if auto)
}

// ============================================================================
// TRANSCRIPTION VERSIONS
// ============================================================================

export interface TranscriptionVersion {
  id: string;
  name: string;               // "Version 1", custom name, etc.
  createdAt: string;          // ISO 8601
  config: DeepgramConfig;
  result: DeepgramResult;
}

export interface TranscriptionData {
  version: number;            // Schema version
  audioPath: string;
  opusPath?: string;          // Path to transcoded OPUS file
  transcriptionVersions: TranscriptionVersion[];
}

// ============================================================================
// TRANSCRIPTION OUTPUT FORMATS
// ============================================================================

export type TranscriptionOutputFormat = 'srt' | 'vtt' | 'json';

export interface TranscriptionJSONOutput {
  duration: number;
  language?: string;
  confidence: number;
  phrases: Array<{
    start: number;
    end: number;
    text: string;
    confidence: number;
  }>;
}
