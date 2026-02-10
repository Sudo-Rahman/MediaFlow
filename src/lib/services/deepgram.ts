/**
 * Deepgram API Service
 * Handles transcription with Deepgram Nova models
 */

import { readFile } from '@tauri-apps/plugin-fs';
import { settingsStore } from '$lib/stores/settings.svelte';
import { logStore } from '$lib/stores/logs.svelte';
import type {
  DeepgramConfig,
  DeepgramAPIResponse,
  DeepgramResult,
  DeepgramWord,
  DeepgramUtterance,
  TranscriptionPhrase,
  TranscriptionOutputFormat,
  TranscriptionJSONOutput,
} from '$lib/types';
import { withSleepInhibit } from './sleep-inhibit';

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

// ============================================================================
// SUBTITLE SEGMENTATION CONFIG
// ============================================================================

const SUBTITLE_CONFIG = {
  /** Maximum duration of a single subtitle in seconds */
  maxDuration: 8.0,
  /** Maximum characters per subtitle for Latin scripts (~2 lines of 42 chars) */
  maxCharsLatin: 84,
  /** Maximum characters per subtitle for CJK scripts (Japanese/Chinese/Korean) - 2 lines of 21 chars */
  maxCharsCJK: 42,
  /** Pause threshold to force new subtitle (seconds) */
  pauseThreshold: 0.8,
  /** Maximum gap to consider phrases as contiguous for merge detection */
  mergeGapThreshold: 0.15,
};

/**
 * Multilingual sentence-ending punctuation pattern
 * Covers: Latin (.!?), Chinese/Japanese (。？！), Hindi (।॥), Arabic (؟), 
 * Greek (;), Armenian (։՞՜), and ellipsis (…‥)
 */
const SENTENCE_END_PATTERN = /[.!?。？！।॥؟;։՞՜…‥]$/;

/**
 * Clause-breaking punctuation for fallback splitting
 * Covers: Latin (,;:), Arabic (،), Chinese/Japanese (、，；：)
 */
const CLAUSE_BREAK_PATTERN = /[,;:،、，；：]$/;

/**
 * Pattern to detect words that are ONLY punctuation (should be skipped)
 * These are sometimes returned by Deepgram as separate "words"
 */
const PUNCTUATION_ONLY_PATTERN = /^[\s.!?。？！،、，；：,;:।॥؟;։՞՜…‥\-—–''""「」『』（）()\[\]]+$/;

/**
 * Pattern to detect CJK (Chinese, Japanese, Korean) characters
 * Used for dynamic character limits (CJK needs lower limits)
 */
const CJK_PATTERN = /[\u3000-\u9fff\uac00-\ud7af\u3040-\u309f\u30a0-\u30ff]/;

/**
 * Pattern to detect lowercase start (Latin languages)
 * Used to detect sentence continuation (fragment detection)
 */
const LOWERCASE_START_PATTERN = /^[a-zàâäçéèêëïîôùûüÿœæßñ]/;

/**
 * Pattern to detect standalone punctuation that should be attached to previous word
 */
const STANDALONE_PUNCTUATION_PATTERN = /^[.!?。？！،、，；：,;:।॥؟;։՞՜…‥]+$/;

/**
 * Pattern to detect sentence-ending punctuation at the START of a word
 * This happens when Deepgram incorrectly attaches punctuation to the next word
 * Example: "。まだ" → should be split into "。" (attach to prev) and "まだ"
 * Also includes clause-breaking punctuation (commas) as they should stay with previous phrase
 */
const LEADING_PUNCTUATION_IN_WORD_PATTERN = /^([.!?。？！।॥؟;։՞՜…‥,،、，]+)(.+)$/;

// ============================================================================
// API CALL
// ============================================================================

export interface TranscribeOptions {
  audioPath: string;
  config: DeepgramConfig;
  onProgress?: (progress: number, phase: 'uploading' | 'processing') => void;
  signal?: AbortSignal;
}

export interface TranscribeResult {
  success: boolean;
  result?: DeepgramResult;
  error?: string;
}

/**
 * Transcribe audio using Deepgram API
 */
