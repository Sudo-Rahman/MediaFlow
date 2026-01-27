// Types for AI Translation feature

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'openrouter';

export interface ProviderModel {
  id: string;
  name: string;
}

export const LLM_PROVIDERS: Record<LLMProvider, { name: string; models: ProviderModel[] }> = {
  google: {
    name: 'Google AI',
    models: [
      { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro' },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
    ],
  },
  anthropic: {
    name: 'Anthropic Claude',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude 4 Sonnet' },
      { id: 'claude-opus-4-20250514', name: 'Claude 4 Opus' },
    ],
  },
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-5', name: 'GPT-5' },
      { id: 'gpt-5.2', name: 'GPT-5.2' },
      { id: 'gpt-5-pro', name: 'GPT-5 Pro' },
    ],
  },
  openrouter: {
    name: 'OpenRouter',
    models: [], // Manual input
  },
};

export const SUPPORTED_LANGUAGES = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'id', name: 'Indonesian' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'cs', name: 'Czech' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'uk', name: 'Ukrainian' },
] as const;

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];

export interface SubtitleFile {
  path: string;
  name: string;
  format: 'srt' | 'ass' | 'vtt' | 'ssa';
  content: string;
  size: number;
}

export interface TranslationConfig {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  provider: LLMProvider;
  model: string;
  batchCount: number; // Number of batches to split the file into (1 = no splitting)
}

export interface TranslationProgress {
  status: 'idle' | 'translating' | 'completed' | 'error' | 'cancelled';
  currentFile: string;
  progress: number; // 0-100
  currentBatch: number;
  totalBatches: number;
  error?: string;
}

export interface TranslationUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TranslationResult {
  originalFile: SubtitleFile;
  translatedContent: string;
  outputPath?: string;
  success: boolean;
  error?: string;
  truncated?: boolean;
  usage?: TranslationUsage;
}

// File translation job for multi-file support
export interface TranslationJob {
  id: string;
  file: SubtitleFile;
  status: 'pending' | 'translating' | 'completed' | 'error' | 'cancelled';
  progress: number;
  currentBatch: number;
  totalBatches: number;
  result?: TranslationResult;
  error?: string;
  abortController?: AbortController;
}

// API Keys interface
export interface LLMApiKeys {
  openai: string;
  anthropic: string;
  google: string;
  openrouter: string;
}

// Translation settings
export interface TranslationSettings {
  maxParallelFiles: number; // Max files to process in parallel
  defaultBatchCount: number; // Default number of batches to split files into
}
