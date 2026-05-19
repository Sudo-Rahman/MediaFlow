<script lang="ts" module>
  export interface InfoViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { toast } from 'svelte-sonner';

  import { InfoDetailsPanel, InfoFileSidebar } from '$lib/components/info';
  import { infoStore, toolImportStore } from '$lib/stores';
  import type { FileInfo } from '$lib/stores/info.svelte';
  import type { ImportSourceId } from '$lib/types/tool-import';
  import { scanFiles } from '$lib/services/ffprobe';
  import { getFileName } from '$lib/utils/format';
  import { log } from '$lib/utils/log-toast';

  import { SUPPORTED_EXTENSIONS, SUPPORTED_FORMATS } from '$lib/components/info/info-utils';

  const selectedFile = $derived(infoStore.selectedFile ?? null);

  export async function handleFileDrop(paths: string[]) {
    const supportedPaths = paths.filter((path) => {
      const extension = getPathExtension(path);
      return SUPPORTED_EXTENSIONS.includes(extension as (typeof SUPPORTED_EXTENSIONS)[number]);
    });

    if (supportedPaths.length === 0) {
      toast.warning('No supported media files detected');
      return;
    }

    await addFiles(supportedPaths);
  }

  function getPathExtension(path: string): string {
    const normalized = path.toLowerCase();
    const lastDot = normalized.lastIndexOf('.');
    return lastDot >= 0 ? normalized.slice(lastDot) : '';
  }

  async function handleAddFiles() {
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Media files',
        extensions: SUPPORTED_EXTENSIONS.map((extension) => extension.slice(1)),
      }],
    });

    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await addFiles(paths);
    }
  }

  async function addFiles(paths: string[]) {
    let added = 0;
    let skipped = 0;

    const fileInfoMap = new Map<string, { name: string; fileId: string }>();

    for (const path of paths) {
      if (infoStore.hasFile(path)) {
        skipped++;
        continue;
      }

      const name = getFileName(path);
      const fileId = infoStore.generateId();

      const newFile: FileInfo = {
        id: fileId,
        path,
        name,
        size: 0,
        tracks: [],
        status: 'scanning',
      };

      infoStore.addFile(newFile);
      fileInfoMap.set(path, { name, fileId });
    }

    if (fileInfoMap.size > 0) {
      const scannedFiles = await scanFiles([...fileInfoMap.keys()], 3);

      for (const scanned of scannedFiles) {
        const fileInfo = fileInfoMap.get(scanned.path);
        if (!fileInfo) continue;

        if (scanned.status === 'error') {
          infoStore.updateFile(fileInfo.fileId, {
            status: 'error' as const,
            error: scanned.error,
          });

          log(
            'error',
            'system',
            `Scan failed: ${fileInfo.name}`,
            scanned.error || 'Unknown error',
            { filePath: scanned.path },
          );
        } else {
          infoStore.updateFile(fileInfo.fileId, {
            size: scanned.size,
            duration: scanned.duration,
            bitrate: scanned.bitrate,
            format: scanned.format,
            tracks: scanned.tracks,
            status: 'ready' as const,
            rawData: scanned.rawData,
          });

          log(
            'success',
            'system',
            `Scanned: ${fileInfo.name}`,
            `${scanned.tracks.length} track(s) found`,
            { filePath: scanned.path },
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

  async function handleImportFromSource(sourceId: ImportSourceId) {
    const { paths } = toolImportStore.resolveImport({
      targetTool: 'info',
      sourceId,
    });

    if (paths.length === 0) {
      toast.info('No media files available from this source');
      return;
    }

    await addFiles(paths);
  }

  function handleRemoveFile(fileId: string) {
    infoStore.removeFile(fileId);
  }

  function handleClearAll() {
    infoStore.clear();
  }
</script>

<div class="h-full flex overflow-hidden">
  <InfoFileSidebar
    files={infoStore.files}
    selectedFileId={infoStore.selectedFileId}
    supportedFormats={SUPPORTED_FORMATS}
    onBrowse={handleAddFiles}
    onSelectSource={handleImportFromSource}
    onSelectFile={infoStore.selectFile}
    onRemoveFile={handleRemoveFile}
    onClearAll={handleClearAll}
  />

  <div class="flex-1 flex flex-col overflow-hidden">
    <InfoDetailsPanel file={selectedFile} />
  </div>
</div>
