<script lang="ts">
  import * as Tabs from '$lib/components/ui/tabs';

  import type { FileInfo } from '$lib/stores/info.svelte';

  import { groupTracksByType } from './info-utils';
  import InfoEmptyState from './info-empty-state.svelte';
  import InfoOverviewTab from './info-overview-tab.svelte';
  import InfoRawDataTab from './info-raw-data-tab.svelte';
  import InfoTracksTab from './info-tracks-tab.svelte';

  type InfoTab = 'overview' | 'tracks' | 'raw';

  interface Props {
    file: FileInfo | null;
  }

  let { file }: Props = $props();

  let activeTab = $state<InfoTab>('overview');

  const trackGroups = $derived.by(() => (file ? groupTracksByType(file.tracks) : groupTracksByType([])));
</script>

{#if file}
  <div class="flex items-center p-4 border-b">
    <h2 class="font-semibold truncate" title={file.name}>{file.name}</h2>
  </div>

  <div class="flex-1 min-h-0 overflow-auto">
    <Tabs.Root bind:value={activeTab} class="h-full">
      <div class="px-4 pt-2">
        <Tabs.List>
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="tracks">Tracks ({file.tracks.length})</Tabs.Trigger>
          <Tabs.Trigger value="raw">Raw Data</Tabs.Trigger>
        </Tabs.List>
      </div>

      <Tabs.Content value="overview" class="mt-0">
        <InfoOverviewTab {file} {trackGroups} />
      </Tabs.Content>

      <Tabs.Content value="tracks" class="mt-0">
        <InfoTracksTab tracks={file.tracks} />
      </Tabs.Content>

      <Tabs.Content value="raw" class="mt-0">
        <InfoRawDataTab rawData={file.rawData} />
      </Tabs.Content>
    </Tabs.Root>
  </div>
{:else}
  <InfoEmptyState />
{/if}
