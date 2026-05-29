import type { SubtitleOcrConfig, SubtitleOcrRetryMode } from '$lib/types';

export interface SubtitleOcrRetryDialogDefaults {
  mode: SubtitleOcrRetryMode;
  versionName: string;
  config: SubtitleOcrConfig;
}

export interface SubtitleOcrRetryAllDialogDefaults {
  mode: SubtitleOcrRetryMode;
  config: SubtitleOcrConfig;
}

export function cloneSubtitleOcrConfig(config: SubtitleOcrConfig): SubtitleOcrConfig {
  return { ...config };
}

export function buildSubtitleOcrRetryDialogDefaults(
  globalConfig: SubtitleOcrConfig,
  existingVersionCount: number,
): SubtitleOcrRetryDialogDefaults {
  return {
    mode: 'full_ocr',
    versionName: `Version ${existingVersionCount + 1}`,
    config: cloneSubtitleOcrConfig(globalConfig),
  };
}

export function buildSubtitleOcrRetryAllDialogDefaults(
  globalConfig: SubtitleOcrConfig,
): SubtitleOcrRetryAllDialogDefaults {
  return {
    mode: 'full_ocr',
    config: cloneSubtitleOcrConfig(globalConfig),
  };
}

export function buildSubtitleOcrRetrySubmitConfig(
  mode: SubtitleOcrRetryMode,
  config: SubtitleOcrConfig,
): SubtitleOcrConfig {
  return {
    ...config,
    aiCleanupEnabled: mode === 'ai_cleanup_only' ? true : config.aiCleanupEnabled,
  };
}
