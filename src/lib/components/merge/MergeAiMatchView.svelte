<script lang="ts">
  import {
    AlertTriangle,
    CheckCircle2,
    FileAudio,
    FileVideo,
    Loader2,
    Sparkles,
    Subtitles,
    Unlink,
  } from '@lucide/svelte';

  import { LlmProviderModelSelector } from '$lib/components/llm';
  import * as Accordion from '$lib/components/ui/accordion';
  import * as Alert from '$lib/components/ui/alert';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Card from '$lib/components/ui/card';
  import * as Empty from '$lib/components/ui/empty';
  import * as Item from '$lib/components/ui/item';
  import type {
    ImportedTrack,
    LLMProvider,
    MergeAiStatus,
    MergeAiSuggestion,
    MergeTrack,
    MergeVideoFile,
  } from '$lib/types';
  import { cn } from '$lib/utils';
  import { formatDuration, formatFileSize, formatLanguage } from '$lib/utils/format';

  interface Props {
    videos: MergeVideoFile[];
    importedTracks: ImportedTrack[];
    unassignedTracks: ImportedTrack[];
    provider: LLMProvider;
    model: string;
    status: MergeAiStatus;
    error: string | null;
    suggestions: MergeAiSuggestion[];
    warnings: string[];
    canAnalyze: boolean;
    onProviderChange: (provider: LLMProvider) => void;
    onModelChange: (model: string) => void;
    onAnalyze: () => void | Promise<void>;
    onApply: () => void;
    onClear: () => void;
    onToggleSuggestion: (trackId: string, selected: boolean) => void;
    onNavigateToSettings?: () => void;
  }

  let {
    videos,
    importedTracks,
    unassignedTracks,
    provider,
    model,
    status,
    error,
    suggestions,
    warnings,
    canAnalyze,
    onProviderChange,
    onModelChange,
    onAnalyze,
    onApply,
    onClear,
    onToggleSuggestion,
    onNavigateToSettings,
  }: Props = $props();

  let userExpandedVideoIds = $state<string[] | null>(null);

  const trackMap = $derived.by(() => new Map(importedTracks.map(track => [track.id, track])));
  const selectedSuggestionCount = $derived(
    suggestions.filter(suggestion => suggestion.selected && suggestion.videoId !== null).length
  );
  const matchedSuggestionCount = $derived(
    suggestions.filter(suggestion => suggestion.videoId !== null).length
  );
  const unmatchedSuggestions = $derived(
    suggestions.filter(suggestion => suggestion.videoId === null)
  );
  const visibleWarnings = $derived(warnings.slice(0, 3));
  const remainingWarningCount = $derived(Math.max(0, warnings.length - visibleWarnings.length));
  const videoIds = $derived(videos.map(video => video.id));
  const defaultExpandedVideoIds = $derived(videoIds.slice(0, 3));
  const expandedVideoIds = $derived(
    (userExpandedVideoIds ?? defaultExpandedVideoIds).filter(videoId => videoIds.includes(videoId))
  );

  function handleExpandedVideoIdsChange(value: string[]): void {
    userExpandedVideoIds = value.filter(videoId => videoIds.includes(videoId));
  }

  function getTrackIcon(type: ImportedTrack['type'] | MergeTrack['type']) {
    switch (type) {
      case 'subtitle':
        return Subtitles;
      case 'video':
        return FileVideo;
      default:
        return FileAudio;
    }
  }

  function getConfidenceClass(confidence: MergeAiSuggestion['confidence']): string {
    switch (confidence) {
      case 'high':
        return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
      case 'medium':
        return 'border-amber-500/30 bg-amber-500/10 text-amber-700';
      default:
        return 'border-border bg-muted text-muted-foreground';
    }
  }

  function attachedTracksForVideo(video: MergeVideoFile): ImportedTrack[] {
    return video.attachedTracks
      .toSorted((a, b) => a.order - b.order)
      .map(attachedTrack => trackMap.get(attachedTrack.trackId))
      .filter((track): track is ImportedTrack => Boolean(track));
  }

  function suggestedTracksForVideo(videoId: string): MergeAiSuggestion[] {
    return suggestions.filter(suggestion => suggestion.videoId === videoId);
  }

  function sourceTrackCounts(video: MergeVideoFile): string {
    const counts = video.tracks.reduce(
      (acc, track) => {
        if (track.type === 'video') acc.video += 1;
        if (track.type === 'audio') acc.audio += 1;
        if (track.type === 'subtitle') acc.subtitle += 1;
        return acc;
      },
      { video: 0, audio: 0, subtitle: 0 },
    );

    return `${counts.video}V / ${counts.audio}A / ${counts.subtitle}S`;
  }

  function effectiveLanguage(track: ImportedTrack): string | null {
    return track.config.language ?? track.language ?? null;
  }