export async function transcribeWithDeepgram(options: TranscribeOptions): Promise<TranscribeResult> {
  const { audioPath, config, onProgress, signal } = options;
  
  // Get API key
  const apiKey = settingsStore.getDeepgramApiKey();
  if (!apiKey) {
    return { success: false, error: 'Deepgram API key not configured' };
  }

  if (signal?.aborted) {
    return { success: false, error: 'Transcription cancelled' };
  }
  
  return withSleepInhibit('RsExtractor: Transcription', async () => {
    try {
      // Read audio file
      onProgress?.(5, 'uploading');
      const audioData = await readFile(audioPath);

      // Check abort after file read
      if (signal?.aborted) {
        return { success: false, error: 'Transcription cancelled' };
      }
      
      const audioBlob = new Blob([new Uint8Array(audioData)], { type: 'audio/opus' });
      
      onProgress?.(10, 'uploading');
      
      // Determine model based on language
      // For non-English languages, use the general variant if not already specified
      const isNonEnglish = config.language !== 'en' && config.language !== 'multi';
      let model = config.model;
      if (isNonEnglish && !model.includes('general')) {
        model = `${model}-general` as typeof config.model;
      }
      
      // Build query parameters
      const params = new URLSearchParams({
        model,
        punctuate: String(config.punctuate),
        paragraphs: String(config.paragraphs),
        smart_format: String(config.smartFormat),
        utterances: String(config.utterances),
        utt_split: String(config.uttSplit),
        diarize: String(config.diarize),
        language: config.language === 'auto' ? 'multi' : config.language,
      });
      
      onProgress?.(15, 'uploading');
      
      // Log the API call
      logStore.addLog({
        level: 'info',
        source: 'deepgram',
        title: 'Transcription started',
        details: `Model: ${model}, Language: ${config.language}`,
        context: { filePath: audioPath },
      });
      
      // Make API request with abort signal
      const response = await fetch(`${DEEPGRAM_API_URL}?${params}`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': audioBlob.type || 'audio/opus',
        },
        body: audioBlob,
        signal,
      });
      
      onProgress?.(50, 'processing');
      
      if (!response.ok) {
        const errorText = await response.text();
        logStore.addLog({
          level: 'error',
          source: 'deepgram',
          title: 'Deepgram API Error',
          details: `Status: ${response.status} - ${errorText}`,
          context: { filePath: audioPath, apiError: errorText },
        });
        return { success: false, error: `API Error: ${response.status} - ${errorText}` };
      }
      
      const data: DeepgramAPIResponse = await response.json();
      onProgress?.(90, 'processing');
      
      // Process response into our format
      const result = processDeepgramResponse(data);
      
      onProgress?.(100, 'processing');
      
      logStore.addLog({
        level: 'success',
        source: 'deepgram',
        title: 'Transcription complete',
        details: `Duration: ${formatDuration(result.duration)}, Confidence: ${Math.round(result.confidence * 100)}%`,
        context: { filePath: audioPath },
      });
      
      return { success: true, result };
      
    } catch (error) {
      // Handle abort error specifically
      if (error instanceof Error && error.name === 'AbortError') {
        logStore.addLog({
          level: 'info',
          source: 'deepgram',
          title: 'Transcription cancelled',
          details: 'Request was cancelled by user',
          context: { filePath: audioPath },
        });
        return { success: false, error: 'Transcription cancelled' };
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      logStore.addLog({
        level: 'error',
        source: 'deepgram',
        title: 'Transcription error',
        details: errorMessage,
        context: { filePath: audioPath },
      });
      return { success: false, error: errorMessage };
    }
  });
}

// ============================================================================
// RESPONSE PROCESSING
// ============================================================================

/**
 * Pre-process words to fix punctuation placement issues from Deepgram
 * 
 * Handles two cases:
 * 1. Standalone punctuation as separate "words" (e.g., "。" as its own word)
 * 2. Punctuation attached to the START of a word (e.g., "。まだ" should be "。" + "まだ")
 * 
 * In both cases, the punctuation is moved to the END of the previous word.
 */
