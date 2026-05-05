import { describe, expect, it } from 'vitest';

import {
  getEffectiveMediaFlowAuthAction,
  getMediaFlowAuthButtonLabel,
  getMediaFlowAuthStatusMessage,
  type MediaFlowAuthAction,
} from './mediaflow-auth-ui';

describe('mediaflow auth UI helpers', () => {
  it('returns idle after a browser sign-in completes and the account is present', () => {
    expect(getEffectiveMediaFlowAuthAction('opening-browser', true)).toBe('idle');
    expect(getEffectiveMediaFlowAuthAction('waiting-callback', true)).toBe('idle');
  });

  it('keeps pending sign-in state while no account is present', () => {
    expect(getEffectiveMediaFlowAuthAction('opening-browser', false)).toBe('opening-browser');
    expect(getEffectiveMediaFlowAuthAction('waiting-callback', false)).toBe('waiting-callback');
  });

  it.each([
    ['idle', 'Sign in', 'Sign in to continue'],
    ['opening-browser', 'Opening...', 'Opening sign-in page...'],
    ['waiting-callback', 'Waiting...', 'Complete sign-in in your browser'],
    ['signing-out', 'Signing out...', 'Signing out...'],
  ] satisfies Array<[MediaFlowAuthAction, string, string]>)(
    'returns labels for %s',
    (action, buttonLabel, statusMessage) => {
      expect(getMediaFlowAuthButtonLabel(action)).toBe(buttonLabel);
      expect(getMediaFlowAuthStatusMessage(action)).toBe(statusMessage);
    },
  );
});
