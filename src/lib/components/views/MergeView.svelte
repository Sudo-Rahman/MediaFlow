<script lang="ts" module>
  export interface MergeViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { toast } from 'svelte-sonner';
  import { flip } from 'svelte/animate';

  import { mergeStore } from '$lib/stores';
  import { recentFilesStore } from '$lib/stores/recentFiles.svelte';
  import { scanFile } from '$lib/services/ffprobe';
  import { dndzone } from '$lib/utils/dnd';
  import { logAndToast } from '$lib/utils/log-toast';
  import type { MergeVideoFile, ImportedTrack, MergeTrack, MergeTrackConfig } from '$lib/types';

  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Card from '$lib/components/ui/card';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as Tabs from '$lib/components/ui/tabs';
  import { MergeTrackSettings, MergeOutputPanel } from '$lib/components/merge';

  import FileVideo from 'lucide-svelte/icons/file-video';
  import FileAudio from 'lucide-svelte/icons/file-audio';
  import Subtitles from 'lucide-svelte/icons/subtitles';
  import Video from 'lucide-svelte/icons/video';
  import Film from 'lucide-svelte/icons/film';
  import Volume2 from 'lucide-svelte/icons/volume-2';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Plus from 'lucide-svelte/icons/plus';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import XCircle from 'lucide-svelte/icons/x-circle';
  import Wand2 from 'lucide-svelte/icons/wand-2';
  import Link from 'lucide-svelte/icons/link';
  import Unlink from 'lucide-svelte/icons/unlink';
  import Settings2 from 'lucide-svelte/icons/settings-2';
  import GripVertical from 'lucide-svelte/icons/grip-vertical';
  import Clock from 'lucide-svelte/icons/clock';
  import Layers from 'lucide-svelte/icons/layers';

  // Constants
  const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.webm', '.m4v', '.mks', '.mka'];
  const SUBTITLE_EXTENSIONS = ['.ass', '.ssa', '.srt', '.sub', '.idx', '.vtt'];
  const AUDIO_EXTENSIONS = ['.aac', '.ac3', '.dts', '.flac', '.mp3', '.ogg', '.wav', '.eac3', '.opus'];
  const ALL_EXTENSIONS = [...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS, ...AUDIO_EXTENSIONS];
  const FLIP_DURATION_MS = 200;

  // Track settings dialog
  let settingsOpen = $state(false);
  let editingTrackId = $state<string | null>(null);
  let editingTrackType = $state<'imported' | 'source'>('imported');

  // Derived states
  const editingImportedTrack = $derived(() => {
    if (!editingTrackId || editingTrackType !== 'imported') return null;
    return mergeStore.importedTracks.find(t => t.id === editingTrackId) || null;
  });

  const editingSourceTrack = $derived(() => {
    if (!editingTrackId || editingTrackType !== 'source') return null;
    for (const video of mergeStore.videoFiles) {
      const track = video.tracks.find(t => t.id === editingTrackId);
      if (track) return track;
    }
    return null;
  });

  const selectedVideoTracks = $derived(() => mergeStore.selectedVideo?.tracks || []);

  // DnD items - mutable state required by svelte-dnd-action
  let unassignedItems = $state<(ImportedTrack & { id: string })[]>([]);
  let attachedItems = $state<(ImportedTrack & { id: string })[]>([]);

  // Sync items with store
  $effect(() => {
    unassignedItems = mergeStore.unassignedTracks.map(t => ({ ...t }));
  });

  $effect(() => {
    attachedItems = mergeStore.selectedVideoId
      ? mergeStore.getAttachedTracks(mergeStore.selectedVideoId).map(t => ({ ...t }))
      : [];
  });

  function getFileIcon(path: string) {
    const ext = path.toLowerCase().substring(path.lastIndexOf('.'));
    if (SUBTITLE_EXTENSIONS.includes(ext)) return Subtitles;
    if (AUDIO_EXTENSIONS.includes(ext) || ext === '.mka') return FileAudio;
    return FileVideo;
  }

  function getTrackTypeColor(type: string) {
    switch (type) {
      case 'video': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30';
      case 'audio': return 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30';
      case 'subtitle': return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30';
      default: return 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30';
    }
  }

  function getTrackIcon(type: string) {
    switch (type) {
      case 'video': return Video;
      case 'audio': return Volume2;
      case 'subtitle': return Subtitles;
      default: return FileVideo;
    }
  }

  function formatSeriesInfo(season?: number, episode?: number) {
    if (episode === undefined) return null;
    if (season !== undefined) {
      return `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
    }
    return `EP ${episode.toString().padStart(2, '0')}`;
  }

  // File import handlers
  export async function handleFileDrop(paths: string[]) {
    const supportedPaths = paths.filter(p => {
      const ext = p.toLowerCase().substring(p.lastIndexOf('.'));
      return ALL_EXTENSIONS.includes(ext);
    });

    if (supportedPaths.length === 0) {
      toast.warning('No supported files detected');
      return;
    }

    await addFiles(supportedPaths);
  }

  async function handleAddVideoFiles() {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Video files', extensions: VIDEO_EXTENSIONS.map(e => e.slice(1)) }]
    });
    if (selected) {
      await addFiles(Array.isArray(selected) ? selected : [selected]);
    }
  }

  async function handleAddTrackFiles() {
    const selected = await open({
      multiple: true,
      filters: [
        { name: 'All tracks', extensions: [...SUBTITLE_EXTENSIONS, ...AUDIO_EXTENSIONS].map(e => e.slice(1)) },
        { name: 'Subtitles', extensions: SUBTITLE_EXTENSIONS.map(e => e.slice(1)) },
        { name: 'Audio', extensions: AUDIO_EXTENSIONS.map(e => e.slice(1)) }
      ]
    });
    if (selected) {
      await addFiles(Array.isArray(selected) ? selected : [selected]);
    }
  }

  async function addFiles(paths: string[]) {
    if (mergeStore.status === 'completed') {
      mergeStore.reset();
    }

    let videosAdded = 0, tracksAdded = 0, skipped = 0;

    for (const path of paths) {
      if (mergeStore.isFileAlreadyImported(path)) {
        skipped++;
        continue;
      }

      const name = path.split('/').pop() || path.split('\\').pop() || path;
      const ext = path.toLowerCase().substring(path.lastIndexOf('.'));

      if (VIDEO_EXTENSIONS.includes(ext)) {
        const fileId = mergeStore.addVideoFile({
          path, name, size: 0, tracks: [], status: 'scanning'
        });

        try {
          const scanned = await scanFile(path);
          const tracks: MergeTrack[] = scanned.tracks.map(t => ({
            id: `${fileId}-track-${t.id}`,
            sourceFileId: fileId,
            originalIndex: t.index,
            type: t.type,
            codec: t.codec,
            codecLong: t.codecLong,
            language: t.language,
            title: t.title,
            bitrate: t.bitrate,
            width: t.width,
            height: t.height,
            frameRate: t.frameRate,
            channels: t.channels,
            sampleRate: t.sampleRate,
            forced: t.forced,
            default: t.default,
          }));

          mergeStore.updateVideoFile(fileId, {
            size: scanned.size,
            duration: scanned.duration,
            tracks,
            status: 'ready'
          });

          // Initialize track configs for source tracks
          for (const track of tracks) {
            mergeStore.initSourceTrackConfig(track);
          }

          videosAdded++;
        } catch (error) {
          mergeStore.updateVideoFile(fileId, {
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } else {
        const type = SUBTITLE_EXTENSIONS.includes(ext) ? 'subtitle' : 'audio';
        const codec = getCodecFromExtension(ext);

        mergeStore.addImportedTrack({
          path, name, type, codec, language: undefined, title: name
        });
        tracksAdded++;
      }
    }

    const parts = [];
    if (videosAdded > 0) parts.push(`${videosAdded} video(s)`);
    if (tracksAdded > 0) parts.push(`${tracksAdded} track(s)`);
    if (skipped > 0) parts.push(`${skipped} skipped`);

    if (parts.length > 0) {
      toast.success(`Added: ${parts.join(', ')}`);
    }
  }

  function getCodecFromExtension(ext: string): string {
    const map: Record<string, string> = {
      '.ass': 'ass', '.ssa': 'ssa', '.srt': 'subrip', '.sub': 'sub', '.vtt': 'webvtt',
      '.aac': 'aac', '.ac3': 'ac3', '.dts': 'dts', '.flac': 'flac',
      '.mp3': 'mp3', '.ogg': 'vorbis', '.wav': 'pcm', '.eac3': 'eac3', '.opus': 'opus'
    };
    return map[ext] || ext.slice(1);
  }

  function handleAutoMatch() {
    mergeStore.autoMatchByEpisodeNumber();
    const matched = mergeStore.videoFiles.filter(v => v.attachedTracks.length > 0).length;
    if (matched > 0) {
      toast.success(`Auto-matched ${matched} video(s) with tracks`);
    } else {
      toast.info('No matches found. Check episode numbers in filenames.');
    }
  }

  // DnD callbacks
  function handleUnassignedConsider(items: typeof unassignedItems) {
    unassignedItems = items;
  }

  function handleUnassignedFinalize(items: typeof unassignedItems) {
    unassignedItems = items;
    // Sync with store: detach items now in unassigned from any video
    for (const item of items) {
      for (const video of mergeStore.videoFiles) {
        if (video.attachedTracks.some(at => at.trackId === item.id)) {
          mergeStore.detachTrackFromVideo(item.id, video.id);
        }
      }
    }
  }

  function handleAttachedConsider(items: typeof attachedItems) {
    attachedItems = items;
  }

  function handleAttachedFinalize(items: typeof attachedItems) {
    attachedItems = items;
    if (!mergeStore.selectedVideoId) return;

    const currentAttached = new Set(
      mergeStore.selectedVideo?.attachedTracks.map(at => at.trackId) || []
    );

    const newAttachedIds = items.map(item => item.id);

    // Attach new tracks
    for (const item of items) {
      if (!currentAttached.has(item.id)) {
        mergeStore.attachTrackToVideo(item.id, mergeStore.selectedVideoId);
      }
    }

    // Reorder
    mergeStore.reorderAttachedTracks(mergeStore.selectedVideoId, newAttachedIds);
  }

  async function handleSelectOutputDir() {
    const selected = await open({
      directory: true, multiple: false,
      title: 'Select output directory'
    });
    if (selected && typeof selected === 'string') {
      mergeStore.setOutputPath(selected);
    }
  }

  async function handleMerge() {
    const outputPath = mergeStore.outputConfig.outputPath;
    if (!outputPath) {
      toast.error('Please select an output directory');
      return;
    }

    const videosToMerge = mergeStore.videosReadyForMerge;
    if (videosToMerge.length === 0) {
      toast.warning('No videos ready to merge.');
      return;
    }

    mergeStore.setStatus('processing');
    mergeStore.setProgress(0);

    try {
      let completed = 0;
      const mergedPaths: string[] = [];
      
      for (const video of videosToMerge) {
        const attachedTracks = mergeStore.getAttachedTracks(video.id);

        let outputFilename = video.name;
        if (!mergeStore.outputConfig.useSourceFilename) {
          // Update pattern replacement to use season/episode properly
          outputFilename = mergeStore.outputConfig.outputNamePattern
            .replace('{filename}', video.name.replace(/\.[^.]+$/, ''))
            .replace('{episode}', video.episodeNumber?.toString() || '')
            .replace('{season}', video.seasonNumber?.toString() || '');
        }
        if (!outputFilename.endsWith('.mkv')) {
          outputFilename = outputFilename.replace(/\.[^.]+$/, '') + '.mkv';
        }

        let fullOutputPath = `${outputPath}/${outputFilename}`;

        // Check if output path is the same as input path (FFmpeg cannot edit files in-place)
        if (fullOutputPath === video.path) {
          // Add "_merged" suffix before extension
          const nameWithoutExt = outputFilename.replace(/\.mkv$/, '');
          outputFilename = `${nameWithoutExt}_merged.mkv`;
          fullOutputPath = `${outputPath}/${outputFilename}`;
        }

        // Build attached track args (external tracks to add)
        const trackArgs = attachedTracks.map(track => ({
          inputPath: track.path,
          trackIndex: 0,
          config: track.config
        }));

        // Build source track configs (for metadata modifications and track selection)
        const sourceTrackConfigs = video.tracks.map(track => {
          const config = mergeStore.getSourceTrackConfig(track.id);
          return {
            originalIndex: track.originalIndex,
            type: track.type,
            config: config || {
              trackId: track.id,
              enabled: true,
              language: track.language,
              title: track.title,
              default: track.default,
              forced: track.forced,
              delayMs: 0,
              order: 0
            }
          };
        });

        await invoke('merge_tracks', {
          videoPath: video.path,
          tracks: trackArgs,
          sourceTrackConfigs,
          outputPath: fullOutputPath
        });

        mergedPaths.push(fullOutputPath);
        completed++;
        mergeStore.setProgress((completed / videosToMerge.length) * 100);
      }

      mergeStore.setStatus('completed');
      
      // Add merged files to recent files store for potential import in Rename tool
      if (mergedPaths.length > 0) {
        recentFilesStore.addMergedFiles(mergedPaths);
      }
      
      toast.success(`Successfully merged ${completed} file(s)!`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      mergeStore.setError(errorMsg);
      logAndToast.error({
        source: 'merge',
        title: 'Merge failed',
        details: errorMsg
      });
    }
  }

  async function handleOpenFolder() {
    await invoke('open_folder', { path: mergeStore.outputConfig.outputPath });
  }

  function handleClearAll() {
    mergeStore.clearAll();
    toast.info('Cleared all files');
  }

  // Track editing
  function handleEditImportedTrack(trackId: string) {
    editingTrackId = trackId;
    editingTrackType = 'imported';
    settingsOpen = true;
  }

  function handleEditSourceTrack(trackId: string) {
    editingTrackId = trackId;
    editingTrackType = 'source';
    settingsOpen = true;
  }

  function handleCloseSettings() {
    settingsOpen = false;
    editingTrackId = null;
  }

  function handleSaveTrackSettings(updates: Partial<MergeTrackConfig>) {
    if (!editingTrackId) return;

    if (editingTrackType === 'imported') {
      mergeStore.updateTrackConfig(editingTrackId, updates);
    } else {
      mergeStore.updateSourceTrackConfig(editingTrackId, updates);
    }
  }

  // Get track counts by type for a video
  function getTrackCounts(tracks: MergeTrack[]) {
    const counts = { video: 0, audio: 0, subtitle: 0 };
    for (const track of tracks) {
      if (track.type in counts) {
        counts[track.type as keyof typeof counts]++;
      }
    }
    return counts;
  }

  // Group source tracks by type
  function groupTracksByType(tracks: MergeTrack[]) {
    const groups: Record<string, MergeTrack[]> = { video: [], audio: [], subtitle: [] };
    for (const track of tracks) {
      if (groups[track.type]) {
        groups[track.type].push(track);
      }
    }
    return groups;
  }

  const groupedSourceTracks = $derived(() => groupTracksByType(selectedVideoTracks()));
</script>

<div class="h-full flex overflow-hidden">
  <!-- Left panel: Video files -->
  <div class="w-80 border-r flex flex-col overflow-hidden">
    <div class="p-3 border-b shrink-0 flex items-center justify-between">
      <h2 class="font-semibold">Videos ({mergeStore.videoFiles.length})</h2>
      <div class="flex gap-1">
        {#if mergeStore.videoFiles.length > 0}
          <Button variant="ghost" size="icon-sm" onclick={handleClearAll} class="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
            <Trash2 class="size-4" />
          </Button>
        {/if}
        <Button size="sm" onclick={handleAddVideoFiles}>
          <Plus class="size-4 mr-1" />
          Add
        </Button>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-auto p-2 space-y-2">
      {#each mergeStore.videoFiles as video (video.id)}
        {@const FileIcon = getFileIcon(video.path)}
        {@const attachedCount = video.attachedTracks.length}
        {@const isSelected = mergeStore.selectedVideoId === video.id}
        {@const seriesInfo = formatSeriesInfo(video.seasonNumber, video.episodeNumber)}
        {@const counts = getTrackCounts(video.tracks)}
        <button
          class="w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent {isSelected ? 'border-primary bg-primary/5' : ''}"
          onclick={() => mergeStore.selectVideo(video.id)}
        >
          <div class="shrink-0 mt-0.5">
            {#if video.status === 'scanning'}
              <Loader2 class="size-5 text-muted-foreground animate-spin" />
            {:else if video.status === 'error'}
              <XCircle class="size-5 text-destructive" />
            {:else}
              <FileIcon class="size-5 text-primary" />
            {/if}
          </div>

          <div class="flex-1 min-w-0">
            <p class="font-medium truncate">{video.name}</p>
            <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {#if seriesInfo}
                <Badge variant="outline" class="text-xs">{seriesInfo}</Badge>
              {/if}
              {#if counts.video > 0}
                <Badge variant="secondary" class="text-xs gap-1">
                  <Film class="size-3" />
                  {counts.video}
                </Badge>
              {/if}
              {#if counts.audio > 0}
                <Badge variant="secondary" class="text-xs gap-1">
                  <Volume2 class="size-3" />
                  {counts.audio}
                </Badge>
              {/if}
              {#if counts.subtitle > 0}
                <Badge variant="secondary" class="text-xs gap-1">
                  <Subtitles class="size-3" />
                  {counts.subtitle}
                </Badge>
              {/if}
              {#if attachedCount > 0}
                <Badge class="text-xs">+{attachedCount}</Badge>
              {/if}
            </div>
          </div>

          <Button
            variant="ghost" size="icon-sm"
            class="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onclick={(e: MouseEvent) => { e.stopPropagation(); mergeStore.removeVideoFile(video.id); }}
          >
            <Trash2 class="size-4" />
          </Button>
        </button>
      {:else}
        <div class="flex flex-col items-center justify-center py-8 text-center">
          <FileVideo class="size-10 text-muted-foreground/30 mb-2" />
          <p class="text-sm text-muted-foreground">No video files</p>
          <p class="text-xs text-muted-foreground mt-1">Drop videos here or click Add</p>
        </div>
      {/each}
    </div>
  </div>

  <!-- Center panel: Track management with tabs -->
  <div class="flex-1 flex flex-col overflow-hidden">
    <Tabs.Root value="source" class="flex-1 flex flex-col overflow-hidden">
      <div class="p-2.5 border-b w-full overflow-scroll flex items-center justify-between gap-4">
        <Tabs.List>
          <Tabs.Trigger value="source" class="flex items-center gap-1.5">
            <Layers class="size-4" />
            Source tracks
          </Tabs.Trigger>
          <Tabs.Trigger value="import" class="flex items-center gap-1.5">
            <Plus class="size-4" />
            Import tracks
            {#if mergeStore.unassignedTracks.length > 0}
              <Badge variant="secondary" class="text-xs ml-1">{mergeStore.unassignedTracks.length}</Badge>
            {/if}
          </Tabs.Trigger>
        </Tabs.List>

        <div class="flex gap-2">
          {#if mergeStore.importedTracks.length > 0 && mergeStore.videoFiles.length > 0}
            <Tooltip.Root>
              <Tooltip.Trigger>
                <Button variant="outline" size="sm" onclick={handleAutoMatch}>
                  <Wand2 class="size-4 mr-1" />
                  Auto-match
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Match tracks to videos by episode number</Tooltip.Content>
            </Tooltip.Root>
          {/if}
        </div>
      </div>

      <!-- Source Tracks Tab -->
      <Tabs.Content value="source" class="flex-1 min-h-0 overflow-auto p-4 mt-0">
        {#if mergeStore.selectedVideo}
          {@const groups = groupedSourceTracks()}
          <div class="space-y-4">
            {#each Object.entries(groups) as [type, tracks]}
              {#if tracks.length > 0}
                {@const Icon = getTrackIcon(type)}
                <Card.Root>
                  <Card.Header class="py-3">
                    <div class="flex items-center gap-2">
                      <Icon class="size-4 text-muted-foreground" />
                      <Card.Title class="text-sm capitalize">{type} ({tracks.length})</Card.Title>
                    </div>
                  </Card.Header>
                  <Card.Content class="pt-0 space-y-1.5">
                    {#each tracks as track (track.id)}
                      {@const config = mergeStore.getSourceTrackConfig(track.id)}
                      {@const enabled = config?.enabled ?? true}
                      <div
                        class="flex items-center gap-2 rounded-md border p-2.5 transition-all {getTrackTypeColor(track.type)} {!enabled ? 'opacity-50' : ''}"
                      >
                        <Checkbox
                          checked={enabled}
                          onCheckedChange={() => mergeStore.toggleSourceTrack(track.id)}
                        />

                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" class="font-mono text-xs">#{track.originalIndex}</Badge>
                            <span class="font-medium text-sm">{track.codec.toUpperCase()}</span>
                            {#if config?.language || track.language}
                              <Badge variant="secondary" class="text-xs">
                                {config?.language || track.language}
                              </Badge>
                            {/if}
                            {#if config?.default ?? track.default}
                              <Badge class="text-xs">Default</Badge>
                            {/if}
                            {#if config?.forced ?? track.forced}
                              <Badge variant="destructive" class="text-xs">Forced</Badge>
                            {/if}
                          </div>

                          <div class="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                            {#if config?.title || track.title}
                              <span class="truncate max-w-[200px]">"{config?.title || track.title}"</span>
                            {/if}
                            {#if track.type === 'video' && track.width && track.height}
                              <span>{track.width}x{track.height}</span>
                            {/if}
                            {#if track.type === 'audio' && track.channels}
                              <span>{track.channels}ch</span>
                            {/if}
                            {#if config?.delayMs && config.delayMs !== 0}
                              <span class="flex items-center gap-1 text-orange-500">
                                <Clock class="size-3" />
                                {config.delayMs > 0 ? '+' : ''}{config.delayMs}ms
                              </span>
                            {/if}
                          </div>
                        </div>

                        <Button
                          variant="ghost" size="icon-sm"
                          onclick={() => handleEditSourceTrack(track.id)}
                        >
                          <Settings2 class="size-4" />
                        </Button>
                      </div>
                    {/each}
                  </Card.Content>
                </Card.Root>
              {/if}
            {/each}
          </div>
        {:else}
          <div class="flex items-center justify-center py-20 text-muted-foreground">
            <p>Select a video to view its tracks</p>
          </div>
        {/if}
      </Tabs.Content>

      <!-- Import Tracks Tab -->
      <Tabs.Content value="import" class="flex-1 min-h-0 overflow-auto p-4 mt-0 space-y-4">
        <div class="flex justify-end">
          <Button size="sm" onclick={handleAddTrackFiles}>
            <Plus class="size-4 mr-1" />
            Add tracks
          </Button>
        </div>

        <!-- Unassigned tracks (droppable) -->
        <Card.Root>
          <Card.Header class="py-3">
            <Card.Title class="text-sm flex items-center gap-2">
              <Unlink class="size-4 text-muted-foreground" />
              Unassigned tracks
            </Card.Title>
            <Card.Description>Drag tracks to attach them to a video</Card.Description>
          </Card.Header>
          <Card.Content class="pt-0">
            <section
              class="min-h-[60px] rounded-md border-2 border-dashed p-2 space-y-1"
              use:dndzone={{
                items: unassignedItems,
                flipDurationMs: FLIP_DURATION_MS,
                type: 'tracks',
                onConsider: handleUnassignedConsider,
                onFinalize: handleUnassignedFinalize
              }}
            >
              {#each unassignedItems as track (track.id)}
                {@const TrackIcon = track.type === 'subtitle' ? Subtitles : FileAudio}
                {@const seriesInfo = formatSeriesInfo(track.seasonNumber, track.episodeNumber)}
                <div
                  class="flex items-center gap-2 rounded-md border p-2 bg-card cursor-grab active:cursor-grabbing {getTrackTypeColor(track.type)}"
                  animate:flip={{ duration: FLIP_DURATION_MS }}
                >
                  <GripVertical class="size-4 text-muted-foreground/50" />
                  <TrackIcon class="size-4" />
                  <span class="flex-1 text-sm truncate">{track.name}</span>
                  {#if seriesInfo}
                    <Badge variant="outline" class="text-xs">{seriesInfo}</Badge>
                  {/if}
                  {#if track.config.language}
                    <Badge variant="secondary" class="text-xs">{track.config.language}</Badge>
                  {/if}
                  <Button variant="ghost" size="icon-sm" onclick={() => handleEditImportedTrack(track.id)}>
                    <Settings2 class="size-3" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onclick={() => mergeStore.removeImportedTrack(track.id)} class="text-muted-foreground hover:text-destructive">
                    <Trash2 class="size-3" />
                  </Button>
                </div>
              {:else}
                <p class="text-sm text-muted-foreground text-center py-4 select-none">
                  No unassigned tracks. Add tracks or drag here to detach.
                </p>
              {/each}
            </section>
          </Card.Content>
        </Card.Root>

        <!-- Attached tracks for selected video -->
        {#if mergeStore.selectedVideo}
          {@const video = mergeStore.selectedVideo}
          <Card.Root class="border-primary/50">
            <Card.Header class="py-3">
              <Card.Title class="text-sm flex items-center gap-2">
                <Link class="size-4 text-primary" />
                <span class="wrap-anywhere">Attached to: {video.name}</span>
              </Card.Title>
              <Card.Description>Drop tracks here to merge with this video</Card.Description>
            </Card.Header>
            <Card.Content class="pt-0">
              <section
                class="min-h-[80px] rounded-md border-2 border-primary/30 border-dashed p-2 space-y-1 bg-primary/5"
                use:dndzone={{
                  items: attachedItems,
                  flipDurationMs: FLIP_DURATION_MS,
                  type: 'tracks',
                  onConsider: handleAttachedConsider,
                  onFinalize: handleAttachedFinalize
                }}
              >
                {#each attachedItems as track (track.id)}
                  {@const TrackIcon = track.type === 'subtitle' ? Subtitles : FileAudio}
                  <div
                    class="flex items-center gap-2 rounded-md border p-2 bg-card cursor-grab active:cursor-grabbing {getTrackTypeColor(track.type)}"
                    animate:flip={{ duration: FLIP_DURATION_MS }}
                  >
                    <GripVertical class="size-4 text-muted-foreground/50" />
                    <TrackIcon class="size-4" />
                    <span class="flex-1 text-sm truncate">{track.name}</span>
                    {#if track.config.delayMs !== 0}
                      <Badge variant="secondary" class="text-xs">{track.config.delayMs}ms</Badge>
                    {/if}
                    {#if track.config.language}
                      <Badge variant="secondary" class="text-xs">{track.config.language}</Badge>
                    {/if}
                    <Button variant="ghost" size="icon-sm" onclick={() => handleEditImportedTrack(track.id)}>
                      <Settings2 class="size-3" />
                    </Button>
                    <Button
                      variant="ghost" size="icon-sm"
                      onclick={() => mergeStore.detachTrackFromVideo(track.id, video.id)}
                      class="text-muted-foreground hover:text-orange-500"
                    >
                      <Unlink class="size-3" />
                    </Button>
                  </div>
                {:else}
                  <p class="text-sm text-muted-foreground text-center py-6">
                    Drop tracks here to attach to this video
                  </p>
                {/each}
              </section>
            </Card.Content>
          </Card.Root>
        {:else if mergeStore.videoFiles.length > 0}
          <div class="flex items-center justify-center py-8 text-muted-foreground">
            <p>Select a video to attach tracks</p>
          </div>
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  </div>

  <!-- Right panel: Output config -->
  <div class="w-80 border-l p-4 overflow-auto">
    <MergeOutputPanel
      outputConfig={mergeStore.outputConfig}
      enabledTracksCount={mergeStore.totalTracksToMerge}
      videosCount={mergeStore.videosReadyForMerge.length}
      status={mergeStore.status}
      progress={mergeStore.progress}
      onSelectOutputDir={handleSelectOutputDir}
      onOutputNameChange={(name) => mergeStore.setOutputNamePattern(name)}
      onMerge={handleMerge}
      onOpenFolder={handleOpenFolder}
    />
  </div>

  <!-- Track settings dialog -->
  <MergeTrackSettings
    open={settingsOpen}
    track={editingTrackType === 'imported'
      ? (editingImportedTrack() ? {
          id: editingImportedTrack()!.id,
          sourceFileId: '',
          originalIndex: 0,
          type: editingImportedTrack()!.type,
          codec: editingImportedTrack()!.codec,
          language: editingImportedTrack()!.language,
          title: editingImportedTrack()!.title
        } : null)
      : editingSourceTrack()
    }
    config={editingTrackType === 'imported'
      ? editingImportedTrack()?.config ?? null
      : (editingSourceTrack() ? mergeStore.getSourceTrackConfig(editingSourceTrack()!.id) ?? null : null)
    }
    onClose={handleCloseSettings}
    onSave={handleSaveTrackSettings}
  />
</div>
