<script lang="ts">
  import type { OcrConfig, OcrLanguage, OcrOutputFormat } from '$lib/types/video-ocr';
  import { OCR_LANGUAGES, OCR_OUTPUT_FORMATS, DEFAULT_OCR_CONFIG } from '$lib/types/video-ocr';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import * as Select from '$lib/components/ui/select';
  import { Slider } from '$lib/components/ui/slider';
  import { Play, Square, FolderOpen, Settings } from '@lucide/svelte';

  interface OcrOptionsPanelProps {
    config: OcrConfig;
    outputDir: string;
    canStart: boolean;
    isProcessing: boolean;
    availableLanguages?: string[];  // Languages with installed models
    onConfigChange: (updates: Partial<OcrConfig>) => void;
    onOutputDirChange: (dir: string) => void;
    onStart: () => void;
    onCancel: () => void;
    onSelectOutputDir: () => void;
  }

  let {
    config,
    outputDir,
    canStart,
    isProcessing,
    availableLanguages = [],
    onConfigChange,
    onOutputDirChange,
    onStart,
    onCancel,
    onSelectOutputDir,
  }: OcrOptionsPanelProps = $props();

  // Filter languages to only show those with installed models
  // If no availableLanguages provided, show all (fallback)
  const filteredLanguages = $derived(
    availableLanguages.length > 0
      ? OCR_LANGUAGES.filter(lang => availableLanguages.includes(lang.value))
      : OCR_LANGUAGES
  );

  function handleLanguageChange(value: string) {
    onConfigChange({ language: value as OcrLanguage });
  }

  function handleFormatChange(value: string) {
    onConfigChange({ outputFormat: value as OcrOutputFormat });
  }

  function handleFrameRateChange(value: number) {
    onConfigChange({ frameRate: value });
  }

  function handleConfidenceChange(value: number) {
    onConfigChange({ confidenceThreshold: value / 100 });
  }
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center gap-2">
    <Settings class="size-5 text-muted-foreground" />
    <h3 class="font-semibold">OCR Options</h3>
  </div>

  <!-- Language -->
  <div class="space-y-2">
    <Label>Language</Label>
    <Select.Root type="single" value={config.language} onValueChange={handleLanguageChange}>
      <Select.Trigger class="w-full">
        {filteredLanguages.find(l => l.value === config.language)?.label ?? 'Select language'}
      </Select.Trigger>
      <Select.Content>
        {#each filteredLanguages as lang}
          <Select.Item value={lang.value}>
            <span>{lang.label}</span>
            <span class="text-xs text-muted-foreground ml-2">{lang.description}</span>
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
    {#if availableLanguages.length > 0 && availableLanguages.length < OCR_LANGUAGES.length}
      <p class="text-xs text-muted-foreground">
        {availableLanguages.length} of {OCR_LANGUAGES.length} language models installed
      </p>
    {/if}
  </div>

  <!-- Frame Rate -->
  <div class="space-y-2">
    <div class="flex justify-between">
      <Label>Frame Rate</Label>
      <span class="text-sm text-muted-foreground">{config.frameRate} fps</span>
    </div>
    <Slider
      type="single"
      value={config.frameRate}
      onValueChange={handleFrameRateChange}
      min={1}
      max={30}
      step={1}
    />
    <p class="text-xs text-muted-foreground">
      Higher = more accurate timing, slower processing
    </p>
  </div>

  <!-- Confidence Threshold -->
  <div class="space-y-2">
    <div class="flex justify-between">
      <Label>Min Confidence</Label>
      <span class="text-sm text-muted-foreground">{Math.round(config.confidenceThreshold * 100)}%</span>
    </div>
    <Slider
      type="single"
      value={config.confidenceThreshold * 100}
      onValueChange={handleConfidenceChange}
      min={0}
      max={100}
      step={5}
    />
    <p class="text-xs text-muted-foreground">
      Ignore OCR results below this confidence level
    </p>
  </div>

  <!-- Output Format -->
  <div class="space-y-2">
    <Label>Output Format</Label>
    <Select.Root type="single" value={config.outputFormat} onValueChange={handleFormatChange}>
      <Select.Trigger class="w-full">
        {OCR_OUTPUT_FORMATS.find(f => f.value === config.outputFormat)?.label ?? 'Select format'}
      </Select.Trigger>
      <Select.Content>
        {#each OCR_OUTPUT_FORMATS as format}
          <Select.Item value={format.value}>{format.label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <!-- Options Toggles -->
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <Label>Show subtitle preview</Label>
      <Switch
        checked={config.showSubtitlePreview}
        onCheckedChange={(checked) => onConfigChange({ showSubtitlePreview: checked })}
      />
    </div>

    <div class="flex items-center justify-between">
      <Label>Use GPU acceleration</Label>
      <Switch
        checked={config.useGpu}
        onCheckedChange={(checked) => onConfigChange({ useGpu: checked })}
      />
    </div>
  </div>

  <!-- Output Directory -->
  <div class="space-y-2">
    <Label>Output Directory</Label>
    <Button
      variant="outline"
      class="w-full justify-start"
      onclick={onSelectOutputDir}
    >
      <FolderOpen class="size-4 mr-2" />
      <span class="truncate flex-1 text-left">
        {outputDir || 'Select output folder...'}
      </span>
    </Button>
  </div>

  <!-- Action Buttons -->
  <div class="pt-4 border-t space-y-2">
    {#if isProcessing}
      <Button
        variant="destructive"
        class="w-full"
        onclick={onCancel}
      >
        <Square class="size-4 mr-2" />
        Cancel OCR
      </Button>
    {:else}
      <Button
        class="w-full"
        disabled={!canStart}
        onclick={onStart}
      >
        <Play class="size-4 mr-2" />
        Start OCR
      </Button>
    {/if}

    {#if !canStart && !isProcessing}
      <p class="text-xs text-muted-foreground text-center">
        {#if !outputDir}
          Select an output directory to start
        {:else}
          Add videos and wait for transcoding to complete
        {/if}
      </p>
    {/if}
  </div>
</div>
