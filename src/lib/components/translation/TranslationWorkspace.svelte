<script lang="ts">
  import { tick } from 'svelte';
  import { AlertCircle, Check, ChevronDown, Copy, Ellipsis, FileText, Info, Languages, Loader2, Pencil, RotateCw, Save, X } from '@lucide/svelte';

  import { Textarea } from '$lib/components/ui/textarea';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { VirtualizedTextPreview } from '$lib/components/shared';
  import * as HoverCard from '$lib/components/ui/hover-card';
  import * as Item from '$lib/components/ui/item';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Popover from '$lib/components/ui/popover';
  import { Progress } from '$lib/components/ui/progress';
  import * as Resizable from '$lib/components/ui/resizable';
  import type { TranslationJob, TranslationVersion } from '$lib/types';
  import { PENDING_TRANSLATION_VERSION_ID } from './translation-view-utils';

  interface TranslationWorkspaceProps {
    selectedJob: TranslationJob | null;
    selectedJobVersions: TranslationVersion[];
    activeVersionId: string | null;
    activeVersion: TranslationVersion | null;
    displayedContent: string;
    tokenCount: number | null;
    isCountingTokens: boolean;
    isTranslating: boolean;
    isPendingVersionSelected: boolean;
    pendingVersionName: string | null;
    onSelectVersion: (versionId: string) => void;
    onCopyContent: (content: string) => void | Promise<void>;
    onEditContent: (content: string) => void;
    onRetryWithMoreBatches: (job: TranslationJob) => void | Promise<void>;
  }

  let {
    selectedJob,
    selectedJobVersions,
    activeVersionId,
    activeVersion,
    displayedContent,
    tokenCount,
    isCountingTokens,
    isTranslating,
    isPendingVersionSelected,
    pendingVersionName,
    onSelectVersion,
    onCopyContent,
    onEditContent,
    onRetryWithMoreBatches,
  }: TranslationWorkspaceProps = $props();

  let versionPopoverOpen = $state(false);
  let isEditingTranslation = $state(false);
  let draftContent = $state('');
  let currentEditKey = $state('');

  const activeUsage = $derived(
    isPendingVersionSelected ? undefined : activeVersion?.usage ?? (activeVersion ? undefined : selectedJob?.result?.usage)
  );
  const hasPendingVersion = $derived(Boolean(pendingVersionName));
  const activeVersionLabel = $derived(isPendingVersionSelected ? pendingVersionName : activeVersion?.name);
  const selectableVersionCount = $derived(selectedJobVersions.length + (hasPendingVersion ? 1 : 0));
  const hasOverflowActions = $derived(Boolean(activeVersionLabel || activeUsage || (displayedContent && !isPendingVersionSelected)));

  $effect(() => {
    const nextEditKey = `${selectedJob?.id ?? 'none'}:${activeVersionId ?? 'result'}`;
    if (nextEditKey !== currentEditKey) {
      currentEditKey = nextEditKey;
      isEditingTranslation = false;
      draftContent = displayedContent;
    }
  });

  function getStatusBadgeVariant(status: TranslationJob['status']): 'default' | 'destructive' | 'secondary' {
    if (status === 'completed') {
      return 'default';
    }
    if (status === 'error') {
      return 'destructive';
    }
    return 'secondary';
  }

  function handleContentInput(event: Event): void {
    draftContent = (event.currentTarget as HTMLTextAreaElement).value;
  }

  async function handleSelectVersion(versionId: string): Promise<void> {
    versionPopoverOpen = false;
    await tick();
    requestAnimationFrame(() => {
      onSelectVersion(versionId);
    });
  }

  function formatVersionMeta(version: TranslationVersion): string {
    const createdAt = new Date(version.createdAt);
    const createdAtLabel = Number.isNaN(createdAt.getTime())
      ? 'Unknown date'
      : createdAt.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

    return `${version.provider} · ${version.model} · ${createdAtLabel}`;
  }

  function startEditingTranslation(): void {
    draftContent = displayedContent;
    isEditingTranslation = true;
  }

  function saveTranslationEdit(): void {
    onEditContent(draftContent);
    isEditingTranslation = false;
  }

  function cancelTranslationEdit(): void {
    draftContent = displayedContent;
    isEditingTranslation = false;
  }

</script>