function preprocessWords(words: DeepgramWord[]): DeepgramWord[] {
  if (words.length === 0) return words;
  
  const result: DeepgramWord[] = [];
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const wordText = word.punctuated_word || word.word;
    
    // Case 1: Standalone punctuation word → attach to previous word
    if (STANDALONE_PUNCTUATION_PATTERN.test(wordText) && result.length > 0) {
      const prevWord = result[result.length - 1];
      const prevText = prevWord.punctuated_word || prevWord.word;
      
      result[result.length - 1] = {
        ...prevWord,
        word: prevWord.word + wordText,
        punctuated_word: prevText + wordText,
        end: word.end, // Extend timing to include punctuation
      };
      continue;
    }
    
    // Case 2: Punctuation at START of word → split and attach to previous word
    const leadingMatch = wordText.match(LEADING_PUNCTUATION_IN_WORD_PATTERN);
    if (leadingMatch && result.length > 0) {
      const leadingPunct = leadingMatch[1];
      const remainingText = leadingMatch[2];
      
      // Attach punctuation to previous word
      const prevWord = result[result.length - 1];
      const prevText = prevWord.punctuated_word || prevWord.word;
      
      result[result.length - 1] = {
        ...prevWord,
        word: prevWord.word + leadingPunct,
        punctuated_word: prevText + leadingPunct,
        // Don't extend timing - punctuation belongs to previous word's timing
      };
      
      // Add current word without the leading punctuation
      result.push({
        ...word,
        word: remainingText,
        punctuated_word: remainingText,
      });
      continue;
    }
    
    // Default: add word as-is
    result.push(word);
  }
  
  return result;
}

/**
 * Clean up text for CJK languages by removing unnecessary spaces
 * Deepgram adds spaces between CJK characters which is not natural
 */
function cleanCJKText(text: string): string {
  if (!CJK_PATTERN.test(text)) return text;
  
  // Remove spaces between CJK characters
  // Keep spaces around Latin characters/numbers
  return text.replace(/(\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul})\s+(?=\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul})/gu, '$1');
}

/**
 * Pattern to detect sentence-ending punctuation at the START of text
 * This happens when Deepgram incorrectly attaches punctuation to the next word
 * Also includes clause-breaking punctuation (commas) as they should stay with previous phrase
 */
const LEADING_PUNCTUATION_PATTERN = /^([.!?。？！।॥؟;։՞՜…‥,،、，]+)/;

/**
 * Fix phrases where punctuation is at the start instead of the end of previous phrase
 * This is a common Deepgram issue, especially with CJK languages
 */
function fixLeadingPunctuation(phrases: TranscriptionPhrase[]): TranscriptionPhrase[] {
  if (phrases.length < 2) return phrases;
  
  const result = [...phrases];
  
  for (let i = 1; i < result.length; i++) {
    const curr = result[i];
    const prev = result[i - 1];
    
    const match = curr.text.match(LEADING_PUNCTUATION_PATTERN);
    if (match) {
      const leadingPunct = match[1];
      const remainingText = curr.text.slice(leadingPunct.length).trim();
      
      // Move punctuation to end of previous phrase
      result[i - 1] = {
        ...prev,
        text: prev.text + leadingPunct,
      };
      
      // Remove punctuation from start of current phrase
      result[i] = {
        ...curr,
        text: remainingText,
      };
    }
  }
  
  // Filter out any phrases that became empty after removing punctuation
  return result.filter(p => p.text.length > 0);
}

/**
 * Process Deepgram API response into our internal format
 * 
 * Uses utterances (if available) for better natural speech segmentation,
 * with fallback to word-based segmentation if utterances are not present.
 */
function processDeepgramResponse(response: DeepgramAPIResponse): DeepgramResult {
  const { metadata, results } = response;
  
  // Get the main transcript
  const channel = results.channels[0];
  const alternative = channel?.alternatives[0];
  const transcript = alternative?.transcript || '';
  
  // Calculate average confidence
  const rawWords = alternative?.words || [];
  const avgConfidence = rawWords.length > 0
    ? rawWords.reduce((sum, w) => sum + w.confidence, 0) / rawWords.length
    : 0;
  
  // Get utterances if available
  const utterances = results.utterances;
  
  let phrases: TranscriptionPhrase[];
  
  if (utterances && utterances.length > 0) {
    // Use utterances for better natural segmentation
    // buildPhrasesFromUtterances handles:
    // - Punctuation preprocessing per utterance
    // - CJK text cleaning
    // - Splitting long utterances
    // - Fixing leading punctuation between phrases
    phrases = buildPhrasesFromUtterances(utterances);
  } else {
    // Fallback to word-based segmentation
    const words = preprocessWords(rawWords);
    phrases = words.length > 0 ? buildPhrasesFromWords(words) : [];
    
    // Post-process: merge falsely segmented phrases (diarization errors)
    phrases = mergeFalselySegmentedPhrases(phrases);
    
    // Post-process: fix punctuation at start of phrases
    phrases = fixLeadingPunctuation(phrases);
    
    // Post-process: clean up CJK text
    phrases = phrases.map(p => ({
      ...p,
      text: cleanCJKText(p.text),
    }));
  }
  
  return {
    transcript,
    phrases,
    duration: metadata.duration,
    confidence: avgConfidence,
  };
}

