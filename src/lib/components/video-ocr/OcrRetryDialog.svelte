<script lang="ts">
  import type { OcrConfig, OcrRetryMode, OcrVideoFile } from '$lib/types/video-ocr';
  import { DEFAULT_OCR_CONFIG, OCR_LANGUAGES } from '$lib/types/video-ocr';
  import { LlmProviderModelSelector } from '$lib/components/llm';
  import { RetryVersionDialogShell } from '$lib/components/shared';

  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import * as Select from '$lib/components/ui/select';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';

  interface OcrRetryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    file: OcrVideoFile | null;
    baseConfig: OcrConfig;
    onConfirm: (fileId: string, versionName: string, mode: OcrRetryMode, config: OcrConfig) => void;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    file,
    baseConfig,
    onConfirm,
  }: OcrRetryDialogProps = $props();

  let versionName = $state('');
  let mode = $state<OcrRetryMode>('full_pipeline');
  let config = $state<OcrConfig>({ ...DEFAULT_OCR_CONFIG });

  const hasRawVersion = $derived((file?.ocrVersions ?? []).some((version) => version.rawOcr.length > 0));
  const showPipelineOptions = $derived(mode === 'full_pipeline');
  const showCleanupOptions = $derived(mode === 'full_pipeline' || mode === 'cleanup_only' || mode === 'cleanup_and_ai');
  const showAiOptions = $derived(
    mode === 'cleanup_and_ai'
    || mode === 'ai_only'
    || (mode === 'full_pipeline' && config.aiCleanupEnabled)
  );

  $effect(() => {
    if (open && file) {
      versionName = `Version ${(file.ocrVersions?.length ?? 0) + 1}`;
      mode = 'full_pipeline';
      config = { ...baseConfig };
    }
  });

  function handleConfirm() {
    if (!file) {
      return;
    }

    const finalConfig: OcrConfig = {
      ...config,
      aiCleanupEnabled:
        mode === 'cleanup_and_ai' || mode === 'ai_only'
          ? true
          : mode === 'cleanup_only'
            ? false
            : config.aiCleanupEnabled,
    };

    onConfirm(file.id, versionName.trim() || 'New version', mode, finalConfig);
    onOpenChange(false);
  }

  function getModeLabel(value: OcrRetryMode): string {
    switch (value) {
      case 'full_pipeline':
        return 'Full pipeline';
      case 'cleanup_only':
        return 'Cleanup only';
      case 'cleanup_and_ai':
        return 'Cleanup + AI';
      case 'ai_only':
        return 'AI only';
    }
  }
</script>

<RetryVersionDialogShell
  bind:open
  {onOpenChange}
  title="New OCR Version"
  description={`Create a new OCR version for ${file?.name ?? 'this file'}`}
  bind:versionName
  versionNamePlaceholder="Version 1"
  confirmLabel="Run"
  maxWidthClass="max-w-xl"
  onConfirm={handleConfirm}
