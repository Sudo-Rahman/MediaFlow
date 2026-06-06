<script lang="ts">
  import { Loader2, Sparkles, Wand2 } from '@lucide/svelte';

  import { LlmProviderModelSelector } from '$lib/components/llm';
  import * as Alert from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Empty from '$lib/components/ui/empty';
  import * as Field from '$lib/components/ui/field';
  import * as Item from '$lib/components/ui/item';
  import { Textarea } from '$lib/components/ui/textarea';
  import { mediaflowModelCatalogStore } from '$lib/stores';
  import { isLLMSelectionAvailable, type TranscodeAiIntent, type TranscodeAiSizePreference, type TranscodeFile, type LLMProvider } from '$lib/types';

  const INTENT_OPTIONS: Array<{ value: TranscodeAiIntent; label: string }> = [
    { value: 'speed', label: 'Speed' },
    { value: 'quality', label: 'Quality' },
    { value: 'archive', label: 'Archive' },
  ];

  const SIZE_OPTIONS: Array<{ value: TranscodeAiSizePreference; label: string }> = [
    { value: 'minimum', label: 'Min size' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'no_compromise', label: 'No compromise' },
  ];

  interface Props {
    selectedFile: TranscodeFile;
    provider: LLMProvider;
    model: string;
    intent: TranscodeAiIntent;
    sizePreference: TranscodeAiSizePreference;
    userPrompt: string;
    isAnalyzing: boolean;
    onAnalyzeSelected?: () => void | Promise<void>;
    onAnalyzeAll?: () => void | Promise<void>;
    onProviderChange?: (provider: LLMProvider) => void;
    onModelChange?: (model: string) => void;
    onIntentChange?: (intent: TranscodeAiIntent) => void;
    onSizePreferenceChange?: (sizePreference: TranscodeAiSizePreference) => void;
    onUserPromptChange?: (value: string) => void;
    onNavigateToSettings?: () => void;
  }

  let {
    selectedFile,
    provider,
    model,
    intent,
    sizePreference,
    userPrompt,
    isAnalyzing,
    onAnalyzeSelected,
    onAnalyzeAll,
    onProviderChange,
    onModelChange,
    onIntentChange,
    onSizePreferenceChange,
    onUserPromptChange,
    onNavigateToSettings,
  }: Props = $props();

  const mediaflowImageChatModels = $derived(mediaflowModelCatalogStore.imageChatModels);
  const aiSelectionAvailable = $derived(
    isLLMSelectionAvailable(provider, model, import.meta.env.DEV, mediaflowImageChatModels)
  );

  function handleAnalyzeSelected(): void {
    if (!aiSelectionAvailable) {
      return;
    }

    void onAnalyzeSelected?.();
  }

  function handleAnalyzeAll(): void {
    if (!aiSelectionAvailable) {
      return;
    }

    void onAnalyzeAll?.();
  }

  function formatVideoSummary(file: TranscodeFile): string {
    return file.profile.video.mode === 'transcode' && file.profile.video.encoderId
      ? `${file.profile.video.mode} · ${file.profile.video.encoderId}`
      : file.profile.video.mode;
  }

  function formatAudioSummary(file: TranscodeFile): string {
    return file.profile.audio.mode === 'transcode' && file.profile.audio.encoderId
      ? `${file.profile.audio.mode} · ${file.profile.audio.encoderId}`
      : file.profile.audio.mode;
  }

  function formatSubtitleSummary(file: TranscodeFile): string {
    return file.profile.subtitles.mode === 'convert_text' && file.profile.subtitles.encoderId
      ? `${file.profile.subtitles.mode} · ${file.profile.subtitles.encoderId}`
      : file.profile.subtitles.mode;
  }

  function countAiAdditionalOverrides(file: TranscodeFile): number {
    return [
      ...file.profile.video.additionalArgs,
      ...file.profile.audio.additionalArgs,
      ...file.profile.subtitles.additionalArgs,
      ...file.profile.audio.trackOverrides.flatMap((trackOverride) => trackOverride.additionalArgs ?? []),
    ].filter((arg) => arg.source === 'ai').length;
  }

  function countAiAudioTrackOverrides(file: TranscodeFile): number {
    return file.profile.audio.trackOverrides.filter((trackOverride) => trackOverride.source === 'ai').length;
  }

  function formatAiGeneratedSummary(file: TranscodeFile): string {
    const flagCount = countAiAdditionalOverrides(file);
    const trackOverrideCount = countAiAudioTrackOverrides(file);
    const parts = [];

    if (flagCount > 0) {
      parts.push(`${flagCount} override flag${flagCount === 1 ? '' : 's'}`);
    }
    if (trackOverrideCount > 0) {
      parts.push(`${trackOverrideCount} audio track override${trackOverrideCount === 1 ? '' : 's'}`);
    }

    return parts.length > 0 ? parts.join(' · ') : 'No AI-generated overrides';
  }

  function formatSizePreference(sizePreference?: TranscodeAiSizePreference): string {
    return SIZE_OPTIONS.find((option) => option.value === sizePreference)?.label ?? 'Balanced';
  }
</script>

