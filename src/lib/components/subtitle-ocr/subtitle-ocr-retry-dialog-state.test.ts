import { describe, expect, it } from 'vitest';

import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';
import {
  buildSubtitleOcrRetryDialogDefaults,
  buildSubtitleOcrRetryAllDialogDefaults,
  buildSubtitleOcrRetrySubmitConfig,
} from './subtitle-ocr-retry-dialog-state';

describe('buildSubtitleOcrRetryDialogDefaults', () => {
  it('defaults to full OCR and clones the current global config', () => {
    const globalConfig = {
      ...DEFAULT_SUBTITLE_OCR_CONFIG,
      ocrModel: 'latin' as const,
      useGpu: false,
      aiCleanupEnabled: true,
      aiCleanupModel: 'global-model',
    };

    const defaults = buildSubtitleOcrRetryDialogDefaults(globalConfig, 2);

    expect(defaults).toEqual({
      mode: 'full_ocr',
      versionName: 'Version 3',
      config: globalConfig,
    });
    expect(defaults.config).not.toBe(globalConfig);
  });
});

describe('buildSubtitleOcrRetryAllDialogDefaults', () => {
  it('defaults global retry to full OCR and clones the current global config', () => {
    const globalConfig = {
      ...DEFAULT_SUBTITLE_OCR_CONFIG,
      ocrModel: 'latin' as const,
      useGpu: false,
      aiCleanupModel: 'global-retry-model',
    };

    const defaults = buildSubtitleOcrRetryAllDialogDefaults(globalConfig);

    expect(defaults).toEqual({
      mode: 'full_ocr',
      config: globalConfig,
    });
    expect(defaults.config).not.toBe(globalConfig);
  });
});

describe('buildSubtitleOcrRetrySubmitConfig', () => {
  it('enables AI cleanup for AI cleanup only retries even when the global toggle is off', () => {
    const config = {
      ...DEFAULT_SUBTITLE_OCR_CONFIG,
      aiCleanupEnabled: false,
      aiCleanupModel: 'global-cleanup-model',
    };

    const submitConfig = buildSubtitleOcrRetrySubmitConfig('ai_cleanup_only', config);

    expect(submitConfig.aiCleanupEnabled).toBe(true);
    expect(submitConfig.aiCleanupModel).toBe('global-cleanup-model');
    expect(submitConfig).not.toBe(config);
  });

  it('keeps the submitted full OCR cleanup toggle unchanged', () => {
    const config = {
      ...DEFAULT_SUBTITLE_OCR_CONFIG,
      aiCleanupEnabled: false,
    };

    expect(buildSubtitleOcrRetrySubmitConfig('full_ocr', config).aiCleanupEnabled).toBe(false);
  });
});
