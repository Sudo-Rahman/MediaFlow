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
    bitrate: stream.bit_rate ? parseInt(stream.bit_rate) : stream.tags?.["BPS-eng"] ? parseInt(stream.tags["BPS-eng"]) : undefined,
    default: stream.disposition?.default === 1,
    forced: stream.disposition?.forced === 1,
  };

  // Video specific
  if (type === 'video' && stream.width && stream.height) {
    track.width = stream.width;
    track.height = stream.height;
    track.resolution = `${stream.width}×${stream.height}`;
    track.frameRate = stream.r_frame_rate;
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
export async function scanFile(filePath: string): Promise<VideoFile> {
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

    return {
      path: filePath,
      name,
      size,
      duration,
      tracks,
      status: 'ready'
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

