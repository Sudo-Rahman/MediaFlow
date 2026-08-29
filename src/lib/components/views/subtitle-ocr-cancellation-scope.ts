type SubtitleOcrCancelOwner =
  | { kind: 'preview_restore'; generation: number }
  | { kind: 'processing' };

export interface SubtitleOcrCancellationScopeContext {
  setCancelRequested(value: boolean): void;
  isProcessing(): boolean;
  setCancelling(value: boolean): void;
}

export interface SubtitleOcrCancellationScope {
  prepareForImport(): void;
  setCancelRequested(value: boolean): void;
  ownPreviewRestore(generation: number): void;
  ownProcessing(): void;
  clearPreviewIfOwned(generation: number): void;
  clear(): void;
}

export function createSubtitleOcrCancellationScope(
  context: SubtitleOcrCancellationScopeContext,
): SubtitleOcrCancellationScope {
  let owner: SubtitleOcrCancelOwner | null = null;

  function setCancelRequested(value: boolean): void {
    context.setCancelRequested(value);
    if (!value) owner = null;
  }

  function prepareForImport(): void {
    if (owner?.kind !== 'preview_restore') return;

    owner = null;
    context.setCancelRequested(false);
    if (!context.isProcessing()) context.setCancelling(false);
  }

  function clearPreviewIfOwned(generation: number): void {
    if (owner?.kind !== 'preview_restore' || owner.generation !== generation) return;

    owner = null;
    context.setCancelRequested(false);
    if (!context.isProcessing()) context.setCancelling(false);
  }

  function clear(): void {
    owner = null;
    context.setCancelRequested(false);
    if (!context.isProcessing()) context.setCancelling(false);
  }

  return {
    prepareForImport,
    setCancelRequested,
    ownPreviewRestore: (generation) => { owner = { kind: 'preview_restore', generation }; },
    ownProcessing: () => { owner = { kind: 'processing' }; },
    clearPreviewIfOwned,
    clear,
  };
}
