export type MediaFlowAuthAction = 'idle' | 'opening-browser' | 'waiting-callback' | 'signing-out';

export function getEffectiveMediaFlowAuthAction(
  action: MediaFlowAuthAction,
  hasUser: boolean,
): MediaFlowAuthAction {
  if (hasUser && (action === 'opening-browser' || action === 'waiting-callback')) {
    return 'idle';
  }

  return action;
}

export function getMediaFlowAuthButtonLabel(action: MediaFlowAuthAction): string {
  if (action === 'opening-browser') return 'Opening...';
  if (action === 'waiting-callback') return 'Waiting...';
  if (action === 'signing-out') return 'Signing out...';
  return 'Sign in';
}

export function getMediaFlowAuthStatusMessage(action: MediaFlowAuthAction): string {
  if (action === 'opening-browser') return 'Opening sign-in page...';
  if (action === 'waiting-callback') return 'Complete sign-in in your browser';
  if (action === 'signing-out') return 'Signing out...';
  return 'Sign in to continue';
}
