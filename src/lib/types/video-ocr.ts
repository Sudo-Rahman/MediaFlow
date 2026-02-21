/**
 * Types for Video OCR subtitle extraction feature
 * Uses rust-paddle-ocr for text detection and recognition
 */

import { LLM_PROVIDERS } from './translation';
import type { LLMProvider } from './translation';

// ============================================================================
// VIDEO FILE TYPES
// ============================================================================

export interface OcrVideoFile {
  id: string;
  path: string;
  name: string;
  size: number;
  duration?: number;           // in seconds
  width?: number;              // video width
  height?: number;             // video height
  status: OcrFileStatus;
  error?: string;
  
  // Preview transcoding
  previewPath?: string;        // Path to transcoded 480p MP4
  isTranscoding?: boolean;
  transcodingProgress?: number;
  transcodingCodec?: string;   // Active transcoding codec label (e.g. HEVC VideoToolbox)
  
  // OCR region (relative coordinates 0-1)
  ocrRegion?: OcrRegion;
  ocrRegionMode: OcrRegionMode;
  
  // OCR results
  ocrVersions: OcrVersion[];
  
  // Progress tracking
  progress?: OcrProgress;
}

export type OcrFileStatus = 
  | 'pending'           // Just added, not processed yet
  | 'transcoding'       // Converting to preview format
  | 'ready'             // Ready for OCR
  | 'extracting_frames' // Extracting video frames
  | 'ocr_processing'    // Running OCR on frames
  | 'generating_subs'   // Generating subtitles from OCR results
  | 'completed'         // OCR completed, at least one OCR version is available
  | 'error';            // Error occurred

// ============================================================================
// OCR REGION
// ============================================================================

export interface OcrRegion {
  x: number;           // Left position (0-1 relative to video width)
  y: number;           // Top position (0-1 relative to video height)
  width: number;       // Width (0-1 relative to video width)
  height: number;      // Height (0-1 relative to video height)
}

export type OcrRegionMode = 'global' | 'custom';

// Default region: bottom 25% of the video (typical subtitle area)
export const DEFAULT_OCR_REGION: OcrRegion = {
  x: 0,
  y: 0.75,
  width: 1,
  height: 0.25,
};

// ============================================================================
// OCR SUBTITLES
// ============================================================================

export interface OcrSubtitle {
  id: string;
  text: string;
  startTime: number;   // Start time in milliseconds
  endTime: number;     // End time in milliseconds
  confidence: number;  // OCR confidence (0-1)
}

export interface OcrRawFrame {
  frameIndex: number;
  timeMs: number;
  text: string;
  confidence: number;
}

export type OcrRetryMode =
  | 'full_pipeline'
  | 'cleanup_only'
  | 'cleanup_and_ai'
  | 'ai_only';

export interface OcrVersion {
  id: string;
  name: string;
  createdAt: string;
  mode: OcrRetryMode;
  configSnapshot: OcrConfig;
  rawOcr: OcrRawFrame[];
  finalSubtitles: OcrSubtitle[];
}

// ============================================================================
// OCR PROGRESS
// ============================================================================

export interface OcrProgress {
  phase: OcrPhase;
  current: number;     // Current step (e.g., frame 50)
  total: number;       // Total steps (e.g., 1000 frames)
  percentage: number;  // 0-100
  message?: string;    // Optional status message
}

export type OcrPhase = 
  | 'transcoding'      // Video transcoding for preview
  | 'extracting'       // Frame extraction
  | 'ocr'              // OCR processing
  | 'generating';      // Subtitle generation

export const OCR_PHASE_LABELS: Record<OcrPhase, string> = {
  transcoding: 'Transcoding video...',
  extracting: 'Extracting frames...',
  ocr: 'Running OCR...',
  generating: 'Generating subtitles...',
};

// ============================================================================
// OCR CONFIGURATION
// ============================================================================

export interface OcrConfig {
  frameRate: number;              // Frames per second to extract (default: 10)
  language: OcrLanguage;          // OCR language
  useGpu: boolean;                // Use GPU acceleration
  confidenceThreshold: number;    // Min confidence to keep (0-1)
  threadCount: number;            // Number of threads for OCR processing

  // Subtitle cleanup / stabilization
  mergeSimilar: boolean;          // Merge similar consecutive subtitles (recommended)
  similarityThreshold: number;    // Similarity threshold for merging (0-1)
  maxGapMs: number;               // Max gap to merge (ms)
  minCueDurationMs: number;       // Minimum cue duration (ms) for stabilization heuristics
  filterUrlLike: boolean;         // Filter URL/domain-like watermarks

