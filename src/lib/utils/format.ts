import { getExtensionForCodec } from '$lib/types/media';

/**
 * Format bitrate for display
 */
export function formatBitrate(bitrate?: number): string {
  if (!bitrate) return 'N/A';

  if (bitrate >= 1_000_000) {
    return `${(bitrate / 1_000_000).toFixed(1)} Mbps`;
  }
  if (bitrate >= 1_000) {
    return `${(bitrate / 1_000).toFixed(0)} kbps`;
  }
  return `${bitrate} bps`;
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format transfer rate using adaptive KB/s or MB/s units (decimal base 1000)
 */
export function formatTransferRate(speedBytesPerSec?: number): string {
  if (!speedBytesPerSec || !Number.isFinite(speedBytesPerSec) || speedBytesPerSec <= 0) {
    return '0.0 KB/s';
  }

  if (speedBytesPerSec >= 1_000_000) {
    return `${(speedBytesPerSec / 1_000_000).toFixed(2)} MB/s`;
  }

  return `${(speedBytesPerSec / 1_000).toFixed(1)} KB/s`;
}

/**
 * Format duration in hh:mm:ss
 */
export function formatDuration(seconds?: number): string {
  if (!seconds) return 'N/A';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Get language name from ISO 639-2/B code
 */
const languageNames: Record<string, string> = {
  fra: 'French',
  fre: 'French',
  eng: 'English',
  spa: 'Español',
  ger: 'Deutsch',
  deu: 'Deutsch',
  ita: 'Italiano',
  por: 'Português',
  jpn: '日本語',
  kor: '한국어',
  chi: '中文',
  zho: '中文',
  rus: 'Русский',
  ara: 'العربية',
  hin: 'हिन्दी',
  und: 'Undefined',
};

export function formatLanguage(code?: string): string {
  if (!code) return 'Unknown';
  return languageNames[code.toLowerCase()] || code.toUpperCase();
}

/**
 * Format audio channel count
 */
export function formatChannels(channels?: number): string {
  if (!channels) return 'N/A';

  switch (channels) {
    case 1: return 'Mono';
    case 2: return 'Stereo';
    case 6: return '5.1';
    case 8: return '7.1';
    default: return `${channels}ch`;
  }
}

/**
 * Format video resolution
 */
export function formatResolution(width?: number, height?: number): string {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return 'N/A';

  const standardResolutionLabels: Record<string, string> = {
    '3840x2160': '4K',
    '4096x2160': '4K',
    '2560x1440': '1440p',
    '1920x1080': '1080p',
    '1280x720': '720p',
    '854x480': '480p',
    '852x480': '480p',
    '640x480': '480p',
  };

  const key = `${width}x${height}`;
  const standardLabel = standardResolutionLabels[key];

  if (standardLabel) {
    return `${standardLabel} (${width}×${height})`;
  }

  return `${height}p`;
}

/**
 * Get appropriate icon for track type
 */
export function getTrackTypeIcon(type: string): string {
  switch (type) {
    case 'video': return '🎬';
    case 'audio': return '🔊';
    case 'subtitle': return '💬';
    case 'data': return '📊';
    default: return '📄';
  }
}

/**
 * Extract filename from path
 */
export function getFileName(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path;
}

/**
 * Extract file extension
 */
export function getFileExtension(path: string): string {
  const name = getFileName(path);
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.substring(lastDot) : '';
}

/**
 * Build output filename for extraction
 * Uses centralized mapping from $lib/types/media
 */
export function buildOutputFileName(
  inputPath: string,
  trackId: number,
  trackType: string,
  codec: string,
  language?: string
): string {
  const baseName = getFileName(inputPath).replace(/\.[^/.]+$/, '');
  const langSuffix = language ? `.${language}` : '';
  const trackSuffix = `.track${trackId}`;

  // Import depuis le mapping centralisé
  const extension = getExtensionForCodec(codec);

  return `${baseName}${langSuffix}${trackSuffix}${extension}`;
}