/**
 * Build phrases from Deepgram utterances
 * 
 * Utterances provide better natural segmentation from Deepgram's speech detection.
 * Each utterance is treated as a potential phrase, but split if it exceeds limits.
 * 
 * Processing:
 * 1. For each utterance, preprocess its words to fix punctuation placement
 * 2. Build text from the preprocessed words
 * 3. If utterance respects limits → create single phrase
 * 4. If too long/too many chars → split using buildPhrasesFromWords
 * 5. Merge contiguous phrases that were over-split
 * 6. Apply fixLeadingPunctuation between resulting phrases
 */
function buildPhrasesFromUtterances(utterances: DeepgramUtterance[]): TranscriptionPhrase[] {
  const allPhrases: TranscriptionPhrase[] = [];
  
  /**
   * Get max characters based on text content (CJK vs Latin)
   */
  const getMaxChars = (text: string): number => {
    return CJK_PATTERN.test(text) 
      ? SUBTITLE_CONFIG.maxCharsCJK 
      : SUBTITLE_CONFIG.maxCharsLatin;
  };
  
  for (const utterance of utterances) {
    // Skip empty utterances
    if (!utterance.words || utterance.words.length === 0) continue;
    
    // Preprocess words to fix punctuation placement
    const processedWords = preprocessWords(utterance.words);
    if (processedWords.length === 0) continue;
    
    // Build text from processed words
    const rawText = processedWords
      .map(w => w.punctuated_word || w.word)
      .join(' ')
      .trim();
    
    // Clean CJK text (remove unnecessary spaces)
    const text = cleanCJKText(rawText);
    
    // Skip empty or punctuation-only utterances
    if (text.length === 0 || PUNCTUATION_ONLY_PATTERN.test(text)) continue;
    
    // Calculate duration
    const duration = utterance.end - utterance.start;
    const maxChars = getMaxChars(text);
    
    // Check if utterance fits within limits
    const fitsCharLimit = text.length <= maxChars;
    const fitsDurationLimit = duration <= SUBTITLE_CONFIG.maxDuration;
    
    if (fitsCharLimit && fitsDurationLimit) {
      // Utterance fits → create single phrase
      allPhrases.push({
        id: `phrase-${allPhrases.length}`,
        start: utterance.start,
        end: utterance.end,
        text,
        confidence: utterance.confidence,
      });
    } else {
      // Utterance too long → split using word-based segmentation
      const subPhrases = buildPhrasesFromWords(processedWords);
      
      // Add sub-phrases with proper IDs and clean CJK text
      for (const subPhrase of subPhrases) {
        allPhrases.push({
          ...subPhrase,
          id: `phrase-${allPhrases.length}`,
          text: cleanCJKText(subPhrase.text),
        });
      }
    }
  }
  
  // Merge phrases that were over-split (contiguous phrases without sentence-ending punctuation)
  let result = mergeContiguousPhrases(allPhrases);
  
  // Fix punctuation at start of phrases (move to end of previous phrase)
  result = fixLeadingPunctuation(result);
  
  return result;
}

/**
 * Merge contiguous phrases that should be together
 * 
 * This handles cases where buildPhrasesFromWords over-splits an utterance.
 * Merges when:
 * 1. Phrases are contiguous (gap ≤ 0, i.e., end time = start time)
 * 2. Previous phrase does NOT end with sentence-ending punctuation
 * 3. Merged result respects limits (chars, duration)
 */