<Card.Root>
  <Card.Header class="pb-3">
    <Card.Title>AI Assist</Card.Title>
    <Card.Description>
      Let AI recommend the best transcode settings for each file.
    </Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <LlmProviderModelSelector
      provider={provider}
      model={model}
      onProviderChange={onProviderChange ?? (() => undefined)}
      onModelChange={onModelChange ?? (() => undefined)}
      onNavigateToSettings={onNavigateToSettings}
      mediaflowModels={mediaflowImageChatModels}
    />

    <div class="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Field.Field class="gap-2">
        <Field.Label>Optimization target</Field.Label>
        <div class="flex flex-wrap gap-2">
          {#each INTENT_OPTIONS as option (option.value)}
            <Button
              variant={intent === option.value ? 'default' : 'outline'}
              size="sm"
              onclick={() => onIntentChange?.(option.value)}
            >
              {option.label}
            </Button>
          {/each}
        </div>
      </Field.Field>

      <Field.Field class="gap-2">
        <Field.Label>Size preference</Field.Label>
        <div class="flex flex-nowrap gap-2">
          {#each SIZE_OPTIONS as option (option.value)}
            <Button
              variant={sizePreference === option.value ? 'default' : 'outline'}
              size="sm"
              class="shrink-0 px-3"
              onclick={() => onSizePreferenceChange?.(option.value)}
            >
              <span class="whitespace-nowrap">{option.label}</span>
            </Button>
          {/each}
        </div>
      </Field.Field>
    </div>

    <Field.Field class="gap-2">
      <Field.Label for="transcode-ai-user-prompt">Optional instruction</Field.Label>
      <Textarea
        id="transcode-ai-user-prompt"
        value={userPrompt}
        class="min-h-24 text-sm"
        placeholder="Example: Keep all original audio tracks and make the video as small as practical."
        oninput={(event) => onUserPromptChange?.(event.currentTarget.value)}
      />
      <Field.Description class="text-xs">
        Use this to steer codec or quality choices. Requests unrelated to transcoding will be rejected.
      </Field.Description>
    </Field.Field>

    <div class="flex flex-wrap gap-2">
      <Button onclick={handleAnalyzeSelected} disabled={isAnalyzing || selectedFile.status !== 'ready' || !aiSelectionAvailable}>
        {#if isAnalyzing}
          <Loader2 class="size-4 mr-2 animate-spin" />
        {:else}
          <Wand2 class="size-4 mr-2" />
        {/if}
        Analyze Selected File
      </Button>
      <Button variant="outline" onclick={handleAnalyzeAll} disabled={isAnalyzing || !aiSelectionAvailable}>
        {#if isAnalyzing}
          <Loader2 class="size-4 mr-2 animate-spin" />
        {:else}
          <Sparkles class="size-4 mr-2" />
        {/if}
        Analyze All Ready Files
      </Button>
    </div>

    {#if selectedFile.aiStatus === 'error' && selectedFile.aiError}
      <Alert.Root variant="destructive">
        <Alert.Title>AI request rejected</Alert.Title>
        <Alert.Description>{selectedFile.aiError}</Alert.Description>
      </Alert.Root>
    {:else if selectedFile.aiRecommendation}
      <Card.Root>
        <Card.Header class="pb-3">
          <div>
            <Card.Title>Latest AI recommendation</Card.Title>
            <Card.Description>
              {selectedFile.aiRecommendation.provider} · {selectedFile.aiRecommendation.model}
            </Card.Description>
          </div>
          <Card.Action class="flex flex-wrap justify-end gap-2">
            <Badge>{selectedFile.aiRecommendation.intent}</Badge>
            <Badge variant="outline">
              {formatSizePreference(selectedFile.aiRecommendation.sizePreference)}
            </Badge>
          </Card.Action>
        </Card.Header>
        <Card.Content class="space-y-3">
          <Textarea value={selectedFile.aiRecommendation.rationale} readonly class="min-h-24 text-sm" />
          <Item.Group class="gap-2">
            <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
              <Item.Title>Container</Item.Title>
              <Item.Description>{selectedFile.profile.containerId.toUpperCase()}</Item.Description>
            </Item.Root>
            <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
              <Item.Title>Video</Item.Title>
              <Item.Description>{formatVideoSummary(selectedFile)}</Item.Description>
            </Item.Root>
            <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
              <Item.Title>Audio</Item.Title>
              <Item.Description>{formatAudioSummary(selectedFile)}</Item.Description>
            </Item.Root>
            <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
              <Item.Title>Subtitles</Item.Title>
              <Item.Description>{formatSubtitleSummary(selectedFile)}</Item.Description>
            </Item.Root>
            <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
              <Item.Title>AI overrides</Item.Title>
              <Item.Description>{formatAiGeneratedSummary(selectedFile)}</Item.Description>
            </Item.Root>
          </Item.Group>
          {#if selectedFile.aiRecommendation.warnings?.length}
            <Alert.Root role="status" aria-live="polite" class="border-amber-500/40 text-amber-700 dark:text-amber-300">
              <Alert.Title>AI warnings</Alert.Title>
              <Alert.Description class="space-y-1">
                {#each selectedFile.aiRecommendation.warnings as warning, index (index)}
                  <p>{warning}</p>
                {/each}
              </Alert.Description>
            </Alert.Root>
          {/if}
        </Card.Content>
      </Card.Root>
    {:else}
      <Empty.Root class="border p-4">
        <Empty.Description>
          AI recommendations will appear here and automatically fill the advanced settings below.
        </Empty.Description>
      </Empty.Root>
    {/if}
  </Card.Content>
</Card.Root>
