// Shared types for multimedia tracks

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

// ============================================================================
// CODEC TO EXTENSION MAPPING
// Single source of truth for all codec/extension mappings
// ============================================================================

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
  mp2: '.mp2',
  flac: '.flac',
  opus: '.opus',
  vorbis: '.ogg',
  truehd: '.thd',
  alac: '.m4a',
  wavpack: '.wv',
  mlp: '.mlp',
  
  // PCM variants - all map to .wav
  pcm_s16le: '.wav',
  pcm_s24le: '.wav',
  pcm_s32le: '.wav',
  pcm_s16be: '.wav',
  pcm_s24be: '.wav',
  pcm_s32be: '.wav',
  pcm_u8: '.wav',
  pcm_u16le: '.wav',
  pcm_u24le: '.wav',
  pcm_u32le: '.wav',
  pcm_u16be: '.wav',
  pcm_u24be: '.wav',
  pcm_u32be: '.wav',
  
  // ADPCM variants
  adpcm_ima_wav: '.wav',
  adpcm_ms: '.wav',
  adpcm_yamaha: '.wav',
  
  // Windows Media Audio (tous map vers .wma)
  wma: '.wma',
  wmav1: '.wma',
  wmav2: '.wma',
  wmapro: '.wma',
  wmavoice: '.wma',
  
  // Video
  h264: '.mp4',
  hevc: '.mp4',
  h265: '.mp4',
  vp9: '.webm',
  av1: '.mp4',
  mpeg4: '.mp4',
  mpeg2video: '.mpg',
  mpeg1video: '.mpg',
};

/**
 * Get file extension for a given codec
 * Fallback: if codec is not mapped, returns .{codec}
 */
export function getExtensionForCodec(codec: string): string {
  return codecExtensions[codec.toLowerCase()] || `.${codec}`;
}

// ============================================================================
// INVERSE MAPPING: Extension to codec (for track import)
// ============================================================================

export const extensionToCodec: Record<string, string> = {
  // Subtitles
  '.ass': 'ass',
  '.ssa': 'ssa',
  '.srt': 'subrip',
  '.sub': 'dvd_subtitle',
  '.vtt': 'webvtt',
  '.sup': 'hdmv_pgs_subtitle',
  
  // Audio
  '.aac': 'aac',
  '.ac3': 'ac3',
  '.eac3': 'eac3',
  '.dts': 'dts',
  '.mp3': 'mp3',
  '.mp2': 'mp2',
  '.flac': 'flac',
  '.opus': 'opus',
  '.ogg': 'vorbis',
  '.wav': 'pcm_s16le', // Défaut vers le plus commun
  '.thd': 'truehd',
  '.m4a': 'alac',
  '.wv': 'wavpack',
  '.mlp': 'mlp',
  '.wma': 'wma',
  
  // Video
  '.mp4': 'h264',
  '.webm': 'vp9',
  '.mpg': 'mpeg2video',
};

/**
 * Get codec from file extension
 * Fallback: if extension is not mapped, returns extension without the dot
 */
export function getCodecFromExtension(ext: string): string {
  const normalized = ext.toLowerCase();
  return extensionToCodec[normalized] || normalized.replace(/^\./, '');
}