>
  {#snippet optionsContent()}
    <div class="space-y-2">
      <Label>Retry mode</Label>
      <Select.Root
        type="single"
        value={mode}
        onValueChange={(value) => value && (mode = value as OcrRetryMode)}
      >
        <Select.Trigger class="w-full">
          {getModeLabel(mode)}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="full_pipeline">Full pipeline</Select.Item>
          <Select.Item value="cleanup_only">Cleanup only</Select.Item>
          <Select.Item value="cleanup_and_ai">Cleanup + AI</Select.Item>
          <Select.Item value="ai_only">AI only</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>

    {#if mode !== 'full_pipeline' && !hasRawVersion}
      <p class="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
        No persisted raw OCR found for this file. The run will automatically fall back to full pipeline.
      </p>
    {/if}

    {#if mode !== 'full_pipeline'}
      <p class="text-xs text-muted-foreground bg-muted/40 border rounded-md p-2">
        Partial retry reuses the original raw OCR frame rate for timing.
      </p>
    {/if}

    {#if showPipelineOptions}
      <div class="space-y-2">
        <Separator />
        <h4 class="text-sm font-medium">Pipeline options</h4>

        <Label>Language</Label>
        <Select.Root
          type="single"
          value={config.language}
          onValueChange={(value) => value && (config = { ...config, language: value as OcrConfig['language'] })}
        >
          <Select.Trigger class="w-full">
            {OCR_LANGUAGES.find((lang) => lang.value === config.language)?.label ?? 'Select language'}
          </Select.Trigger>
          <Select.Content>
            {#each OCR_LANGUAGES as lang}
              <Select.Item value={lang.value}>{lang.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <Label>Frame rate</Label>
          <span class="text-xs text-muted-foreground">{config.frameRate} fps</span>
        </div>
        <Slider
          type="single"
          value={config.frameRate}
          min={1}
          max={30}
          step={1}
          onValueChange={(value) => config = { ...config, frameRate: value }}
        />
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <Label>Min confidence</Label>
          <span class="text-xs text-muted-foreground">{Math.round(config.confidenceThreshold * 100)}%</span>
        </div>
        <Slider
          type="single"
          value={Math.round(config.confidenceThreshold * 100)}
          min={0}
          max={100}
          step={5}
          onValueChange={(value) => config = { ...config, confidenceThreshold: value / 100 }}
        />
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <Label>Parallel workers</Label>
          <span class="text-xs text-muted-foreground">{config.threadCount}</span>
        </div>
        <Slider
          type="single"
          value={config.threadCount}
          min={1}
          max={navigator.hardwareConcurrency || 4}
          step={1}
          onValueChange={(value) => config = { ...config, threadCount: value }}
        />
      </div>

      <div class="flex items-center justify-between">
        <Label>Use GPU acceleration</Label>
        <Switch
          checked={config.useGpu}
          onCheckedChange={(checked) => config = { ...config, useGpu: checked }}
        />
      </div>

      <div class="flex items-center justify-between">
        <Label>Enable AI cleanup</Label>
        <Switch
          checked={config.aiCleanupEnabled}
          onCheckedChange={(checked) => config = { ...config, aiCleanupEnabled: checked }}
        />
      </div>
    {/if}

    {#if showCleanupOptions}
      <Separator />
      <div class="space-y-4">
        <h4 class="text-sm font-medium">Cleanup options</h4>

        <div class="flex items-center justify-between">
          <Label>Merge similar subtitles</Label>
          <Switch
            checked={config.mergeSimilar}
            onCheckedChange={(checked) => config = { ...config, mergeSimilar: checked }}
          />
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label>Similarity threshold</Label>
            <span class="text-xs text-muted-foreground">{Math.round(config.similarityThreshold * 100)}%</span>
          </div>
          <Slider
            type="single"
            value={Math.round(config.similarityThreshold * 100)}
            min={80}
            max={98}
            step={1}
            disabled={!config.mergeSimilar}
            onValueChange={(value) => config = { ...config, similarityThreshold: value / 100 }}
          />
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label>Max gap to merge</Label>
            <span class="text-xs text-muted-foreground">{config.maxGapMs} ms</span>
          </div>
          <Slider
            type="single"
            value={config.maxGapMs}
            min={0}
            max={1000}
            step={50}
            onValueChange={(value) => config = { ...config, maxGapMs: value }}
          />
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label>Minimum cue duration</Label>
            <span class="text-xs text-muted-foreground">{config.minCueDurationMs} ms</span>
          </div>
          <Slider
            type="single"
            value={config.minCueDurationMs}
            min={0}
            max={2000}
            step={50}
            onValueChange={(value) => config = { ...config, minCueDurationMs: value }}
          />
        </div>

        <div class="flex items-center justify-between">
          <Label>Filter URL-like watermarks</Label>
          <Switch
            checked={config.filterUrlLike}
            onCheckedChange={(checked) => config = { ...config, filterUrlLike: checked }}
          />
        </div>
      </div>
    {/if}

    {#if showAiOptions}
      <Separator />
      <div class="space-y-2">
        <h4 class="text-sm font-medium">AI options</h4>
        <LlmProviderModelSelector
          provider={config.aiCleanupProvider}
          model={config.aiCleanupModel}
          onProviderChange={(provider) => config = { ...config, aiCleanupProvider: provider }}
          onModelChange={(model) => config = { ...config, aiCleanupModel: model }}
        />
      </div>
    {/if}
  {/snippet}
</RetryVersionDialogShell>
