import { invoke } from '@tauri-apps/api/core';
import type { VideoFile, Track, FFprobeOutput, FFprobeStream } from '$lib/types';
import { getFileName } from '$lib/utils/format';

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
    language: stream.tags?.language,
    title: stream.tags?.title,
    bitrate: stream.bit_rate ? parseInt(stream.bit_rate) : 
             stream.tags?.BPS ? parseInt(stream.tags.BPS) :
             stream.tags?.["BPS-eng"] ? parseInt(stream.tags["BPS-eng"]) : undefined,
    size: stream.tags?.NUMBER_OF_BYTES ? parseInt(stream.tags.NUMBER_OF_BYTES) : undefined,
    numberOfFrames: stream.tags?.NUMBER_OF_FRAMES ? parseInt(stream.tags.NUMBER_OF_FRAMES) : undefined,
    default: stream.disposition?.default === 1,
    forced: stream.disposition?.forced === 1,
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
    track.aspectRatio = stream.display_aspect_ratio;
  }

  // Audio specific
  if (type === 'audio') {
    track.channels = stream.channels;
    track.sampleRate = stream.sample_rate ? parseInt(stream.sample_rate) : undefined;
  }

  return track;
}

/**
 * Scan a video file using ffprobe (via Tauri command)
 */
export async function scanFile(filePath: string): Promise<VideoFile & { rawData?: any; format?: string; bitrate?: number }> {
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
    console.error('FFprobe error:', error);
    return {
      path: filePath,
      name,
      size: 0,
      tracks: [],
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Scan multiple files
 */
export async function scanFiles(filePaths: string[]): Promise<VideoFile[]> {
  const results: VideoFile[] = [];

  for (const path of filePaths) {
    const file = await scanFile(path);
    results.push(file);
  }

  return results;
}

