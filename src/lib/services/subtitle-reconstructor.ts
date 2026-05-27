/**
 * Subtitle Reconstructor Module
 * Reconstructs subtitle files from translated cues
 */

import type {
  Cue,
  ParsedSubtitle,
  TranslatedCue,
  ValidationResult,
  ValidationError
} from '$lib/types/subtitle';

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate that translated cues match original cues
 */
export function validateTranslation(
  originalCues: Cue[],
  translatedCues: TranslatedCue[]
): ValidationResult {
  const errors: ValidationError[] = [];

  // Create maps for faster lookup
  const originalMap = new Map(originalCues.map(c => [c.id, c]));
  const translatedMap = new Map(translatedCues.map(c => [c.id, c]));

  // Check for missing IDs in translation
  for (const original of originalCues) {
    if (!translatedMap.has(original.id)) {
      errors.push({
        cueId: original.id,
        type: 'missing_id',
        message: `Cue "${original.id}" is missing from translation`
      });
    }
  }

  // Check for extra IDs in translation
  for (const translated of translatedCues) {
    if (!originalMap.has(translated.id)) {
      errors.push({
        cueId: translated.id,
        type: 'extra_id',
        message: `Cue "${translated.id}" was not in original`
      });
    }
  }

  // Validate placeholders for each translated cue
  for (const translated of translatedCues) {
    const original = originalMap.get(translated.id);
    if (!original) continue;

    // Extract placeholders from translated text
    const translatedPlaceholders = extractPlaceholders(translated.translatedText);
    const originalPlaceholders = extractPlaceholders(original.textSkeleton);

    // Check count
    if (translatedPlaceholders.length !== originalPlaceholders.length) {
      errors.push({
        cueId: translated.id,
        type: 'placeholder_mismatch',
        message: `Placeholder count mismatch: expected ${originalPlaceholders.length}, got ${translatedPlaceholders.length}`,
        expected: originalPlaceholders.join(', '),
        received: translatedPlaceholders.join(', ')
      });
      continue;
    }

    // Check that same placeholders are present (order can vary for some cases)
    const originalSet = new Set(originalPlaceholders);
    const translatedSet = new Set(translatedPlaceholders);

    for (const token of originalPlaceholders) {
      if (!translatedSet.has(token)) {
        errors.push({
          cueId: translated.id,
          type: 'placeholder_mismatch',
          message: `Missing placeholder: ${token}`,
          expected: originalPlaceholders.join(', '),
          received: translatedPlaceholders.join(', ')
        });
      }
    }

    for (const token of translatedPlaceholders) {
      if (!originalSet.has(token)) {
        errors.push({
          cueId: translated.id,
          type: 'placeholder_mismatch',
          message: `Unexpected placeholder: ${token}`,
          expected: originalPlaceholders.join(', '),
          received: translatedPlaceholders.join(', ')
        });
      }
    }

    if (
      requiresExactPlaceholderOrder(original)
      && translatedPlaceholders.some((token, index) => token !== originalPlaceholders[index])
    ) {
      errors.push({
        cueId: translated.id,
        type: 'placeholder_order',
        message: 'ASS/SSA placeholder order changed',
        expected: originalPlaceholders.join(', '),
        received: translatedPlaceholders.join(', ')
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Extract placeholder tokens from text
 */
function extractPlaceholders(text: string): string[] {
  const regex = /⟦[A-Z]+_\d+⟧/g;
  return text.match(regex) || [];
}

function requiresExactPlaceholderOrder(cue: Cue): boolean {
  return cue.format === 'ass' || cue.format === 'ssa';
}

/**
 * Restore placeholders in translated text with original content
 */
function restorePlaceholders(translatedText: string, originalCue: Cue): string {
  let result = translatedText;

  for (const placeholder of originalCue.placeholders) {
    result = result.replace(placeholder.token, placeholder.original);
  }

  return result;
}

function formatAssPlainText(text: string): string {
  return text.replace(/\r\n?|\n/g, '\\N');
}

// ============================================================================
// TIME FORMATTING
// ============================================================================

/**
 * Format milliseconds to SRT timestamp (HH:MM:SS,mmm)
 */
function formatSRTTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
}

/**
 * Format milliseconds to VTT timestamp (HH:MM:SS.mmm or MM:SS.mmm)
 */
function formatVTTTime(ms: number, useHours = true): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;

  if (useHours || hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

// ============================================================================
// SRT RECONSTRUCTION
// ============================================================================

/**
 * Reconstruct SRT file from translated cues
 */
export function reconstructSRT(
  parsed: ParsedSubtitle,
  translatedCues: TranslatedCue[]
): string {
  const translatedMap = new Map(translatedCues.map(c => [c.id, c]));
  const lines: string[] = [];

  for (const cue of parsed.cues) {
    const translated = translatedMap.get(cue.id);

    // Use translated text or fall back to original
    let finalText: string;
    if (translated) {
      finalText = restorePlaceholders(translated.translatedText, cue);
    } else {
      finalText = cue.textOriginal;
    }

    // Reconstruct cue block
    lines.push(String(cue.index));
    lines.push(`${formatSRTTime(cue.startMs)} --> ${formatSRTTime(cue.endMs)}`);
    lines.push(finalText);
    lines.push(''); // Empty line separator
  }

  return lines.join('\n');
}

// ============================================================================
// VTT RECONSTRUCTION
// ============================================================================

/**
 * Reconstruct VTT file from translated cues
 */
export function reconstructVTT(
  parsed: ParsedSubtitle,
  translatedCues: TranslatedCue[]
): string {
  const translatedMap = new Map(translatedCues.map(c => [c.id, c]));
  const lines: string[] = [];

  // Add header
  lines.push(parsed.header.trim());
  lines.push('');

  for (const cue of parsed.cues) {
    const translated = translatedMap.get(cue.id);

    // Use translated text or fall back to original
    let finalText: string;
    if (translated) {
      finalText = restorePlaceholders(translated.translatedText, cue);
    } else {
      finalText = cue.textOriginal;
    }

    // Add cue ID if it was present and not auto-generated
    if (cue.id && !cue.id.startsWith('VTT_')) {
      lines.push(cue.id);
    }

    // Timing line with optional settings
    const timingLine = `${formatVTTTime(cue.startMs)} --> ${formatVTTTime(cue.endMs)}${cue.rawSuffix ? ' ' + cue.rawSuffix : ''}`;
    lines.push(timingLine);

    // Text
    lines.push(finalText);
    lines.push(''); // Empty line separator
  }

  return lines.join('\n');
}

// ============================================================================
// ASS/SSA RECONSTRUCTION
// ============================================================================

interface SourceLineSegment {
  line: string;
  lineEnding: string;
}

function splitLinesPreservingEndings(content: string): SourceLineSegment[] {
  const segments: SourceLineSegment[] = [];
  let start = 0;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char !== '\r' && char !== '\n') {
      continue;
    }

    const line = content.slice(start, i);
    let lineEnding = char;

    if (char === '\r' && content[i + 1] === '\n') {
      lineEnding = '\r\n';
      i++;
    }

    segments.push({ line, lineEnding });
    start = i + 1;
  }

  segments.push({ line: content.slice(start), lineEnding: '' });
  return segments;
}

/**
 * Reconstruct ASS/SSA file from translated cues
 */
export function reconstructASS(
  parsed: ParsedSubtitle,
  translatedCues: TranslatedCue[],
  originalContent: string
): string {
  const translatedMap = new Map(translatedCues.map(c => [c.id, c]));
  const cueByLineIndex = new Map<number, Cue>();

  for (const cue of parsed.cues) {
    if (cue.sourceLineIndex !== undefined) {
      cueByLineIndex.set(cue.sourceLineIndex, cue);
    }
  }

  return splitLinesPreservingEndings(originalContent)
    .map((segment, lineIndex) => {
      const cue = cueByLineIndex.get(lineIndex);
      if (!cue) {
        return segment.line + segment.lineEnding;
      }

      const translated = translatedMap.get(cue.id);
      const finalText = translated
        ? formatCueTextForReconstruction(restorePlaceholders(translated.translatedText, cue), cue)
        : cue.textOriginal;

      return `${cue.rawPrefix ?? ''}${finalText}${segment.lineEnding}`;
    })
    .join('');
}

function formatCueTextForReconstruction(text: string, cue: Cue): string {
  if ((cue.format === 'ass' || cue.format === 'ssa') && cue.assTextMode === 'plain') {
    return formatAssPlainText(text);
  }

  return text;
}

// ============================================================================
// MAIN RECONSTRUCTOR
// ============================================================================

/**
 * Reconstruct subtitle file from translated cues
 */
export function reconstructSubtitle(
  parsed: ParsedSubtitle,
  translatedCues: TranslatedCue[],
  originalContent: string
): { content: string; validation: ValidationResult } {
  // Validate first
  const validation = validateTranslation(parsed.cues, translatedCues);

  // Reconstruct based on format
  let content: string;

  switch (parsed.format) {
    case 'srt':
      content = reconstructSRT(parsed, translatedCues);
      break;
    case 'vtt':
      content = reconstructVTT(parsed, translatedCues);
      break;
    case 'ass':
    case 'ssa':
      content = reconstructASS(parsed, translatedCues, originalContent);
      break;
    default:
      content = originalContent;
  }

  return { content, validation };
}
