<script lang="ts">
  import type { TranslationJob } from '$lib/types';
  import { VersionedExportDialog } from '$lib/components/shared';
  import {
    buildTranslationExportGroups,
    exportTranslationVersions,
    TRANSLATION_EXPORT_FORMAT_OPTIONS,
  } from '$lib/services/translation-versioned-export';
  import type { RunBatchExportResult, VersionedExportRequest } from '$lib/services/versioned-export';

  interface TranslationExportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    jobs: TranslationJob[];
  }

  let {
    open = $bindable(false),
    onOpenChange,
    jobs,
  }: TranslationExportDialogProps = $props();

  const translationExportGroups = $derived.by(() => buildTranslationExportGroups(jobs));

  async function handleExport(request: VersionedExportRequest): Promise<RunBatchExportResult> {
    return exportTranslationVersions(request, jobs);
  }
</script>

<VersionedExportDialog
  bind:open
  {onOpenChange}
  title="Export Translations"
  description="Export translated subtitles by file and version."
  groups={translationExportGroups}
  formatOptions={TRANSLATION_EXPORT_FORMAT_OPTIONS}
  defaultFormat="source"
  onExport={handleExport}
/>