<div class="flex-2 flex flex-col min-h-0 overflow-hidden">
  {#if selectedJob}
    <div class="p-4 border-b flex items-center justify-between">
      <div class="flex items-center gap-2 min-w-0">
        <FileText class="size-5 text-primary shrink-0" />
        <h3 class="font-medium truncate">{selectedJob.file.name}</h3>
        <Badge variant={getStatusBadgeVariant(selectedJob.status)}>
          {selectedJob.status}
        </Badge>
      </div>

    </div>

    <Resizable.PaneGroup direction="horizontal" class="flex-1 min-h-0 min-w-0">
      <Resizable.Pane defaultSize={50} minSize={20}>
        <div class="h-full min-w-0 flex flex-col [contain:layout_paint_style]">
          <div class="@container h-10 px-2 bg-muted/30 border-b flex items-center justify-between gap-2 overflow-hidden">
            <span class="text-sm font-medium shrink-0">Original</span>
            <HoverCard.Root openDelay={200}>
              <HoverCard.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-xs"
                    class="text-muted-foreground hover:text-foreground"
                    aria-label="Show original metrics"
                  >
                    <Info class="size-3.5" />
                  </Button>
                {/snippet}
              </HoverCard.Trigger>
              <HoverCard.Content align="end" class="w-56 rounded-2xl p-3">
                <div class="space-y-2">
                  <p class="text-xs font-medium text-muted-foreground">Original metrics</p>
                  <div class="space-y-1 text-xs">
                    <div class="flex items-center justify-between gap-4">
                      <span class="text-muted-foreground">Tokens</span>
                      {#if tokenCount !== null}
                        <span class="font-medium">~{tokenCount.toLocaleString()}</span>
                      {:else if isCountingTokens}
                        <span class="inline-flex items-center gap-1 text-muted-foreground">
                          <Loader2 class="size-3 animate-spin" />
                          Counting
                        </span>
                      {:else}
                        <span class="text-muted-foreground">Unavailable</span>
                      {/if}
                    </div>
                  </div>
                </div>
              </HoverCard.Content>
            </HoverCard.Root>
          </div>
          <div class="flex-1 min-h-0 min-w-0 overflow-hidden overscroll-contain">
            <VirtualizedTextPreview
              content={selectedJob.file.content}
              loadingMessage="Preparing original preview..."
            />
          </div>
        </div>
      </Resizable.Pane>

      <Resizable.Handle withHandle />

      <Resizable.Pane defaultSize={50} minSize={20}>
        <div class="h-full min-w-0 flex flex-col [contain:layout_paint_style]">
          <div class="@container h-10 px-2 bg-muted/30 border-b flex items-center gap-2 overflow-hidden">
            <div class="text-sm font-medium min-w-0 flex flex-1 items-center gap-1.5 whitespace-nowrap">
              <span class="shrink-0">Translation</span>
              {#if activeVersionLabel && selectableVersionCount > 1}
                <Popover.Root bind:open={versionPopoverOpen}>
                  <Popover.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="xs"
                        class="mr-2 h-6 min-w-0 max-w-44 shrink px-2 text-xs text-muted-foreground hover:text-foreground @max-[14rem]:hidden"
                        aria-label="Select translation version"
                        aria-expanded={versionPopoverOpen}
                      >
                        {#if isPendingVersionSelected}
                          <Loader2 class="size-3 animate-spin" />
                        {/if}
                        <span class="truncate">{activeVersionLabel}</span>
                        <ChevronDown class="size-3" />
                      </Button>
                    {/snippet}
                  </Popover.Trigger>
                  <Popover.Content align="end" class="w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-2">
                    <div class="px-2 py-1.5">
                      <p class="text-xs font-medium text-muted-foreground">Translation version</p>
                    </div>
                    <div class="max-h-72 overflow-y-auto">
                      {#if pendingVersionName}
                        <Item.Root
                          size="xs"
                          class="cursor-pointer flex-nowrap hover:bg-muted"
                          aria-current={isPendingVersionSelected ? 'true' : undefined}
                          onclick={() => handleSelectVersion(PENDING_TRANSLATION_VERSION_ID)}
                        >
                          {#snippet child({ props })}
                            <button type="button" {...props}>
                              <Item.Content class="min-w-0 overflow-hidden">
                                <Item.Title class="w-full truncate">{pendingVersionName}</Item.Title>
                                <Item.Description class="inline-flex w-full items-center gap-1 truncate text-xs">
                                  <Loader2 class="size-3 animate-spin" />
                                  Translating
                                </Item.Description>
                              </Item.Content>
                              <Item.Actions class="shrink-0">
                                {#if isPendingVersionSelected}
                                  <Check class="size-4 shrink-0 text-primary" />
                                {/if}
                              </Item.Actions>
                            </button>
                          {/snippet}
                        </Item.Root>
                      {/if}
                      {#each selectedJobVersions as version (version.id)}
                        <Item.Root
                          size="xs"
                          class="cursor-pointer flex-nowrap hover:bg-muted"
                          aria-current={version.id === activeVersionId ? 'true' : undefined}
                          onclick={() => handleSelectVersion(version.id)}
                        >
                          {#snippet child({ props })}
                            <button type="button" {...props}>
                              <Item.Content class="min-w-0 overflow-hidden">
                                <Item.Title class="w-full truncate">{version.name}</Item.Title>
                                <Item.Description class="block w-full truncate text-xs">
                                  {formatVersionMeta(version)}
                                </Item.Description>
                              </Item.Content>
                              <Item.Actions class="shrink-0">
                                {#if version.id === activeVersionId}
                                  <Check class="size-4 shrink-0 text-primary" />
                                {/if}
                              </Item.Actions>
                            </button>
                          {/snippet}
                        </Item.Root>
                      {/each}
                    </div>
                  </Popover.Content>
                </Popover.Root>
              {:else if activeVersionLabel}
                <span class="inline-flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                  {#if isPendingVersionSelected}
                    <Loader2 class="size-3 animate-spin" />
                  {/if}
                  ({activeVersionLabel})
                </span>
              {/if}
            </div>
            <div class="ml-auto flex shrink-0 items-center gap-1">
              {#if activeUsage}
                <HoverCard.Root openDelay={200}>
                  <HoverCard.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-xs"
                        class="text-muted-foreground hover:text-foreground @max-[18rem]:hidden"
                        aria-label="Show translation metrics"
                      >
                        <Info class="size-3.5" />
                      </Button>
                    {/snippet}
                  </HoverCard.Trigger>
                  <HoverCard.Content align="end" class="w-56 rounded-2xl p-3">
                    <div class="space-y-2">
                      <p class="text-xs font-medium text-muted-foreground">Translation metrics</p>
                      <div class="space-y-1 text-xs">
                        <div class="flex items-center justify-between gap-4">
                          <span class="text-muted-foreground">Tokens</span>
                          <span class="font-medium">{activeUsage.totalTokens.toLocaleString()}</span>
                        </div>
                        <div class="flex items-center justify-between gap-4">
                          <span class="text-muted-foreground">Input</span>
                          <span>{activeUsage.promptTokens.toLocaleString()}</span>
                        </div>
                        <div class="flex items-center justify-between gap-4">
                          <span class="text-muted-foreground">Output</span>
                          <span>{activeUsage.completionTokens.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </HoverCard.Content>
                </HoverCard.Root>
              {/if}
              {#if displayedContent && !isPendingVersionSelected}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  class="@max-[18rem]:hidden"
                  aria-label="Copy translation"
                  title="Copy translation"
                  onclick={() => onCopyContent(displayedContent)}
                >
                  <Copy class="size-3.5" />
                </Button>
                {#if displayedContent && !isEditingTranslation}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    class="@max-[18rem]:hidden"
                    aria-label="Edit translation"
                    title="Edit translation"
                    onclick={startEditingTranslation}
                  >
                    <Pencil class="size-3.5" />
                  </Button>
                {:else if displayedContent && isEditingTranslation}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    class="@max-[18rem]:hidden"
                    aria-label="Save translation edit"
                    title="Save translation edit"
                    onclick={saveTranslationEdit}
                  >
                    <Save class="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    class="@max-[18rem]:hidden"
                    aria-label="Cancel translation edit"
                    title="Cancel translation edit"
                    onclick={cancelTranslationEdit}
                  >
                    <X class="size-3.5" />
                  </Button>
                {/if}
              {/if}
              {#if hasOverflowActions}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-xs"
                        class="hidden @max-[18rem]:inline-flex"
                        aria-label="More translation actions"
                        title="More translation actions"
                      >
                        <Ellipsis class="size-3.5" />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" class="w-64">
                    {#if activeVersionLabel}
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger>
                          {#if isPendingVersionSelected}
                            <Loader2 class="size-4 animate-spin" />
                          {/if}
                          <span class="min-w-0 flex-1 truncate">Version</span>
                          <span class="max-w-24 truncate text-xs text-muted-foreground">{activeVersionLabel}</span>
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.SubContent class="w-72">
                          {#if pendingVersionName}
                            <DropdownMenu.Item onclick={() => handleSelectVersion(PENDING_TRANSLATION_VERSION_ID)}>
                              <Loader2 class="size-4 animate-spin" />
                              <span class="truncate">{pendingVersionName}</span>
                              {#if isPendingVersionSelected}
                                <Check class="ml-auto size-4" />
                              {/if}
                            </DropdownMenu.Item>
                          {/if}
                          {#each selectedJobVersions as version (version.id)}
                            <DropdownMenu.Item onclick={() => handleSelectVersion(version.id)}>
                              <span class="truncate">{version.name}</span>
                              {#if version.id === activeVersionId}
                                <Check class="ml-auto size-4" />
                              {/if}
                            </DropdownMenu.Item>
                          {/each}
                        </DropdownMenu.SubContent>
                      </DropdownMenu.Sub>
                    {/if}

                    {#if activeUsage}
                      <DropdownMenu.Separator />
                      <DropdownMenu.Label>Metrics</DropdownMenu.Label>
                      <div class="px-3 py-2 text-xs">
                        <div class="flex items-center justify-between gap-4">
                          <span class="text-muted-foreground">Tokens</span>
                          <span class="font-medium">{activeUsage.totalTokens.toLocaleString()}</span>
                        </div>
                        <div class="mt-1 flex items-center justify-between gap-4">
                          <span class="text-muted-foreground">Input</span>
                          <span>{activeUsage.promptTokens.toLocaleString()}</span>
                        </div>
                        <div class="mt-1 flex items-center justify-between gap-4">
                          <span class="text-muted-foreground">Output</span>
                          <span>{activeUsage.completionTokens.toLocaleString()}</span>
                        </div>
                      </div>
                    {/if}

                    {#if displayedContent && !isPendingVersionSelected}
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onclick={() => onCopyContent(displayedContent)}>
                        <Copy class="size-4" />
                        Copy translation
                      </DropdownMenu.Item>
                      {#if !isEditingTranslation}
                        <DropdownMenu.Item onclick={startEditingTranslation}>
                          <Pencil class="size-4" />
                          Edit translation
                        </DropdownMenu.Item>
                      {:else}
                        <DropdownMenu.Item onclick={saveTranslationEdit}>
                          <Save class="size-4" />
                          Save edit
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onclick={cancelTranslationEdit}>
                          <X class="size-4" />
                          Cancel edit
                        </DropdownMenu.Item>
                      {/if}
                    {/if}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              {/if}
            </div>
          </div>

          <div class="flex-1 min-h-0 min-w-0 overflow-hidden overscroll-contain">
            {#if isPendingVersionSelected}
              <div class="flex flex-col items-center justify-center h-full p-8 gap-4">
                <Loader2 class="size-8 text-primary animate-spin" />
                <div class="text-center">
                  <p class="font-medium">Translating...</p>
                  <p class="text-sm text-muted-foreground">
                    {selectedJob.progress}%
                    {#if selectedJob.totalBatches > 1}
                      - Batch {selectedJob.currentBatch}/{selectedJob.totalBatches}
                    {/if}
                  </p>
                </div>
                <Progress value={selectedJob.progress} class="w-48" />
              </div>
            {:else if displayedContent && isEditingTranslation}
              <Textarea
                class="w-full h-full p-4 resize-none font-mono text-sm border-0 focus-visible:ring-0 rounded-none bg-transparent overflow-auto whitespace-pre field-sizing-fixed [contain:layout_paint_style] [tab-size:2]"
                wrap="off"
                spellcheck="false"
                value={draftContent}
                oninput={handleContentInput}
              />
            {:else if displayedContent}
              <VirtualizedTextPreview
                content={displayedContent}
                loadingMessage="Preparing translation preview..."
              />
            {:else if selectedJob.status === 'error'}
              <div class="flex flex-col items-center justify-center h-full p-8 gap-4">
                <AlertCircle class="size-8 text-destructive" />
                <div class="text-center">
                  <p class="font-medium text-destructive">Translation failed</p>
                  <p class="text-sm text-muted-foreground mt-2">{selectedJob.error}</p>
                </div>
                {#if selectedJob.result?.truncated}
                  <div class="flex flex-col items-center gap-2 mt-2">
                    <p class="text-xs text-muted-foreground">Response was truncated due to token limits</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => onRetryWithMoreBatches(selectedJob)}
                      disabled={isTranslating}
                    >
                      <RotateCw class="size-4 mr-2" />
                      Retry with more batches
                    </Button>
                  </div>
                {/if}
              </div>
            {:else if selectedJob.status === 'cancelled'}
              <div class="flex flex-col items-center justify-center h-full p-8 gap-4">
                <X class="size-8 text-orange-500" />
                <p class="font-medium text-orange-500">Translation cancelled</p>
              </div>
            {:else}
              <div class="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground">
                <Languages class="size-8 mb-4" />
                <p>Click "Translate" to start</p>
              </div>
            {/if}
          </div>
        </div>
      </Resizable.Pane>
    </Resizable.PaneGroup>
  {:else}
    <div class="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground p-8">
      <Languages class="size-12 mb-4" />
      <p class="text-lg font-medium">No file selected</p>
      <p class="text-sm">Import subtitle files to get started</p>
    </div>
  {/if}
</div>