  // Optional AI post-cleanup
  aiCleanupEnabled: boolean;      // Enable AI correction + dedupe after heuristic cleanup
  aiCleanupProvider: LLMProvider; // LLM provider for OCR cleanup
  aiCleanupModel: string;         // LLM model for OCR cleanup
}

export type OcrOutputFormat = 'srt' | 'vtt' | 'txt';

export const OCR_OUTPUT_FORMATS: { value: OcrOutputFormat; label: string }[] = [
  { value: 'srt', label: 'SubRip (.srt)' },
  { value: 'vtt', label: 'WebVTT (.vtt)' },
  { value: 'txt', label: 'Plain Text (.txt)' },
];

// Default thread count: 2/3 of available cores (calculated at runtime)
export const DEFAULT_OCR_CONFIG: OcrConfig = {
  frameRate: 10,
  language: 'multi',
  useGpu: true,
  confidenceThreshold: 0.5,
  threadCount: Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) * 2 / 3)),

  mergeSimilar: true,
  similarityThreshold: 0.92,
  maxGapMs: 250,
  minCueDurationMs: 500,
  filterUrlLike: true,

  aiCleanupEnabled: false,
  aiCleanupProvider: 'google',
  aiCleanupModel: LLM_PROVIDERS.google.models[0]?.id ?? '',
};

// ============================================================================
// OCR LANGUAGES
// ============================================================================

export type OcrLanguage = 
  | 'multi'      // Default: CN/EN/JP
  | 'en'         // English
  | 'korean'     // Korean
  | 'latin'      // Latin-based languages
  | 'cyrillic'   // Russian, Ukrainian, etc.
  | 'arabic'     // Arabic, Persian, Urdu
  | 'devanagari' // Hindi, Marathi, etc.
  | 'thai'       // Thai
  | 'greek'      // Greek
  | 'tamil'      // Tamil
  | 'telugu';    // Telugu

export const OCR_LANGUAGES: { value: OcrLanguage; label: string; description: string }[] = [
  { value: 'multi', label: 'Multi-language', description: 'Chinese, English, Japanese' },
  { value: 'en', label: 'English', description: 'English only' },
  { value: 'korean', label: 'Korean', description: 'Korean, English' },
  { value: 'latin', label: 'Latin', description: 'French, German, Spanish, Italian, Portuguese, etc.' },
  { value: 'cyrillic', label: 'Cyrillic', description: 'Russian, Ukrainian, Bulgarian, etc.' },
  { value: 'arabic', label: 'Arabic', description: 'Arabic, Persian, Urdu' },
  { value: 'devanagari', label: 'Devanagari', description: 'Hindi, Marathi, Nepali' },
  { value: 'thai', label: 'Thai', description: 'Thai, English' },
  { value: 'greek', label: 'Greek', description: 'Greek, English' },
  { value: 'tamil', label: 'Tamil', description: 'Tamil, English' },
  { value: 'telugu', label: 'Telugu', description: 'Telugu, English' },
];

// ============================================================================
// OCR FRAME RESULT (from Rust backend)
// ============================================================================

export interface OcrFrameResult {
  frameIndex: number;
  timeMs: number;
  texts: OcrTextBox[];
}

export interface OcrTextBox {
  text: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// ============================================================================
// OCR LOG
// ============================================================================

export interface OcrLogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warning' | 'error';
  message: string;
  details?: string;
}

// ============================================================================
// SUPPORTED VIDEO FORMATS
// ============================================================================

export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov'] as const;
export type VideoExtension = typeof VIDEO_EXTENSIONS[number];

export function isVideoExtension(ext: string): ext is VideoExtension {
  return VIDEO_EXTENSIONS.includes(ext.toLowerCase() as VideoExtension);
}

// ============================================================================
// OCR STORAGE (for persistence)
// ============================================================================

export interface VideoOcrPersistenceData {
  version: 1;
  videoPath: string;
  previewPath?: string;
  ocrRegion?: OcrRegion;
  ocrRegionMode?: OcrRegionMode;
  ocrVersions: OcrVersion[];
  createdAt: string;
  updatedAt: string;
}

export type OcrStorageData = VideoOcrPersistenceData;

// ============================================================================
// TAURI EVENT PAYLOADS
// ============================================================================

export interface OcrProgressEvent {
  fileId: string;
  phase: OcrPhase;
  current: number;
  total: number;
  message?: string;
  transcodingCodec?: string;
}

// ============================================================================
// OCR MODELS STATUS (from Rust backend)
// ============================================================================

export interface OcrModelsStatus {
  installed: boolean;
  modelsDir: string | null;
  availableLanguages: string[];
  missingModels: string[];
  downloadInstructions: string;
}