function mergeContiguousPhrases(phrases: TranscriptionPhrase[]): TranscriptionPhrase[] {
  if (phrases.length < 2) return phrases;
  
  const getMaxChars = (text: string): number => {
    return CJK_PATTERN.test(text) 
      ? SUBTITLE_CONFIG.maxCharsCJK 
      : SUBTITLE_CONFIG.maxCharsLatin;
  };
  
  const shouldMerge = (prev: TranscriptionPhrase, curr: TranscriptionPhrase): boolean => {
    // Must be contiguous (no gap or overlapping)
    const gap = curr.start - prev.end;
    if (gap > 0.05) return false; // Allow tiny gap (50ms) for timing imprecision
    
    // Previous phrase must NOT end with sentence-ending punctuation
    // If it ends with punctuation, it's a complete sentence
    if (SENTENCE_END_PATTERN.test(prev.text)) return false;
    
    // Check merged result respects limits
    const mergedText = prev.text + curr.text; // No space for CJK
    const mergedDuration = curr.end - prev.start;
    const maxChars = getMaxChars(mergedText);
    
    if (mergedText.length > maxChars) return false;
    if (mergedDuration > SUBTITLE_CONFIG.maxDuration) return false;
    
    return true;
  };
  
  const merge = (prev: TranscriptionPhrase, curr: TranscriptionPhrase): TranscriptionPhrase => {
    const isCJK = CJK_PATTERN.test(prev.text) || CJK_PATTERN.test(curr.text);
    return {
      id: prev.id,
      start: prev.start,
      end: curr.end,
      text: isCJK ? prev.text + curr.text : prev.text + ' ' + curr.text,
      confidence: (prev.confidence + curr.confidence) / 2,
    };
  };
  
  // Perform merging passes until no more merges
  let result = [...phrases];
  let merged = true;
  
  while (merged) {
    merged = false;
    const newResult: TranscriptionPhrase[] = [];
    
    let i = 0;
    while (i < result.length) {
      const current = result[i];
      const next = result[i + 1];
      
      if (next && shouldMerge(current, next)) {
        newResult.push(merge(current, next));
        merged = true;
        i += 2;
      } else {
        newResult.push(current);
        i += 1;
      }
    }
    
    result = newResult;
  }
  
  // Re-assign IDs
  return result.map((phrase, idx) => ({
    ...phrase,
    id: `phrase-${idx}`,
  }));
}

/**
 * Build phrases from words with intelligent segmentation
 * 
 * Segmentation rules (creates new subtitle when):
 * 1. Speaker changes (diarization)
 * 2. Sentence ends (multilingual punctuation)
 * 3. Long pause between words (> pauseThreshold)
 * 4. Maximum duration exceeded (> maxDuration seconds)
 * 5. Maximum character count exceeded (dynamic: CJK vs Latin)
 * 6. End of words array
 * 
 * Also filters out punctuation-only "words" that Deepgram sometimes returns
 */
