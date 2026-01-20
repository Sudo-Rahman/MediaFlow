// Types partagés pour les pistes multimédia

export type TrackType = 'subtitle' | 'audio' | 'video' | 'data';

export interface Track {
  id: number;
  index: number;
  type: TrackType;
  codec: string;
  codecLong?: string;
  language?: string;
  title?: string;
  bitrate?: number;
  size?: number;
  numberOfFrames?: number;
  // Video specific
  resolution?: string;
  width?: number;
  height?: number;
  frameRate?: string;
  pixelFormat?: string;
  colorRange?: string;
  colorSpace?: string;
  aspectRatio?: string;
  // Audio specific
  channels?: number;
  sampleRate?: number;
  // Subtitle specific
  forced?: boolean;
  default?: boolean;
}

export interface VideoFile {
  path: string;
  name: string;
  size: number;
  duration?: number;
  tracks: Track[];
  status: 'pending' | 'scanning' | 'ready' | 'error';
  error?: string;
}

export interface ExtractionConfig {
  outputDir: string;
  selectedTracks: Map<string, number[]>; // [filePath] = [trackIds]
}

export interface ExtractionProgress {
  currentFile: string;
  currentFileIndex: number;
  totalFiles: number;
  currentTrack: number;
  totalTracks: number;
  status: 'idle' | 'extracting' | 'completed' | 'error';
  error?: string;
}

export interface ExtractionResult {
  filePath: string;
  trackId: number;
  outputPath: string;
  success: boolean;
  error?: string;
}

// FFprobe JSON output types
export interface FFprobeStream {
  index: number;
  codec_name: string;
  codec_long_name?: string;
  codec_type: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  level?: number;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  sample_aspect_ratio?: string;
  display_aspect_ratio?: string;
  disposition?: {
    default?: number;
    forced?: number;
  };
  tags?: {
    language?: string;
    title?: string;
    // bitrate in tags can sometimes be present
    "BPS-eng"?: string;
    BPS?: string;
    DURATION?: string;
    NUMBER_OF_FRAMES?: string;
    NUMBER_OF_BYTES?: string;
  };
}

export interface FFprobeFormat {
  filename: string;
  format_name?: string;
  format_long_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
}

export interface FFprobeOutput {
  streams: FFprobeStream[];
  format: FFprobeFormat;
}

// Codec to extension mapping
export const codecExtensions: Record<string, string> = {
  // Subtitles
  ass: '.ass',
  ssa: '.ssa',
  subrip: '.srt',
  srt: '.srt',
  webvtt: '.vtt',
  mov_text: '.srt',
  dvd_subtitle: '.sub',
  hdmv_pgs_subtitle: '.sup',
  pgs: '.sup',
  // Audio
  aac: '.aac',
  ac3: '.ac3',
  eac3: '.eac3',
  dts: '.dts',
  mp3: '.mp3',
  flac: '.flac',
  opus: '.opus',
  vorbis: '.ogg',
  pcm_s16le: '.wav',
  pcm_s24le: '.wav',
  truehd: '.thd',
  // Video
  h264: '.mp4',
  hevc: '.mp4',
  h265: '.mp4',
  vp9: '.webm',
  av1: '.mp4',
  mpeg4: '.mp4',
};

export function getExtensionForCodec(codec: string): string {
  return codecExtensions[codec.toLowerCase()] || `.${codec}`;
}

