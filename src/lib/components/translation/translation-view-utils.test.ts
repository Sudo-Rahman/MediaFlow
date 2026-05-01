import { describe, expect, it } from 'vitest';

import {
  getPendingTranslationVersionName,
  isPendingTranslationVersionId,
  PENDING_TRANSLATION_VERSION_ID,
} from './translation-view-utils';

describe('pending translation version helpers', () => {
  it('names the pending version after the last completed version', () => {
    expect(getPendingTranslationVersionName(4)).toBe('Version 5');
  });

  it('identifies the pending pseudo-version id', () => {
    expect(isPendingTranslationVersionId(PENDING_TRANSLATION_VERSION_ID)).toBe(true);
    expect(isPendingTranslationVersionId('tv-123')).toBe(false);
  });
});
