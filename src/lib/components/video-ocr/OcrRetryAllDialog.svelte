<script lang="ts">
  import type { OcrConfig, OcrRetryMode } from '$lib/types/video-ocr';
  import { DEFAULT_OCR_CONFIG, OCR_LANGUAGES } from '$lib/types/video-ocr';
  import { LlmProviderModelSelector } from '$lib/components/llm';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import * as Select from '$lib/components/ui/select';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';

  interface OcrRetryAllDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    targetCount: number;
    missingRawCount: number;
    baseConfig: OcrConfig;
    onConfirm: (mode: OcrRetryMode, config: OcrConfig) => void;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    targetCount = 0,
    missingRawCount = 0,
    baseConfig,
    onConfirm,
  }: OcrRetryAllDialogProps = $props();

  let mode = $state<OcrRetryMode>('full_pipeline');
  let config = $state<OcrConfig>({ ...DEFAULT_OCR_CONFIG });

  const showPipelineOptions = $derived(mode === 'full_pipeline');
  const showCleanupOptions = $derived(mode === 'full_pipeline' || mode === 'cleanup_only' || mode === 'cleanup_and_ai');
  const showAiOptions = $derived(
    mode === 'cleanup_and_ai'
    || mode === 'ai_only'
    || (mode === 'full_pipeline' && config.aiCleanupEnabled)
  );
  const partialModeSelected = $derived(mode !== 'full_pipeline');

  $effect(() => {
    if (open) {
      mode = 'full_pipeline';
      config = { ...baseConfig };
    }
  });

  function handleOpenChange(nextOpen: boolean) {
    open = nextOpen;
    onOpenChange(nextOpen);
  }

  function handleConfirm() {
    const finalConfig: OcrConfig = {
      ...config,
      aiCleanupEnabled:
        mode === 'cleanup_and_ai' || mode === 'ai_only'
          ? true
          : mode === 'cleanup_only'
            ? false
            : config.aiCleanupEnabled,
    };

    onConfirm(mode, finalConfig);
    handleOpenChange(false);
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

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
    <Dialog.Header>
      <Dialog.Title>Retry all OCR files</Dialog.Title>
      <Dialog.Description>
        Create a new OCR version for {targetCount} file{targetCount === 1 ? '' : 's'}.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-auto p-4 space-y-5">
      <p class="text-xs text-muted-foreground bg-muted/40 border rounded-md p-2">
        Version names are auto-generated per file (Version N+1).
      </p>

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

      {#if partialModeSelected && missingRawCount > 0}
        <p class="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
          {missingRawCount} file{missingRawCount === 1 ? '' : 's'} will fall back to full pipeline automatically.
        </p>
      {/if}

      {#if partialModeSelected}
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
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => handleOpenChange(false)}>
        Cancel
      </Button>
      <Button onclick={handleConfirm} disabled={targetCount === 0}>
        Run retry all
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
