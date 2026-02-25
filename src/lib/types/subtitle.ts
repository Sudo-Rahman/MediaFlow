// Types for subtitle parsing and translation pipeline

/**
 * Supported subtitle formats
 */
export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ssa';

/**
 * Placeholder token for protected content
 */
export interface Placeholder {
  index: number;
  token: string;      // e.g., "⟦TAG_0⟧"
  original: string;   // The original content that was replaced
}

/**
 * A single subtitle cue (common internal representation)
 */
export interface Cue {
  id: string;                    // Stable identifier (e.g., "L53" or line number)
  index?: number;                // Original index in file (for SRT)
  startMs: number;               // Start time in milliseconds
  endMs: number;                 // End time in milliseconds
  rawPrefix?: string;            // Everything before the text (for ASS: "Dialogue: 0,0:00:01.81,0:00:06.26,italics,Yumiella,0000,0000,0000,,")
  rawSuffix?: string;            // Anything after the text (for VTT: cue settings)
  textOriginal: string;          // Original payload text
  textSkeleton: string;          // Text with placeholders
  placeholders: Placeholder[];   // Ordered list of placeholders
  speaker?: string;              // Speaker name if available
  style?: string;                // Style name if available
  format: SubtitleFormat;
}

/**
 * Parsed subtitle file
 */
export interface ParsedSubtitle {
  format: SubtitleFormat;
  header: string;                // File header (for VTT/ASS)
  stylesSection?: string;        // Styles section (for ASS)
  eventsFormat?: string;         // Events format line (for ASS)
  cues: Cue[];
  footer?: string;               // Any trailing content
}

/**
 * Translation request sent to LLM (minimal, translation-only cues)
 */
export interface TranslationRequest {
  sourceLang: string;
  targetLang: string;
  rules: {
    placeholders: 'MUST_PRESERVE_EXACTLY';
    noReordering: true;
    noMerging: true;
    noSplitting: true;
  };
  cues: TranslationCue[];
}

/**
 * Minimal cue for translation (only what the LLM needs)
 */
export interface TranslationCue {
  id: string;
  text: string;        // Skeleton text with placeholders
}

/**
 * Translation response from LLM
 */
export interface TranslationResponse {
  cues: TranslatedCue[];
}

/**
 * Translated cue from LLM
 */
export interface TranslatedCue {
  id: string;
  translatedText: string;
}

/**
 * Validation error
 */
export interface ValidationError {
  cueId: string;
  type: 'missing_id' | 'extra_id' | 'placeholder_mismatch' | 'placeholder_order' | 'invalid_timing' | 'parse_error';
  message: string;
  expected?: string;
  received?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
