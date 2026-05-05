import { toast } from 'svelte-sonner';

import {
  cancelPendingMediaFlowSignIn,
  openMediaFlowDashboard,
  signInWithMediaFlow,
  signOutMediaFlow,
} from '$lib/services/mediaflow-auth';
import {
  getEffectiveMediaFlowAuthAction,
  getMediaFlowAuthButtonLabel,
  getMediaFlowAuthStatusMessage,
} from '$lib/services/mediaflow-auth-ui';
import type { MediaFlowAuthAction } from '$lib/services/mediaflow-auth-ui';
import { settingsStore } from './settings.svelte';

let action = $state<MediaFlowAuthAction>('idle');

function getEffectiveAction(): MediaFlowAuthAction {
  return getEffectiveMediaFlowAuthAction(action, Boolean(settingsStore.settings.mediaflowUser));
}

export const mediaflowAuthUiStore = {
  get action() { return getEffectiveAction(); },
  get rawAction() { return action; },
  get isBusy() { return getEffectiveAction() !== 'idle'; },
  get isWaitingForCallback() { return getEffectiveAction() === 'waiting-callback'; },
  get buttonLabel() { return getMediaFlowAuthButtonLabel(getEffectiveAction()); },
  get statusMessage() { return getMediaFlowAuthStatusMessage(getEffectiveAction()); },

  async openDashboard(): Promise<void> {
    try {
      await openMediaFlowDashboard();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    }
  },

  async startSignIn(): Promise<void> {
    if (getEffectiveAction() !== 'idle') return;

    action = 'opening-browser';
    try {
      await signInWithMediaFlow();
      if (settingsStore.settings.mediaflowUser) {
        action = 'idle';
        return;
      }

      action = 'waiting-callback';
      toast.info('Complete sign-in in your browser');
    } catch (error) {
      action = 'idle';
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    }
  },

  cancelSignIn(): void {
    cancelPendingMediaFlowSignIn();
    action = 'idle';
    toast.info('MediaFlow sign-in cancelled');
  },

  async signOut(): Promise<void> {
    if (!settingsStore.settings.mediaflowUser || getEffectiveAction() !== 'idle') return;

    action = 'signing-out';
    try {
      await signOutMediaFlow();
      toast.success('Signed out from MediaFlow');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      action = 'idle';
    }
  },
};
