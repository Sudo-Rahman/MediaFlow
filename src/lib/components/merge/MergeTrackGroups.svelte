<script lang="ts">
  import { LayoutGrid, ChevronDown, ChevronRight, RefreshCw, Wand2 } from '@lucide/svelte';
  import type { TrackGroup } from '$lib/types';
  import { mergeStore } from '$lib/stores/merge.svelte';
  import { MergeTrackGroupCard } from '$lib/components/merge';
  import { MergeGroupEditor } from '$lib/components/merge';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Separator } from '$lib/components/ui/separator';
  import { cn } from '$lib/utils';
  ;
  ;
  ;
  ;
  ;

  interface MergeTrackGroupsProps {
    class?: string;
  }

  let { class: className = '' }: MergeTrackGroupsProps = $props();

  // State for group editor dialog
  let editorOpen = $state(false);
  let selectedGroup = $state<TrackGroup | null>(null);

  // Get all groups from store
  const groups = $derived(mergeStore.trackGroups);

  // Total tracks count
  const totalTracks = $derived(
    groups.reduce((sum, g) => sum + g.trackIds.length, 0)
  );

  // Grouped by type for display
  const groupsByType = $derived(() => {
    const byType = new Map<string, TrackGroup[]>();
    
    groups.forEach(group => {
      if (!byType.has(group.type)) {
        byType.set(group.type, []);
      }
      byType.get(group.type)!.push(group);
    });
    
    return byType;
  });

  // Type labels
  const typeLabels: Record<string, string> = {
    video: 'Video',
    audio: 'Audio',
    subtitle: 'Subtitle',
    data: 'Data'
  };

  function handleEditGroup(groupId: string) {
    const group = groups.find(g => g.id === groupId);
    if (group) {
      selectedGroup = group;
      editorOpen = true;
    }
  }

  function handleCloseEditor() {
    editorOpen = false;
    selectedGroup = null;
  }

  function handleRefreshGroups() {
    mergeStore.generateTrackGroups();
  }

  function handleExpandAll() {
    mergeStore.expandAllGroups();
  }

  function handleCollapseAll() {
    mergeStore.collapseAllGroups();
  }

  // Generate groups when video files or imported tracks change
  // Use untrack to avoid circular dependency
  let lastVideoCount = $state(0);
  let lastTrackCount = $state(0);
  
  $effect(() => {
    const videoCount = mergeStore.videoFiles.length;
    const trackCount = mergeStore.importedTracks.length;
    
    // Only regenerate if counts actually changed
    if (videoCount !== lastVideoCount || trackCount !== lastTrackCount) {
      lastVideoCount = videoCount;
      lastTrackCount = trackCount;
      mergeStore.generateTrackGroups();
    }
  });
</script>

<div class={cn("flex flex-col h-full", className)}>
  <!-- Header -->
  <div class="flex items-center justify-between p-4 border-b bg-muted/30">
    <div class="flex items-center gap-3">
      <LayoutGrid class="size-5 text-muted-foreground" />
      <div>
        <h3 class="font-medium">Track Groups</h3>
        <p class="text-sm text-muted-foreground">
          {groups.length} group{groups.length > 1 ? 's' : ''} • {totalTracks} track{totalTracks > 1 ? 's' : ''}
        </p>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onclick={handleExpandAll}
        title="Expand all"
      >
        <ChevronDown class="size-4 mr-1" />
        Expand all
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onclick={handleCollapseAll}
        title="Collapse all"
      >
        <ChevronRight class="size-4 mr-1" />
        Collapse all
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onclick={handleRefreshGroups}
        title="Refresh groups"
      >
        <RefreshCw class="size-4" />
      </Button>
    </div>
  </div>

  <!-- Groups List -->
  <div class="flex-1 overflow-y-auto">
    <div class="p-4 space-y-6">
      {#if groups.length === 0}
        <div class="text-center py-12 text-muted-foreground">
          <LayoutGrid class="size-12 mx-auto mb-4 opacity-50" />
          <p>No tracks to display</p>
          <p class="text-sm mt-1">Import videos and tracks to get started</p>
        </div>
      {:else}
        {#each Array.from(groupsByType().entries()) as [type, typeGroups]}
          <div class="space-y-3">
            <!-- Type Header -->
            <div class="flex items-center gap-2">
              <h4 class="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                {typeLabels[type] || type}
              </h4>
              <Badge variant="secondary" class="text-xs">
                {typeGroups.length} group{typeGroups.length > 1 ? 's' : ''}
              </Badge>
            </div>

            <!-- Groups for this type -->
            <div class="space-y-2">
              {#each typeGroups as group (group.id)}
                <MergeTrackGroupCard
                  {group}
                  onEdit={handleEditGroup}
                />
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Group Editor Dialog -->
  <MergeGroupEditor
    bind:open={editorOpen}
    group={selectedGroup}
    onClose={handleCloseEditor}
  />
</div>