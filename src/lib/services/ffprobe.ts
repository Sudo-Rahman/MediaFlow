import { invoke } from '@tauri-apps/api/core';
import type { VideoFile, Track, FFprobeOutput, FFprobeStream } from '$lib/types';
import { getFileName } from '$lib/utils/format';
import { log } from '$lib/utils/log-toast';

/**
 * Default concurrency limit for parallel file scanning
 */
const DEFAULT_SCAN_CONCURRENCY = 2;

const DEFAULT_VIDEO_BIT_DEPTH = 8;

function parseBitDepth(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePixelFormatBitDepth(pixelFormat: string | undefined): number | undefined {
  if (!pixelFormat) return undefined;

  const normalized = pixelFormat.toLowerCase();

  if (normalized === 'monow' || normalized === 'monob') {
    return 1;
  }

  const planarMatch = normalized.match(/p(9|10|12|14|16)(?:le|be)?$/);
  if (planarMatch) {
    return parseBitDepth(planarMatch[1]);
  }

  const semiPlanarMatch = normalized.match(/^p(?:0|2|4)(10|12|16)(?:le|be)?$/);
  if (semiPlanarMatch) {
    return parseBitDepth(semiPlanarMatch[1]);
  }

  const grayMatch = normalized.match(/^gray(9|10|12|14|16)(?:le|be)?$/);
  if (grayMatch) {
    return parseBitDepth(grayMatch[1]);
  }

  const packedRgbMatch = normalized.match(/^(?:x2rgb|x2bgr|y210|y212|y216|rgba64|bgra64|rgb48|bgr48)(?:le|be)?$/);
  if (packedRgbMatch) {
    if (normalized.includes('210') || normalized.includes('x2')) return 10;
    if (normalized.includes('212')) return 12;
    if (normalized.includes('216') || normalized.includes('64') || normalized.includes('48')) return 16;
  }

  return undefined;
}

function parseSampleFormatBitDepth(sampleFormat: string | undefined): number | undefined {
  if (!sampleFormat) return undefined;

  const normalized = sampleFormat.toLowerCase();
  const integerMatch = normalized.match(/^[us](8|16|24|32|64)p?$/);
  if (integerMatch) {
    return parseBitDepth(integerMatch[1]);
  }

  return undefined;
}

export function parseDerivedBitDepth(stream: FFprobeStream): number | undefined {
  const explicit = parseBitDepth(stream.bits_per_raw_sample);
  if (explicit) {
    return explicit;
  }

  const pixelFormatBitDepth = parsePixelFormatBitDepth(stream.pix_fmt);
  if (pixelFormatBitDepth) {
    return pixelFormatBitDepth;
  }

  const sampleFormatBitDepth = parseSampleFormatBitDepth(stream.sample_fmt);
  if (sampleFormatBitDepth) {
    return sampleFormatBitDepth;
  }

  if (stream.codec_type === 'video' && stream.pix_fmt) {
    return DEFAULT_VIDEO_BIT_DEPTH;
  }

  return undefined;
}

function firstNonEmptyTagValue(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

/**
 * Parse FFprobe output and convert to our Track format
 */
function parseStream(stream: FFprobeStream): Track | null {
  const type = stream.codec_type as Track['type'];

  // Skip unsupported types
  if (!['video', 'audio', 'subtitle', 'data'].includes(type)) {
    return null;
  }

  const track: Track = {
    id: stream.index,
    index: stream.index,
    type,
    codec: stream.codec_name,
    codecLong: stream.codec_long_name,
    profile: stream.profile,
    level: stream.level,
    language: stream.tags?.language,
    title: firstNonEmptyTagValue(stream.tags?.title, stream.tags?.name),
    bitrate: stream.bit_rate ? parseInt(stream.bit_rate) : 
             stream.tags?.BPS ? parseInt(stream.tags.BPS) :
             stream.tags?.["BPS-eng"] ? parseInt(stream.tags["BPS-eng"]) : undefined,
    size: stream.tags?.NUMBER_OF_BYTES ? parseInt(stream.tags.NUMBER_OF_BYTES) : undefined,
    numberOfFrames: stream.tags?.NUMBER_OF_FRAMES ? parseInt(stream.tags.NUMBER_OF_FRAMES) : undefined,
    default: stream.disposition?.default === 1,
    forced: stream.disposition?.forced === 1,
    bitsPerRawSample: stream.bits_per_raw_sample ? parseInt(stream.bits_per_raw_sample, 10) : undefined,
    derivedBitDepth: parseDerivedBitDepth(stream),
  };

  // Video specific
  if (type === 'video') {
    if (stream.width && stream.height) {
      track.width = stream.width;
      track.height = stream.height;
      track.resolution = `${stream.width}×${stream.height}`;
    }
    track.frameRate = stream.r_frame_rate;
    track.pixelFormat = stream.pix_fmt;
    track.colorRange = stream.color_range;
    track.colorSpace = stream.color_space;
    track.colorTransfer = stream.color_transfer;
    track.colorPrimaries = stream.color_primaries;
    track.aspectRatio = stream.display_aspect_ratio;
  }

  // Audio specific
  if (type === 'audio') {
    track.channels = stream.channels;
    track.sampleRate = stream.sample_rate ? parseInt(stream.sample_rate) : undefined;
    track.sampleFormat = stream.sample_fmt;
    track.channelLayout = stream.channel_layout;
  }

  return track;
}

/**
 * Scan a video file using ffprobe (via Tauri command)
 */
export async function scanFile(filePath: string): Promise<ScannedFile> {
  const name = getFileName(filePath);

  try {
    // Call Rust command to execute ffprobe
    const result = await invoke<string>('probe_file', { path: filePath });
    const ffprobeOutput: FFprobeOutput = JSON.parse(result);

    const tracks: Track[] = ffprobeOutput.streams
      .map(parseStream)
      .filter((t): t is Track => t !== null);

    const duration = ffprobeOutput.format.duration
      ? parseFloat(ffprobeOutput.format.duration)
      : undefined;

    const size = ffprobeOutput.format.size
      ? parseInt(ffprobeOutput.format.size)
      : 0;

    const bitrate = ffprobeOutput.format.bit_rate
      ? parseInt(ffprobeOutput.format.bit_rate)
      : undefined;

    const format = ffprobeOutput.format.format_long_name || ffprobeOutput.format.format_name;

    return {
      path: filePath,
      name,
      size,
      duration,
      tracks,
      status: 'ready',
      rawData: ffprobeOutput,
      format,
      bitrate
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Log error
    log('error', 'ffprobe', `Failed to scan: ${name}`,
      `FFprobe failed to analyze file ${name}: ${errorMessage}`,
      {
        filePath,
        command: `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`
      }
    );

    return {
      path: filePath,
      name,
      size: 0,
      tracks: [],
      status: 'error',
      error: errorMessage
    };
  }
}

/**
 * Extended VideoFile with additional metadata from ffprobe
 */
export type ScannedFile = VideoFile & { 
  rawData?: any; 
  format?: string; 
  bitrate?: number;
};

/**
 * Split array into chunks of specified size
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Scan multiple files with parallel processing
 * @param filePaths - Array of file paths to scan
 * @param concurrency - Maximum number of concurrent scans (default: 3)
 * @param onProgress - Optional callback for progress updates
 */
export async function scanFiles(
  filePaths: string[],
  concurrency: number = DEFAULT_SCAN_CONCURRENCY,
  onProgress?: (completed: number, total: number) => void
): Promise<ScannedFile[]> {
  if (filePaths.length === 0) return [];
  
  const results: ScannedFile[] = [];
  const batches = chunk(filePaths, concurrency);
  let completed = 0;
  
  for (const batch of batches) {
    // Process each batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (path) => {
        const file = await scanFile(path);
        completed++;
        onProgress?.(completed, filePaths.length);
        return file;
      })
    );
    
    results.push(...batchResults);
  }
  
  return results;
}