function buildPhrasesFromWords(words: DeepgramWord[]): TranscriptionPhrase[] {
  const phrases: TranscriptionPhrase[] = [];
  let currentWords: DeepgramWord[] = [];
  let currentText = '';
  let currentSpeaker: number | undefined;
  
  /**
   * Get max characters based on text content (CJK vs Latin)
   */
  const getMaxChars = (text: string): number => {
    return CJK_PATTERN.test(text) 
      ? SUBTITLE_CONFIG.maxCharsCJK 
      : SUBTITLE_CONFIG.maxCharsLatin;
  };
  
  /**
   * Finalize current phrase and add to results
   */
  const finalizePhrase = () => {
    if (currentWords.length === 0) return;
    
    const text = currentWords
      .map(w => w.punctuated_word || w.word)
      .join(' ')
      .trim();
    
    // Skip empty phrases or phrases that are only punctuation
    if (text.length === 0 || PUNCTUATION_ONLY_PATTERN.test(text)) return;
    
    phrases.push({
      id: `phrase-${phrases.length}`,
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text,
      confidence: currentWords.reduce((s, w) => s + w.confidence, 0) / currentWords.length,
    });
    
    currentWords = [];
    currentText = '';
  };
  
  /**
   * Get text length of current phrase + new word
   */
  const getTextLengthWithWord = (word: DeepgramWord): number => {
    const wordText = word.punctuated_word || word.word;
    return currentText.length === 0 
      ? wordText.length 
      : currentText.length + 1 + wordText.length; // +1 for space
  };
  
  /**
   * Get duration of current phrase + new word
   */
  const getDurationWithWord = (word: DeepgramWord): number => {
    if (currentWords.length === 0) return 0;
    return word.end - currentWords[0].start;
  };
  
  /**
   * Find best split point in current words (at clause break if possible)
   */
  const findClauseBreakIndex = (): number => {
    // Search backwards for a clause break
    for (let i = currentWords.length - 1; i >= 0; i--) {
      const wordText = currentWords[i].punctuated_word || currentWords[i].word;
      if (CLAUSE_BREAK_PATTERN.test(wordText)) {
        return i;
      }
    }
    return -1;
  };
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const nextWord = words[i + 1];
    const wordText = word.punctuated_word || word.word;
    
    // Skip words that are only punctuation
    if (PUNCTUATION_ONLY_PATTERN.test(wordText)) {
      continue;
    }
    
    // Check if we need to split BEFORE adding this word
    const textLengthWithWord = getTextLengthWithWord(word);
    const durationWithWord = getDurationWithWord(word);
    
    // Check for speaker change (split before the new speaker starts)
    const hasSpeakerChange = currentWords.length > 0 && 
      word.speaker !== undefined && 
      currentSpeaker !== undefined && 
      word.speaker !== currentSpeaker;
    
    // Check if adding this word would exceed limits (dynamic based on content)
    const maxChars = getMaxChars(currentText + wordText);
    const wouldExceedChars = textLengthWithWord > maxChars;
    const wouldExceedDuration = durationWithWord > SUBTITLE_CONFIG.maxDuration;
    
    // If limits would be exceeded, finalize current phrase first
    if (hasSpeakerChange || wouldExceedChars || wouldExceedDuration) {
      // Try to find a better split point at a clause break
      if (currentWords.length > 1 && !hasSpeakerChange) {
        const clauseBreakIdx = findClauseBreakIndex();
        if (clauseBreakIdx > 0 && clauseBreakIdx < currentWords.length - 1) {
          // Split at clause break: finalize first part
          const wordsBeforeBreak = currentWords.slice(0, clauseBreakIdx + 1);
          const wordsAfterBreak = currentWords.slice(clauseBreakIdx + 1);
          
          // Finalize the first part
          const text = wordsBeforeBreak
            .map(w => w.punctuated_word || w.word)
            .join(' ')
            .trim();
          
          if (text.length > 0 && !PUNCTUATION_ONLY_PATTERN.test(text)) {
            phrases.push({
              id: `phrase-${phrases.length}`,
              start: wordsBeforeBreak[0].start,
              end: wordsBeforeBreak[wordsBeforeBreak.length - 1].end,
              text,
              confidence: wordsBeforeBreak.reduce((s, w) => s + w.confidence, 0) / wordsBeforeBreak.length,
            });
          }
          
          // Continue with remaining words + current word
          currentWords = wordsAfterBreak;
          currentText = currentWords.map(w => w.punctuated_word || w.word).join(' ');
        } else {
          // No good clause break, just finalize current phrase
          finalizePhrase();
        }
      } else {
        // Finalize current phrase
        finalizePhrase();
      }
    }
    
    // Add word to current phrase
    currentWords.push(word);
    currentText = currentWords.map(w => w.punctuated_word || w.word).join(' ');
    currentSpeaker = word.speaker;
    
    // Check if we should finalize AFTER adding this word
    const isSentenceEnd = SENTENCE_END_PATTERN.test(wordText);
    const hasLongPause = nextWord && (nextWord.start - word.end) > SUBTITLE_CONFIG.pauseThreshold;
    const isLastWord = !nextWord;
    
    // Also check for speaker change on next word
    const nextSpeakerDifferent = nextWord && 
      nextWord.speaker !== undefined && 
      word.speaker !== undefined && 
      nextWord.speaker !== word.speaker;
    
    if (isSentenceEnd || hasLongPause || isLastWord || nextSpeakerDifferent) {
      finalizePhrase();
    }
  }
  
  // Finalize any remaining words
  finalizePhrase();
  
  return phrases;
}

/**
 * Merge phrases that were falsely segmented due to diarization errors
 * 
 * Detection criteria for false segmentation:
 * 1. Gap between phrases is very short (< mergeGapThreshold) - quasi-contiguous
 * 2. Previous phrase does NOT end with sentence-ending punctuation (incomplete sentence)
 * 3. Merged result would still respect limits (maxChars, maxDuration)
 * 
 * The key insight: if the previous phrase doesn't end with punctuation,
 * it's likely an incomplete sentence that was split due to diarization errors.
 */