</script>

<div class="h-full overflow-hidden bg-[radial-gradient(circle_at_top_left,var(--muted),transparent_36rem)]">
  <div class="grid h-full grid-cols-[minmax(19rem,22rem)_minmax(0,1fr)]">
    <aside class="border-r bg-background/85 p-4 overflow-auto">
      <div class="space-y-4">
        <Card.Root size="sm">
          <Card.Content>
          <div class="flex items-start gap-3">
            <div class="rounded-xl bg-primary/10 p-2 text-primary">
              <Sparkles class="size-5" />
            </div>
            <div class="space-y-1">
              <h2 class="font-semibold">AI Match</h2>
              <p class="text-sm text-muted-foreground">
                Suggest links for unassigned tracks while keeping existing attachments untouched.
              </p>
            </div>
          </div>
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header class="pb-3">
            <Card.Title class="text-sm">AI Provider</Card.Title>
            <Card.Description>Select the model used for match suggestions.</Card.Description>
          </Card.Header>
          <Card.Content>
            <LlmProviderModelSelector
              {provider}
              {model}
              onProviderChange={onProviderChange}
              onModelChange={onModelChange}
              onNavigateToSettings={onNavigateToSettings}
            />
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header class="pb-3">
            <Card.Title class="text-sm">Run</Card.Title>
            <Card.Description>Analyze the current ready videos and unassigned tracks.</Card.Description>
          </Card.Header>
          <Card.Content class="space-y-3">
            <Button class="w-full" onclick={() => void onAnalyze()} disabled={!canAnalyze || status === 'analyzing'}>
              {#if status === 'analyzing'}
                <Loader2 class="size-4 mr-2 animate-spin" />
                Analyzing
              {:else}
                <Sparkles class="size-4 mr-2" />
                Run AI Match
              {/if}
            </Button>

            {#if status === 'preview'}
              <Button class="w-full" onclick={onApply} disabled={selectedSuggestionCount === 0}>
                <CheckCircle2 class="size-4 mr-2" />
                Apply selected ({selectedSuggestionCount})
              </Button>
              <Button variant="ghost" class="w-full" onclick={onClear}>
                Clear suggestions
              </Button>
            {/if}

            {#if status === 'error' && error}
              <Alert.Root variant="destructive">
                <AlertTriangle class="size-4" />
                <Alert.Title>AI match failed</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Root>
            {/if}

            {#if status === 'preview' && warnings.length > 0}
              <Alert.Root
                role="status"
                aria-live="polite"
                class="border-amber-500/30 bg-amber-500/10"
              >
                <AlertTriangle class="size-4 text-amber-700" />
                <Alert.Title class="text-amber-700">Some AI suggestions were ignored</Alert.Title>
                <Alert.Description>
                <ul class="mt-2 space-y-1 text-muted-foreground">
                  {#each visibleWarnings as warning (warning)}
                    <li>{warning}</li>
                  {/each}
                </ul>
                {#if remainingWarningCount > 0}
                  <p class="mt-2 text-muted-foreground">{remainingWarningCount} more warning(s).</p>
                {/if}
                </Alert.Description>
              </Alert.Root>
            {/if}
          </Card.Content>
        </Card.Root>

        <div class="grid grid-cols-2 gap-2 text-sm">
          <Card.Root size="sm">
            <Card.Content>
              <p class="text-muted-foreground">Ready videos</p>
              <p class="text-2xl font-semibold">{videos.length}</p>
            </Card.Content>
          </Card.Root>
          <Card.Root size="sm">
            <Card.Content>
              <p class="text-muted-foreground">Unassigned</p>
              <p class="text-2xl font-semibold">{unassignedTracks.length}</p>
            </Card.Content>
          </Card.Root>
          <Card.Root size="sm">
            <Card.Content>
              <p class="text-muted-foreground">Matched</p>
              <p class="text-2xl font-semibold">{matchedSuggestionCount}</p>
            </Card.Content>
          </Card.Root>
          <Card.Root size="sm">
            <Card.Content>
              <p class="text-muted-foreground">Selected</p>
              <p class="text-2xl font-semibold">{selectedSuggestionCount}</p>
            </Card.Content>
          </Card.Root>
        </div>
      </div>
    </aside>

    <section class="min-w-0 overflow-hidden bg-background/45">
      <div class="flex h-full min-w-0 flex-col">
        <div class="flex items-center justify-between gap-4 border-b bg-background/70 px-6 py-4">
          <div class="min-w-0">
            <h2 class="font-semibold">Match board</h2>
            <p class="text-sm text-muted-foreground truncate">
              Expand each video to review existing attachments and AI proposals.
            </p>
          </div>
          {#if status === 'analyzing'}
            <Badge variant="secondary" class="gap-2">
              <Loader2 class="size-3 animate-spin" />
              Analyzing
            </Badge>
          {:else if status === 'preview'}
            <Badge>{selectedSuggestionCount} ready to apply</Badge>
          {:else}
            <Badge variant="outline">Preview required</Badge>
          {/if}
        </div>

        <ScrollArea class="min-h-0 flex-1">
          <div class="space-y-3 px-6 py-4">
            {#if videos.length === 0}
              <Empty.Root>
                <Empty.Header>
                  <Empty.Media>
                    <FileVideo class="size-10 text-muted-foreground/50" />
                  </Empty.Media>
                  <Empty.Title class="text-base">No ready videos</Empty.Title>
                  <Empty.Description>Add ready video files to build an AI match board.</Empty.Description>
                </Empty.Header>
              </Empty.Root>
            {:else}
              <Accordion.Root
                type="multiple"
                value={expandedVideoIds}
                onValueChange={handleExpandedVideoIdsChange}
                class="space-y-3"
              >
              {#each videos as video (video.id)}
                {@const attachedTracks = attachedTracksForVideo(video)}
                {@const suggestedTracks = suggestedTracksForVideo(video.id)}
                <Accordion.Item value={video.id} class="min-w-0 overflow-hidden last:border-b">
                  <Accordion.Trigger class="min-w-0 items-center overflow-hidden py-0 pr-4 text-left hover:no-underline [&>svg]:translate-y-0">
                    <div class="flex min-w-0 flex-1 items-center gap-3 overflow-hidden p-4 pr-0">
                      <div class="shrink-0 rounded-xl bg-primary/10 p-2 text-primary">
                        <FileVideo class="size-5" />
                      </div>
                      <div class="min-w-0 flex-1 overflow-hidden">
                        <p class="block w-full truncate font-medium" title={video.name}>{video.name}</p>
                        <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{sourceTrackCounts(video)}</span>
                          {#if video.duration}
                            <span>{formatDuration(video.duration)}</span>
                          {/if}
                          {#if video.size}
                            <span>{formatFileSize(video.size)}</span>
                          {/if}
                          <Badge variant={suggestedTracks.length > 0 ? 'default' : 'secondary'} class="h-5 px-2 text-[11px]">
                            {suggestedTracks.length} proposed
                          </Badge>
                          <Badge variant={attachedTracks.length > 0 ? 'secondary' : 'outline'} class="h-5 px-2 text-[11px]">
                            {attachedTracks.length} attached
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </Accordion.Trigger>

                  <Accordion.Content class="border-t bg-muted/15 p-4">
                    <div class="min-w-0 space-y-4 overflow-hidden">
                      <div class="min-w-0 space-y-2">
                        <div class="flex items-center justify-between">
                          <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Already attached</p>
                          <Badge variant="outline">{attachedTracks.length}</Badge>
                        </div>
                        {#if attachedTracks.length > 0}
                          <Item.Group class="min-w-0 gap-2">
                            {#each attachedTracks as track (track.id)}
                              {@const TrackIcon = getTrackIcon(track.type)}
                              <Item.Root size="xs" variant="outline" class="min-w-0 flex-nowrap" role="listitem">
                                <Item.Media>
                                  <TrackIcon class="size-4 shrink-0 text-muted-foreground" />
                                </Item.Media>
                                <Item.Content class="min-w-0">
                                  <Item.Title class="truncate text-sm" title={track.name}>{track.name}</Item.Title>
                                </Item.Content>
                                <Item.Actions class="shrink-0">
                                  <Badge variant="secondary" class="uppercase">{track.type}</Badge>
                                  {#if effectiveLanguage(track)}
                                    <Badge variant="outline">{formatLanguage(effectiveLanguage(track) ?? undefined)}</Badge>
                                  {/if}
                                </Item.Actions>
                              </Item.Root>
                            {/each}
                          </Item.Group>
                        {:else}
                          <Empty.Root class="border-0 p-2">
                            <Empty.Description>No imported tracks attached yet.</Empty.Description>
                          </Empty.Root>
                        {/if}
                      </div>

                      <div class="min-w-0 space-y-2">
                        <div class="flex items-center justify-between">
                          <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI proposals</p>
                          <Badge variant="outline">{suggestedTracks.length}</Badge>
                        </div>
                        {#if suggestedTracks.length > 0}
                          <Item.Group class="min-w-0 gap-2">
                            {#each suggestedTracks as suggestion (suggestion.trackId)}
                              {@const track = trackMap.get(suggestion.trackId)}
                              {@const TrackIcon = track ? getTrackIcon(track.type) : FileAudio}
                              <Item.Root size="sm" variant="outline" class="min-w-0 items-start" role="listitem">
                                <Checkbox
                                  class="mt-0.5"
                                  checked={suggestion.selected}
                                  aria-label={`Select ${track?.name ?? suggestion.trackId}`}
                                  onCheckedChange={(checked) => onToggleSuggestion(suggestion.trackId, !!checked)}
                                />
                                <Item.Media>
                                  <TrackIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                                </Item.Media>
                                <Item.Content class="min-w-0">
                                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                                    <Item.Title class="min-w-0 flex-1 truncate text-sm" title={track?.name ?? suggestion.trackId}>
                                      {track?.name ?? suggestion.trackId}
                                    </Item.Title>
                                    {#if track}
                                      <Badge variant="outline" class="shrink-0 uppercase">{track.type}</Badge>
                                    {/if}
                                    <Badge class={cn('shrink-0', getConfidenceClass(suggestion.confidence))}>
                                      {suggestion.confidence.charAt(0).toUpperCase() + suggestion.confidence.slice(1)}
                                    </Badge>
                                  </div>
                                  <Item.Description class="break-words">{suggestion.reason}</Item.Description>
                                </Item.Content>
                              </Item.Root>
                            {/each}
                          </Item.Group>
                        {:else if status === 'preview'}
                          <Empty.Root class="border-0 p-2">
                            <Empty.Description>The AI did not propose tracks for this video.</Empty.Description>
                          </Empty.Root>
                        {:else}
                          <Empty.Root class="border-0 p-2">
                            <Empty.Description>Run AI Match to generate proposals.</Empty.Description>
                          </Empty.Root>
                        {/if}
                      </div>
                    </div>
                  </Accordion.Content>
                </Accordion.Item>
              {/each}
              </Accordion.Root>

              {#if unmatchedSuggestions.length > 0}
                <Card.Root class="border-dashed">
                  <Card.Header class="flex-row items-center gap-2">
                    <Unlink class="size-4 text-muted-foreground" />
                    <Card.Title class="text-base">Unmatched suggestions</Card.Title>
                    <Card.Action>
                      <Badge variant="secondary">{unmatchedSuggestions.length}</Badge>
                    </Card.Action>
                  </Card.Header>
                  <Card.Content>
                  <Item.Group class="min-w-0 gap-2">
                    {#each unmatchedSuggestions as suggestion (suggestion.trackId)}
                      {@const track = trackMap.get(suggestion.trackId)}
                      <Item.Root size="sm" variant="outline" class="min-w-0" role="listitem">
                        <Item.Content class="min-w-0">
                        <div class="flex min-w-0 flex-wrap items-center gap-2">
                          <Item.Title class="min-w-0 flex-1 truncate" title={track?.name ?? suggestion.trackId}>
                            {track?.name ?? suggestion.trackId}
                          </Item.Title>
                          <Badge class={cn('shrink-0', getConfidenceClass(suggestion.confidence))}>
                            {suggestion.confidence.charAt(0).toUpperCase() + suggestion.confidence.slice(1)}
                          </Badge>
                        </div>
                        <Item.Description class="break-words">{suggestion.reason}</Item.Description>
                        </Item.Content>
                      </Item.Root>
                    {/each}
                  </Item.Group>
                  </Card.Content>
                </Card.Root>
              {/if}
            {/if}
          </div>
        </ScrollArea>
      </div>
    </section>
  </div>
</div>
