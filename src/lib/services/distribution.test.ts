import { describe, expect, it } from 'vitest';

import {
  getUpdateManagementLabel,
  isMicrosoftStoreDistribution,
  normalizeMediaFlowDistribution,
} from './distribution';

describe('distribution helpers', () => {
  it('normalizes the Microsoft Store distribution', () => {
    expect(normalizeMediaFlowDistribution('microsoft-store')).toBe('microsoft-store');
  });

  it('falls back to standard for empty or unknown values', () => {
    expect(normalizeMediaFlowDistribution(undefined)).toBe('standard');
    expect(normalizeMediaFlowDistribution('')).toBe('standard');
    expect(normalizeMediaFlowDistribution('windows')).toBe('standard');
  });

  it('detects Microsoft Store builds', () => {
    expect(isMicrosoftStoreDistribution('microsoft-store')).toBe(true);
    expect(isMicrosoftStoreDistribution('standard')).toBe(false);
  });

  it('formats the update management label', () => {
    expect(getUpdateManagementLabel('microsoft-store')).toBe('Updates are managed by Microsoft Store');
    expect(getUpdateManagementLabel('standard')).toBe('Updates are managed by MediaFlow');
  });
});
