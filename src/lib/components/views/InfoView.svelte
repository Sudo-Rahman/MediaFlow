<script lang="ts" module>
  export interface InfoViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { toast } from 'svelte-sonner';
  import { log } from '$lib/utils/log-toast';

  import { fileListStore } from '$lib/stores/files.svelte';
  import { mergeStore, infoStore } from '$lib/stores';
  import { scanFiles } from '$lib/services/ffprobe';
  import type { Track } from '$lib/types';
  import type { FileInfo } from '$lib/stores/info.svelte';

  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Separator } from '$lib/components/ui/separator';
  import * as Card from '$lib/components/ui/card';
  import * as Tabs from '$lib/components/ui/tabs';

  import FileVideo from 'lucide-svelte/icons/file-video';
  import Subtitles from 'lucide-svelte/icons/subtitles';
  import Video from 'lucide-svelte/icons/video';
  import Volume2 from 'lucide-svelte/icons/volume-2';
  import Clock from 'lucide-svelte/icons/clock';
  import Film from 'lucide-svelte/icons/film';
  import Plus from 'lucide-svelte/icons/plus';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import XCircle from 'lucide-svelte/icons/x-circle';
  import X from 'lucide-svelte/icons/x';
  import Import from 'lucide-svelte/icons/import';
  import Layers from 'lucide-svelte/icons/layers';
  import Copy from 'lucide-svelte/icons/copy';
  import Check from 'lucide-svelte/icons/check';

  const SUPPORTED_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.webm', '.m4v', '.mks', '.mka'];

  let copiedField = $state<string | null>(null);

  export async function handleFileDrop(paths: string[]) {
    const supportedPaths = paths.filter(p => {
      const ext = p.toLowerCase().substring(p.lastIndexOf('.'));
      return SUPPORTED_EXTENSIONS.includes(ext);
    });

    if (supportedPaths.length === 0) {
      toast.warning('No supported media files detected');
      return;
    }

    await addFiles(supportedPaths);
  }

  async function handleAddFiles() {
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Media files',
        extensions: SUPPORTED_EXTENSIONS.map(e => e.slice(1))
      }]
    });

    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await addFiles(paths);
    }
  }

  async function addFiles(paths: string[]) {
    let added = 0;
    let skipped = 0;

    // Filter duplicates and prepare files for scanning
    const fileInfoMap = new Map<string, { name: string; fileId: string }>();

    for (const path of paths) {
      // Check duplicates
      if (infoStore.hasFile(path)) {
        skipped++;
        continue;
      }

      const name = path.split('/').pop() || path.split('\\').pop() || path;
      const fileId = infoStore.generateId();

      const newFile: FileInfo = {
        id: fileId,
        path,
        name,
        size: 0,
        tracks: [],
        status: 'scanning'
      };

      infoStore.addFile(newFile);
      fileInfoMap.set(path, { name, fileId });
    }

    // Scan all files in parallel
    if (fileInfoMap.size > 0) {
      const scannedFiles = await scanFiles([...fileInfoMap.keys()], 3);

      for (const scanned of scannedFiles) {
        const fileInfo = fileInfoMap.get(scanned.path);
        if (!fileInfo) continue;

        if (scanned.status === 'error') {
          infoStore.updateFile(fileInfo.fileId, {
            status: 'error' as const,
            error: scanned.error
          });

          // Log error for this file
          log('error', 'system',
            `Scan failed: ${fileInfo.name}`,
            scanned.error || 'Unknown error',
            { filePath: scanned.path }
          );
        } else {
          infoStore.updateFile(fileInfo.fileId, {
            size: scanned.size,
            duration: scanned.duration,
            bitrate: scanned.bitrate,
            format: scanned.format,
            tracks: scanned.tracks,
            status: 'ready' as const,
            rawData: scanned.rawData
          });

          // Log success for this file
          log('success', 'system',
            `Scanned: ${fileInfo.name}`,
            `${scanned.tracks.length} track(s) found`,
            { filePath: scanned.path }
          );

          added++;
        }
      }
    }

    if (added > 0 && skipped > 0) {
      toast.success(`Added ${added} file(s), ${skipped} duplicate(s) skipped`);
    } else if (added > 0) {
      toast.success(`Added ${added} file(s)`);
    } else if (skipped > 0) {
      toast.info(`${skipped} file(s) already imported`);
    }
  }

  function handleImportFromExtraction() {
    const extractionFiles = fileListStore.files.filter(f => f.status === 'ready');
    if (extractionFiles.length === 0) {
      toast.info('No files in Extraction to import');
      return;
    }

    const paths = extractionFiles.map(f => f.path);
    addFiles(paths);
  }

  function handleImportFromMerge() {
    const mergeFiles = mergeStore.videoFiles.filter(f => f.status === 'ready');
    if (mergeFiles.length === 0) {
      toast.info('No files in Merge to import');
      return;
    }

    const paths = mergeFiles.map(f => f.path);
    addFiles(paths);
  }

  function handleRemoveFile(fileId: string) {
    infoStore.removeFile(fileId);
  }

  function handleClearAll() {
    infoStore.clear();
  }

  function copyToClipboard(text: string, fieldName: string) {
    navigator.clipboard.writeText(text);
    copiedField = fieldName;
    setTimeout(() => copiedField = null, 2000);
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatBitrate(bps: number): string {
    if (bps > 1000000) {
      return `${(bps / 1000000).toFixed(2)} Mbps`;
    }
    return `${(bps / 1000).toFixed(0)} kbps`;
  }

  function getTrackIcon(type: string) {
    switch (type) {
      case 'video': return Video;
      case 'audio': return Volume2;
      case 'subtitle': return Subtitles;
      default: return Film;
    }
  }

  function getTrackTypeColor(type: string) {
    switch (type) {
      case 'video': return 'text-blue-500';
      case 'audio': return 'text-green-500';
      case 'subtitle': return 'text-yellow-500';
      default: return 'text-gray-500';
    }
  }

  // Group tracks by type
  function groupTracksByType(tracks: Track[]) {
    const groups: Record<string, Track[]> = { video: [], audio: [], subtitle: [] };
    for (const track of tracks) {
      if (groups[track.type]) {
        groups[track.type].push(track);
      }
    }
    return groups;
  }

  // Count files by status
  const extractionFilesCount = $derived(fileListStore.files.filter(f => f.status === 'ready').length);
  const mergeFilesCount = $derived(mergeStore.videoFiles.filter(f => f.status === 'ready').length);
</script>

<div class="h-full flex overflow-hidden">
  <!-- Left panel: File list -->
  <div class="w-80 border-r flex flex-col overflow-hidden">
    <div class="p-3 border-b flex items-center justify-between">
      <span class="text-sm font-semibold">Files ({infoStore.files.length})</span>
      <div class="flex gap-1">
        {#if infoStore.files.length > 0}
          <Button variant="ghost" size="icon-sm" onclick={handleClearAll} class="text-muted-foreground hover:text-destructive">
            <Trash2 class="size-4" />
          </Button>
        {/if}
        <Button size="sm" onclick={handleAddFiles}>
          <Plus class="size-4 mr-1" />
          Add
        </Button>
      </div>
    </div>

    <!-- File list -->
    <div class="flex-1 overflow-y-auto">
      {#if infoStore.files.length === 0}
        <div class="p-8 text-center">
          <Film class="size-12 text-muted-foreground/30 mx-auto mb-3" />
          <p class="text-sm text-muted-foreground mb-4">Drop files here or click Add</p>
          
          <!-- Import buttons -->
          {#if extractionFilesCount > 0 || mergeFilesCount > 0}
            <div class="space-y-2">
              {#if extractionFilesCount > 0}
                <Button variant="outline" size="sm" class="w-full" onclick={handleImportFromExtraction}>
                  <Import class="size-4 mr-2" />
                  Import from Extract ({extractionFilesCount})
                </Button>
              {/if}
              {#if mergeFilesCount > 0}
                <Button variant="outline" size="sm" class="w-full" onclick={handleImportFromMerge}>
                  <Import class="size-4 mr-2" />
                  Import from Merge ({mergeFilesCount})
                </Button>
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        {#each infoStore.files as file (file.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            role="button"
            tabindex="0"
            class="w-full p-3 text-left hover:bg-muted/50 border-b transition-colors group relative cursor-pointer
                   {infoStore.selectedFileId === file.id ? 'bg-muted' : ''}"
            onclick={() => infoStore.selectFile(file.id)}
          >
            <div class="flex items-center gap-2">
              {#if file.status === 'scanning'}
                <Loader2 class="size-4 animate-spin text-muted-foreground shrink-0" />
              {:else if file.status === 'error'}
                <XCircle class="size-4 text-destructive shrink-0" />
              {:else}
                <FileVideo class="size-4 text-muted-foreground shrink-0" />
              {/if}
              <span class="truncate text-sm flex-1">{file.name}</span>
              <button
                class="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-opacity"
                onclick={(e) => { e.stopPropagation(); handleRemoveFile(file.id); }}
              >
                <X class="size-3 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
            {#if file.status === 'ready'}
              <div class="text-xs text-muted-foreground mt-1 pl-6">
                {formatFileSize(file.size)} • {file.tracks.length} tracks
              </div>
            {:else if file.status === 'error'}
              <div class="text-xs text-destructive mt-1 pl-6 truncate">{file.error}</div>
            {:else}
              <div class="text-xs text-muted-foreground mt-1 pl-6">Scanning...</div>
            {/if}
          </div>
        {/each}

        <!-- Import buttons when files exist -->
        {#if extractionFilesCount > 0 || mergeFilesCount > 0}
          <div class="p-3 border-t space-y-2">
            {#if extractionFilesCount > 0}
              <Button variant="ghost" size="sm" class="w-full justify-start" onclick={handleImportFromExtraction}>
                <Import class="size-4 mr-2" />
                Import from Extract ({extractionFilesCount})
              </Button>
            {/if}
            {#if mergeFilesCount > 0}
              <Button variant="ghost" size="sm" class="w-full justify-start" onclick={handleImportFromMerge}>
                <Import class="size-4 mr-2" />
                Import from Merge ({mergeFilesCount})
              </Button>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </div>

  <!-- Right panel: File details -->
  <div class="flex-1 flex flex-col overflow-hidden">
    {#if infoStore.selectedFile}
      {@const file = infoStore.selectedFile}
      {@const groups = groupTracksByType(file.tracks)}

      <div class="p-4 border-b">
        <h2 class="text-lg font-semibold truncate">{file.name}</h2>
        <p class="text-sm text-muted-foreground truncate mt-0.5">{file.path}</p>
      </div>

      <div class="flex-1 min-h-0 overflow-auto">
        <Tabs.Root value="overview" class="h-full">
          <div class="px-4 pt-2">
            <Tabs.List>
              <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
              <Tabs.Trigger value="tracks">Tracks ({file.tracks.length})</Tabs.Trigger>
              <Tabs.Trigger value="raw">Raw Data</Tabs.Trigger>
            </Tabs.List>
          </div>

          <!-- Overview Tab -->
          <Tabs.Content value="overview" class="p-4 space-y-4 mt-0">
            <!-- General Info -->
            <Card.Root>
              <Card.Header class="pb-2">
                <Card.Title class="text-sm flex items-center gap-2">
                  <Film class="size-4" />
                  General Information
                </Card.Title>
              </Card.Header>
              <Card.Content class="space-y-3">
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <p class="text-xs text-muted-foreground">Format</p>
                    <p class="text-sm font-medium">{file.format || 'Unknown'}</p>
                  </div>
                  <div>
                    <p class="text-xs text-muted-foreground">Size</p>
                    <p class="text-sm font-medium">{formatFileSize(file.size)}</p>
                  </div>
                  {#if file.duration}
                    <div>
                      <p class="text-xs text-muted-foreground">Duration</p>
                      <p class="text-sm font-medium">{formatDuration(file.duration)}</p>
                    </div>
                  {/if}
                  {#if file.bitrate}
                    <div>
                      <p class="text-xs text-muted-foreground">Overall Bitrate</p>
                      <p class="text-sm font-medium">{formatBitrate(file.bitrate)}</p>
                    </div>
                  {/if}
                </div>
              </Card.Content>
            </Card.Root>

            <!-- Track Summary -->
            <Card.Root>
              <Card.Header class="pb-2">
                <Card.Title class="text-sm flex items-center gap-2">
                  <Layers class="size-4" />
                  Track Summary
                </Card.Title>
              </Card.Header>
              <Card.Content>
                <div class="flex gap-4">
                  {#if groups.video.length > 0}
                    <div class="flex items-center gap-2">
                      <Video class="size-4 text-blue-500" />
                      <span class="text-sm">{groups.video.length} Video</span>
                    </div>
                  {/if}
                  {#if groups.audio.length > 0}
                    <div class="flex items-center gap-2">
                      <Volume2 class="size-4 text-green-500" />
                      <span class="text-sm">{groups.audio.length} Audio</span>
                    </div>
                  {/if}
                  {#if groups.subtitle.length > 0}
                    <div class="flex items-center gap-2">
                      <Subtitles class="size-4 text-yellow-500" />
                      <span class="text-sm">{groups.subtitle.length} Subtitle</span>
                    </div>
                  {/if}
                </div>
              </Card.Content>
            </Card.Root>

            <!-- Video Track Details -->
            {#if groups.video.length > 0}
              <Card.Root>
                <Card.Header class="pb-2">
                  <Card.Title class="text-sm flex items-center gap-2">
                    <Video class="size-4 text-blue-500" />
                    Video
                  </Card.Title>
                </Card.Header>
                <Card.Content class="space-y-3">
                  {#each groups.video as track, i}
                    <div class="p-3 rounded-md bg-muted/50 space-y-2">
                      <div class="flex items-center gap-2">
                        <Badge variant="outline" class="font-mono">#{track.index}</Badge>
                        <span class="font-medium">{track.codec.toUpperCase()}</span>
                        {#if track.codecLong}
                          <span class="text-xs text-muted-foreground">({track.codecLong})</span>
                        {/if}
                      </div>
                      <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        {#if track.width && track.height}
                          <div>
                            <p class="text-xs text-muted-foreground">Resolution</p>
                            <p>{track.width}×{track.height}</p>
                          </div>
                        {/if}
                        {#if track.frameRate}
                          <div>
                            <p class="text-xs text-muted-foreground">Frame Rate</p>
                            <p>{track.frameRate} fps</p>
                          </div>
                        {/if}
                        {#if track.bitrate}
                          <div>
                            <p class="text-xs text-muted-foreground">Bitrate</p>
                            <p>{formatBitrate(track.bitrate)}</p>
                          </div>
                        {/if}
                        {#if track.size}
                          <div>
                            <p class="text-xs text-muted-foreground">Size</p>
                            <p>{formatFileSize(track.size)}</p>
                          </div>
                        {/if}
                        {#if track.pixelFormat}
                          <div>
                            <p class="text-xs text-muted-foreground">Pixel Format</p>
                            <p>{track.pixelFormat}</p>
                          </div>
                        {/if}
                        {#if track.colorRange}
                          <div>
                            <p class="text-xs text-muted-foreground">Color Range</p>
                            <p>{track.colorRange}</p>
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </Card.Content>
              </Card.Root>
            {/if}

            <!-- Audio Tracks Details -->
            {#if groups.audio.length > 0}
              <Card.Root>
                <Card.Header class="pb-2">
                  <Card.Title class="text-sm flex items-center gap-2">
                    <Volume2 class="size-4 text-green-500" />
                    Audio ({groups.audio.length})
                  </Card.Title>
                </Card.Header>
                <Card.Content class="space-y-2">
                  {#each groups.audio as track}
                    <div class="p-3 rounded-md bg-muted/50">
                      <div class="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" class="font-mono">#{track.index}</Badge>
                        <span class="font-medium">{track.codec.toUpperCase()}</span>
                        {#if track.language}
                          <Badge variant="secondary">{track.language}</Badge>
                        {/if}
                        {#if track.title}
                          <span class="text-sm text-muted-foreground">"{track.title}"</span>
                        {/if}
                        {#if track.default}
                          <Badge>Default</Badge>
                        {/if}
                      </div>
                      
                      <div class="flex gap-4 mt-2 text-sm text-muted-foreground">
                        {#if track.channels}
                          <span>{track.channels} channels</span>
                        {/if}
                        {#if track.sampleRate}
                          <span>{track.sampleRate} Hz</span>
                        {/if}
                        {#if track.bitrate}
                          <span>{formatBitrate(track.bitrate)}</span>
                        {/if}
                        {#if track.size}
                          <span>{formatFileSize(track.size)}</span>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </Card.Content>
              </Card.Root>
            {/if}

            <!-- Subtitle Tracks Details -->
            {#if groups.subtitle.length > 0}
              <Card.Root>
                <Card.Header class="pb-2">
                  <Card.Title class="text-sm flex items-center gap-2">
                    <Subtitles class="size-4 text-yellow-500" />
                    Subtitles ({groups.subtitle.length})
                  </Card.Title>
                </Card.Header>
                <Card.Content class="space-y-2">
                  {#each groups.subtitle as track}
                    <div class="p-3 rounded-md bg-muted/50">
                      <div class="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" class="font-mono">#{track.index}</Badge>
                        <span class="font-medium">{track.codec.toUpperCase()}</span>
                        {#if track.language}
                          <Badge variant="secondary">{track.language}</Badge>
                        {/if}
                        {#if track.title}
                          <span class="text-sm text-muted-foreground">"{track.title}"</span>
                        {/if}
                        {#if track.default}
                          <Badge>Default</Badge>
                        {/if}
                        {#if track.forced}
                          <Badge variant="destructive">Forced</Badge>
                        {/if}
                      </div>
                      
                      <div class="flex gap-4 mt-2 text-sm text-muted-foreground">
                        {#if track.bitrate}
                          <span>{formatBitrate(track.bitrate)}</span>
                        {/if}
                        {#if track.size}
                          <span>{formatFileSize(track.size)}</span>
                        {/if}
                        {#if track.numberOfFrames}
                          <span>{track.numberOfFrames} frames</span>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </Card.Content>
              </Card.Root>
            {/if}
          </Tabs.Content>

          <!-- Tracks Tab -->
          <Tabs.Content value="tracks" class="p-4 space-y-2 mt-0">
            {#each file.tracks as track (track.id)}
              {@const Icon = getTrackIcon(track.type)}
              <Card.Root>
                <Card.Content class="p-3">
                  <div class="flex items-start gap-3">
                    <div class="p-2 rounded-md bg-muted">
                      <Icon class="size-4 {getTrackTypeColor(track.type)}" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" class="font-mono">#{track.index}</Badge>
                        <span class="font-semibold capitalize">{track.type}</span>
                        <span class="font-medium">{track.codec.toUpperCase()}</span>
                        {#if track.language}
                          <Badge variant="secondary">{track.language}</Badge>
                        {/if}
                        {#if track.default}
                          <Badge>Default</Badge>
                        {/if}
                        {#if track.forced}
                          <Badge variant="destructive">Forced</Badge>
                        {/if}
                      </div>

                      {#if track.title}
                        <p class="text-sm text-muted-foreground mt-1">"{track.title}"</p>
                      {/if}

                      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                        {#if track.codecLong}
                          <span>Codec: {track.codecLong}</span>
                        {/if}
                        {#if track.bitrate}
                          <span>Bitrate: {formatBitrate(track.bitrate)}</span>
                        {/if}
                        {#if track.size}
                          <span>Size: {formatFileSize(track.size)}</span>
                        {/if}
                        
                        {#if track.type === 'video'}
                          {#if track.width && track.height}
                            <span>Resolution: {track.width}×{track.height}</span>
                          {/if}
                          {#if track.frameRate}
                            <span>FPS: {track.frameRate}</span>
                          {/if}
                          {#if track.pixelFormat}
                            <span>Format: {track.pixelFormat}</span>
                          {/if}
                          {#if track.colorRange}
                            <span>Range: {track.colorRange}</span>
                          {/if}
                          {#if track.aspectRatio}
                            <span>AR: {track.aspectRatio}</span>
                          {/if}
                        {/if}
                        
                        {#if track.type === 'audio'}
                          {#if track.channels}
                            <span>Channels: {track.channels}</span>
                          {/if}
                          {#if track.sampleRate}
                            <span>Sample Rate: {track.sampleRate} Hz</span>
                          {/if}
                        {/if}

                        {#if track.numberOfFrames}
                          <span>Frames: {track.numberOfFrames}</span>
                        {/if}
                      </div>
                    </div>
                  </div>
                </Card.Content>
              </Card.Root>
            {:else}
              <div class="text-center py-8 text-muted-foreground">
                No tracks found
              </div>
            {/each}
          </Tabs.Content>

          <!-- Raw Data Tab -->
          <Tabs.Content value="raw" class="p-4 mt-0">
            <Card.Root >
              <Card.Header class="pb-2 flex flex-row items-center justify-between">
                <Card.Title class="text-sm">Raw FFprobe Output</Card.Title>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => copyToClipboard(JSON.stringify(file.rawData, null, 2), 'raw')}
                >
                  {#if copiedField === 'raw'}
                    <Check class="size-4 mr-1" />
                    Copied!
                  {:else}
                    <Copy class="size-4 mr-1" />
                    Copy JSON
                  {/if}
                </Button>
              </Card.Header>
              <Card.Content>
                <pre class="text-xs bg-muted p-3 w-full rounded-md text-wrap font-mono">{JSON.stringify(file.rawData, null, 2)}</pre>
              </Card.Content>
            </Card.Root>
          </Tabs.Content>
        </Tabs.Root>
      </div>
    {:else}
      <div class="flex-1 flex items-center justify-center">
        <div class="text-center">
          <Film class="size-16 text-muted-foreground/30 mx-auto mb-4" />
          <h3 class="text-lg font-medium text-muted-foreground">No file selected</h3>
          <p class="text-sm text-muted-foreground mt-1">Select a file from the list or add new files</p>
        </div>
      </div>
    {/if}
  </div>
</div>