function mergeFalselySegmentedPhrases(phrases: TranscriptionPhrase[]): TranscriptionPhrase[] {
  if (phrases.length < 2) return phrases;
  
  /**
   * Get max characters based on text content (CJK vs Latin)
   */
  const getMaxChars = (text: string): number => {
    return CJK_PATTERN.test(text) 
      ? SUBTITLE_CONFIG.maxCharsCJK 
      : SUBTITLE_CONFIG.maxCharsLatin;
  };
  
  /**
   * Check if two phrases should be merged (false segmentation detected)
   */
  const shouldMerge = (prev: TranscriptionPhrase, curr: TranscriptionPhrase): boolean => {
    // 1. Gap must be very short (quasi-contiguous timing)
    const gap = curr.start - prev.end;
    if (gap > SUBTITLE_CONFIG.mergeGapThreshold) return false;
    
    // 2. Previous phrase must NOT end with sentence-ending punctuation
    // If it ends with punctuation, it's a complete sentence - don't merge
    if (SENTENCE_END_PATTERN.test(prev.text)) return false;
    
    // 3. Check that merged result respects limits
    const mergedText = prev.text + ' ' + curr.text;
    const mergedDuration = curr.end - prev.start;
    const maxChars = getMaxChars(mergedText);
    
    if (mergedText.length > maxChars) return false;
    if (mergedDuration > SUBTITLE_CONFIG.maxDuration) return false;
    
    return true;
  };
  
  /**
   * Merge two phrases into one
   */
  const merge = (prev: TranscriptionPhrase, curr: TranscriptionPhrase): TranscriptionPhrase => {
    return {
      id: prev.id, // Keep the first phrase's ID
      start: prev.start,
      end: curr.end,
      text: prev.text + ' ' + curr.text,
      confidence: (prev.confidence + curr.confidence) / 2,
    };
  };
  
  // Perform merging passes until no more merges are needed
  let result = [...phrases];
  let merged = true;
  
  while (merged) {
    merged = false;
    const newResult: TranscriptionPhrase[] = [];
    
    let i = 0;
    while (i < result.length) {
      const current = result[i];
      const next = result[i + 1];
      
      if (next && shouldMerge(current, next)) {
        // Merge and add to result
        newResult.push(merge(current, next));
        merged = true;
        i += 2; // Skip both phrases
      } else {
        newResult.push(current);
        i += 1;
      }
    }
    
    result = newResult;
  }
  
  // Re-assign IDs to maintain sequential order
  return result.map((phrase, idx) => ({
    ...phrase,
    id: `phrase-${idx}`,
  }));
}

// ============================================================================
// OUTPUT FORMATTERS
// ============================================================================

/**
 * Format timestamp for SRT (HH:MM:SS,mmm)
 */
function formatSRTTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Format timestamp for VTT (HH:MM:SS.mmm)
 */
function formatVTTTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * Format duration for display
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Convert transcription result to SRT format
 */
export function formatToSRT(result: DeepgramResult): string {
  return result.phrases
    .map((phrase, idx) => {
      const startTime = formatSRTTimestamp(phrase.start);
      const endTime = formatSRTTimestamp(phrase.end);
      return `${idx + 1}\n${startTime} --> ${endTime}\n${phrase.text}\n`;
    })
    .join('\n');
}

/**
 * Convert transcription result to VTT format
 */
export function formatToVTT(result: DeepgramResult): string {
  const header = 'WEBVTT\n\n';
  const cues = result.phrases
    .map((phrase) => {
      const startTime = formatVTTTimestamp(phrase.start);
      const endTime = formatVTTTimestamp(phrase.end);
      return `${startTime} --> ${endTime}\n${phrase.text}\n`;
    })
    .join('\n');
  
  return header + cues;
}

/**
 * Convert transcription result to JSON format
 */
export function formatToJSON(result: DeepgramResult): TranscriptionJSONOutput {
  return {
    duration: result.duration,
    language: result.language,
    confidence: result.confidence,
    phrases: result.phrases.map(p => ({
      start: p.start,
      end: p.end,
      text: p.text,
      confidence: p.confidence,
    })),
  };
}

/**
 * Get formatted output based on format type
 */
export function getFormattedOutput(
  result: DeepgramResult, 
  format: TranscriptionOutputFormat
): string {
  switch (format) {
    case 'srt':
      return formatToSRT(result);
    case 'vtt':
      return formatToVTT(result);
    case 'json':
      return JSON.stringify(formatToJSON(result), null, 2);
    default:
      return formatToSRT(result);
  }
}

/**
 * Get file extension for format
 */
export function getFormatExtension(format: TranscriptionOutputFormat): string {
  return format;
}
