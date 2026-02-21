import { invoke } from '@tauri-apps/api/core';
import type { Track, ExtractionResult } from '$lib/types';
import { getExtensionForCodec } from '$lib/types/media';
import { getFileName } from '$lib/utils/format';
import { log } from '$lib/utils/log-toast';

export interface ExtractTrackParams {
  inputPath: string;
  outputPath: string;
  trackIndex: number;
  trackType: string;
  codec: string;
  durationUs?: number;
}

/**
 * Build output filename for a track
 */
export function buildOutputPath(
  inputPath: string,
  track: Track,
  outputDir: string
): string {
  const baseName = getFileName(inputPath).replace(/\.[^/.]+$/, '');
  const langSuffix = track.language ? `.${track.language}` : '';
  const extension = getExtensionForCodec(track.codec);

  // Format: filename.language.trackX.extension
  return `${outputDir}/${baseName}${langSuffix}.track${track.index}${extension}`;
}

/**
 * Extract a single track from a video file
 */
export async function extractTrack(params: ExtractTrackParams): Promise<ExtractionResult> {
  const fileName = getFileName(params.inputPath);
  
  try {
    await invoke('extract_track', {
      inputPath: params.inputPath,
      outputPath: params.outputPath,
      trackIndex: params.trackIndex,
      trackType: params.trackType,
      codec: params.codec,
      durationUs: params.durationUs,
    });

    // Log success
    log('success', 'ffmpeg', `Track ${params.trackIndex} extracted`, 
      `Successfully extracted ${params.trackType} track ${params.trackIndex} from ${fileName}`,
      {
        filePath: params.inputPath,
        outputPath: params.outputPath,
        trackIndex: params.trackIndex
      }
    );

    return {
      filePath: params.inputPath,
      trackId: params.trackIndex,
      outputPath: params.outputPath,
      success: true
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Log error
    log('error', 'ffmpeg', `Extraction failed: track ${params.trackIndex}`,
      `Failed to extract ${params.trackType} track ${params.trackIndex} from ${fileName}: ${errorMessage}`,
      {
        filePath: params.inputPath,
        outputPath: params.outputPath,
        trackIndex: params.trackIndex,
        command: `ffmpeg -i "${params.inputPath}" -map 0:${params.trackIndex} -c copy "${params.outputPath}"`
      }
    );

    return {
      filePath: params.inputPath,
      trackId: params.trackIndex,
      outputPath: params.outputPath,
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Extract multiple tracks from multiple files
 */
export async function extractTracks(
  extractions: ExtractTrackParams[],
  onProgress?: (current: number, total: number, file: string) => void
): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = [];
  const total = extractions.length;

  for (let i = 0; i < total; i++) {
    const extraction = extractions[i];
    onProgress?.(i + 1, total, extraction.inputPath);

    const result = await extractTrack(extraction);
    results.push(result);
  }

  return results;
}
