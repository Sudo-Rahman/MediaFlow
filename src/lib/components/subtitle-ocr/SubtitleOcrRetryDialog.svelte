<script lang="ts">
  import { RetryVersionDialogShell } from '$lib/components/shared';
  import {
    DEFAULT_SUBTITLE_OCR_CONFIG,
    type SubtitleOcrConfig,
    type SubtitleOcrRetryMode,
    type SubtitleOcrSourceItem,
    type SubtitleOcrVersion,
  } from '$lib/types';
  import SubtitleOcrRetryOptionsFields from './SubtitleOcrRetryOptionsFields.svelte';
  import {
    buildSubtitleOcrRetryDialogDefaults,
    buildSubtitleOcrRetrySubmitConfig,
    cloneSubtitleOcrConfig,
  } from './subtitle-ocr-retry-dialog-state';

  interface SubtitleOcrRetryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: SubtitleOcrSourceItem | null;
    activeVersion: SubtitleOcrVersion | null;
    baseConfig: SubtitleOcrConfig;
    isProcessing: boolean;
    onConfirm: (
      itemId: string,
      versionName: string,
      mode: SubtitleOcrRetryMode,
      config: SubtitleOcrConfig,
    ) => void;
    onNavigateToSettings?: () => void;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    item,
    activeVersion,
    baseConfig,
    isProcessing,
    onConfirm,
    onNavigateToSettings,
  }: SubtitleOcrRetryDialogProps = $props();

  let versionName = $state('');
  let mode = $state<SubtitleOcrRetryMode>('full_ocr');
  let config = $state<SubtitleOcrConfig>(cloneSubtitleOcrConfig(DEFAULT_SUBTITLE_OCR_CONFIG));

  const canConfirm = $derived(!!item && !!activeVersion && !isProcessing);
  const confirmLabel = $derived(
    mode === 'ai_cleanup_only' ? 'Run AI Cleanup Retry' : 'Run Full OCR Retry',
  );

  $effect(() => {
    if (open && item) {
      const defaults = buildSubtitleOcrRetryDialogDefaults(baseConfig, item.versions.length);
      mode = defaults.mode;
      versionName = defaults.versionName;
      config = defaults.config;
    }
  });

  function handleConfirm(): void {
    if (!item || !activeVersion || !canConfirm) {
      return;
    }

    onConfirm(
      item.id,
      versionName.trim() || `Version ${item.versions.length + 1}`,
      mode,
      buildSubtitleOcrRetrySubmitConfig(mode, config),
    );
    onOpenChange(false);
  }
</script>

<RetryVersionDialogShell
  bind:open
  {onOpenChange}
  title="New Subtitle OCR Version"
  description={`Create a new Subtitle OCR version for ${item?.displayName ?? 'this source'}`}
  bind:versionName
  versionNamePlaceholder="Version 1"
  confirmLabel={confirmLabel}
  confirmDisabled={!canConfirm}
  maxWidthClass="max-w-xl"
  onConfirm={handleConfirm}
>
  {#snippet optionsContent()}
    <SubtitleOcrRetryOptionsFields
      bind:mode
      bind:config
      scope="single"
      activeVersionName={activeVersion?.name}
      {onNavigateToSettings}
    />
  {/snippet}
</RetryVersionDialogShell>
