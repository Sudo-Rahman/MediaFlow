<script lang="ts">
  import { Info } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Item from '$lib/components/ui/item';
  import {
    DEFAULT_SUBTITLE_OCR_CONFIG,
    type SubtitleOcrConfig,
    type SubtitleOcrRetryMode,
  } from '$lib/types';
  import SubtitleOcrRetryOptionsFields from './SubtitleOcrRetryOptionsFields.svelte';
  import {
    buildSubtitleOcrRetryAllDialogDefaults,
    buildSubtitleOcrRetrySubmitConfig,
    cloneSubtitleOcrConfig,
  } from './subtitle-ocr-retry-dialog-state';

  interface SubtitleOcrRetryAllDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    targetCount: number;
    aiCleanupRetryCount: number;
    baseConfig: SubtitleOcrConfig;
    isProcessing: boolean;
    onConfirm: (mode: SubtitleOcrRetryMode, config: SubtitleOcrConfig) => void;
    onNavigateToSettings?: () => void;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    targetCount = 0,
    aiCleanupRetryCount = 0,
    baseConfig,
    isProcessing,
    onConfirm,
    onNavigateToSettings,
  }: SubtitleOcrRetryAllDialogProps = $props();

  let mode = $state<SubtitleOcrRetryMode>('full_ocr');
  let config = $state<SubtitleOcrConfig>(cloneSubtitleOcrConfig(DEFAULT_SUBTITLE_OCR_CONFIG));

  const activeTargetCount = $derived(
    mode === 'ai_cleanup_only' ? aiCleanupRetryCount : targetCount,
  );
  const canConfirm = $derived(activeTargetCount > 0 && !isProcessing);
  const confirmLabel = $derived(
    mode === 'ai_cleanup_only' ? 'Run AI Cleanup Retry' : 'Run Full OCR Retry',
  );
  const description = $derived.by(() => {
    if (mode === 'ai_cleanup_only' && activeTargetCount === 0) {
      return 'No active Subtitle OCR versions are available for AI cleanup-only retry.';
    }

    return `Create a new Subtitle OCR version for ${activeTargetCount} source${activeTargetCount === 1 ? '' : 's'}.`;
  });

  $effect(() => {
    if (open) {
      const defaults = buildSubtitleOcrRetryAllDialogDefaults(baseConfig);
      mode = defaults.mode;
      config = defaults.config;
    }
  });

  function handleOpenChange(nextOpen: boolean): void {
    open = nextOpen;
    onOpenChange(nextOpen);
  }

  function handleConfirm(): void {
    if (!canConfirm) {
      return;
    }

    onConfirm(mode, buildSubtitleOcrRetrySubmitConfig(mode, config));
    handleOpenChange(false);
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
    <Dialog.Header>
      <Dialog.Title>Retry Subtitle OCR</Dialog.Title>
      <Dialog.Description>
        {description}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-auto p-4 space-y-5">
      <Item.Root variant="outline" size="xs">
        <Item.Media>
          <Info class="size-4" />
        </Item.Media>
        <Item.Content>
          <Item.Title>Automatic version names</Item.Title>
          <Item.Description>
            Version names are auto-generated per source.
          </Item.Description>
        </Item.Content>
      </Item.Root>

      <SubtitleOcrRetryOptionsFields
        bind:mode
        bind:config
        scope="all"
        {onNavigateToSettings}
      />
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => handleOpenChange(false)}>
        Cancel
      </Button>
      <Button onclick={handleConfirm} disabled={!canConfirm}>
        {confirmLabel}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
