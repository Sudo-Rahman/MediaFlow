const RESOLVED_BITMAP_URL = /^(?:https?:\/\/|data:|blob:|file:|asset:|tauri:|\/\/)/i;

export function isResolvedSubtitleOcrBitmapUrl(bitmapPath: string): boolean {
  return RESOLVED_BITMAP_URL.test(bitmapPath);
}

export function resolveSubtitleOcrBitmapSrc(
  bitmapPath: string,
  convertLocalFileSrc: (path: string) => string,
): string {
  return isResolvedSubtitleOcrBitmapUrl(bitmapPath)
    ? bitmapPath
    : convertLocalFileSrc(bitmapPath);
}
