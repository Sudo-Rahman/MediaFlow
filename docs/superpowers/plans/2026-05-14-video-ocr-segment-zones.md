# Video OCR Segment Zones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build preview-first Video OCR segment zones with role-based output, ASS export for positioned text, and live provisional OCR detections.

**Architecture:** Replace the single `ocrRegion` contract with per-video `VideoOcrSelection` segments containing role-tagged zones. Frontend state, persistence, timeline UI, and Tauri payloads use the same model; Rust validates the selection, crops active zones per frame, emits live detections, and generates role-aware subtitle results.

**Tech Stack:** Svelte 5 runes, TypeScript, shadcn-svelte, Tailwind CSS, Vitest, Tauri 2, Rust 2024, Tokio, FFmpeg/OCR pipeline tests.

---

## File Structure

Create:

- `src/lib/utils/ocr-selection.ts`: pure selection helpers, default selection creation, validation, active-zone lookup, export format gating, and timeline lane assignment.
- `src/lib/utils/ocr-selection.test.ts`: Vitest coverage for selection helpers.
- `src/lib/components/video-ocr/OcrTimeline.svelte`: role-based timeline UI with lanes and `ScrollArea`.
- `src/lib/components/video-ocr/LiveOcrHoverCard.svelte`: preview overlay trigger and hovercard for provisional detections.
- `src/lib/components/video-ocr/OcrZoneContextMenu.svelte`: context menu actions for preview zones.

Modify:

- `src/lib/types/video-ocr.ts`: add `OcrZoneRole`, `OcrZone`, `OcrSegment`, `VideoOcrSelection`, role-aware raw frames/subtitles, live event payloads, and ASS output format.
- `src/lib/stores/video-ocr.svelte.ts`: replace region actions with selection actions and live detection state.
- `src/lib/stores/video-ocr.test.ts`: cover default selection and selection mutation.
- `src/lib/services/ocr-storage.ts`: persist the new format and reject unsupported legacy `ocrRegion` data.
- `src/lib/components/video-ocr/video-ocr-processing.ts`: send `selection` to Rust, normalize role-aware results, and wire live detections.
- `src/lib/components/video-ocr/video-ocr-processing.test.ts`: assert `run_ocr_pipeline` payload uses `selection`.
- `src/lib/components/video-ocr/VideoPreview.svelte`: preview-first context menu, multi-zone overlay, live hovercard, and no duplicate progress badge.
- `src/lib/components/video-ocr/RegionSelector.svelte`: make drawing reusable for new zone creation instead of one global region.
- `src/lib/components/video-ocr/VideoOcrWorkspace.svelte`: pass selection handlers and render timeline.
- `src/lib/components/views/VideoOcrView.svelte`: persistence, event listeners, region-copy option, and export gating.
- `src-tauri/src/tools/ocr/mod.rs`: Rust selection, role, positioned subtitle, live detection event, and pipeline result types.
- `src-tauri/src/tools/ocr/pipeline.rs`: validate selection, crop active zones per frame, emit live detections, and return role-aware raw results.
- `src-tauri/src/tools/ocr/subtitles.rs`: generate subtitles grouped by role and zone.
- `src-tauri/src/tools/ocr/export.rs`: add ASS export and reject SRT/VTT when positioned subtitles exist.

Do not touch unrelated modified files such as `src-tauri/src/tools/mediaflow_api.rs`.

---

### Task 1: Frontend Selection Types And Pure Helpers

**Files:**
- Modify: `src/lib/types/video-ocr.ts`
- Create: `src/lib/utils/ocr-selection.ts`
- Create: `src/lib/utils/ocr-selection.test.ts`
- Modify: `src/lib/utils/index.ts`

- [ ] **Step 1: Write failing helper tests**

Add `src/lib/utils/ocr-selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { OcrSegment, VideoOcrSelection } from '$lib/types';
import {
  DEFAULT_MAIN_SUBTITLE_REGION,
  assignOcrTimelineLanes,
  createDefaultVideoOcrSelection,
  getActiveOcrZonesAtTime,
  getAllowedOcrExportFormats,
  validateVideoOcrSelection,
} from './ocr-selection';

describe('OCR selection helpers', () => {
  it('creates a full-duration main subtitle default selection', () => {
    const selection = createDefaultVideoOcrSelection(125_000);

    expect(selection.segments).toHaveLength(1);
    expect(selection.segments[0]).toMatchObject({
      startTimeMs: 0,
      endTimeMs: 125_000,
    });
    expect(selection.segments[0].zones[0]).toMatchObject({
      role: 'main_subtitle',
      region: DEFAULT_MAIN_SUBTITLE_REGION,
    });
  });

  it('returns the union of zones from overlapping segments', () => {
    const selection: VideoOcrSelection = {
      segments: [
        segment('dialogue', 0, 5_000, 'main_subtitle'),
        segment('sign', 2_000, 3_000, 'on_screen_text'),
      ],
    };

    expect(getActiveOcrZonesAtTime(selection, 1_000).map((zone) => zone.role)).toEqual(['main_subtitle']);
    expect(getActiveOcrZonesAtTime(selection, 2_500).map((zone) => zone.role)).toEqual([
      'main_subtitle',
      'on_screen_text',
    ]);
  });

  it('requires ASS when positioned text exists', () => {
    expect(getAllowedOcrExportFormats({ segments: [segment('dialogue', 0, 5_000, 'main_subtitle')] }))
      .toEqual(['srt', 'vtt']);
    expect(getAllowedOcrExportFormats({ segments: [segment('sign', 0, 5_000, 'on_screen_text')] }))
      .toEqual(['ass']);
  });

  it('assigns overlapping timeline blocks to separate lanes', () => {
    const lanes = assignOcrTimelineLanes([
      block('a', 0, 5_000),
      block('b', 1_000, 2_000),
      block('c', 5_000, 8_000),
    ]);

    expect(lanes.find((entry) => entry.id === 'a')?.lane).toBe(0);
    expect(lanes.find((entry) => entry.id === 'b')?.lane).toBe(1);
    expect(lanes.find((entry) => entry.id === 'c')?.lane).toBe(0);
  });

  it('reports invalid segments and regions', () => {
    const errors = validateVideoOcrSelection(
      {
        segments: [
          {
            id: 'bad',
            startTimeMs: 8_000,
            endTimeMs: 2_000,
            zones: [
              {
                id: 'zone-bad',
                role: 'main_subtitle',
                region: { x: -1, y: 0, width: 0.01, height: 0.25 },
              },
            ],
          },
        ],
      },
      10_000,
    );

    expect(errors).toContain('Segment bad must start before it ends.');
    expect(errors).toContain('Zone zone-bad must stay within the video frame.');
    expect(errors).toContain('Zone zone-bad is too small.');
  });
});

function segment(id: string, startTimeMs: number, endTimeMs: number, role: 'main_subtitle' | 'on_screen_text'): OcrSegment {
  return {
    id,
    startTimeMs,
    endTimeMs,
    zones: [
      {
        id: `${id}-zone`,
        role,
        region: DEFAULT_MAIN_SUBTITLE_REGION,
      },
    ],
  };
}

function block(id: string, startTimeMs: number, endTimeMs: number) {
  return { id, startTimeMs, endTimeMs };
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm test -- src/lib/utils/ocr-selection.test.ts
```

Expected: fail with missing `./ocr-selection` exports.

- [ ] **Step 3: Add frontend types**

In `src/lib/types/video-ocr.ts`, add these types near the current OCR region section:

```ts
export type OcrZoneRole = 'main_subtitle' | 'on_screen_text';

export interface OcrZone {
  id: string;
  region: OcrRegion;
  role: OcrZoneRole;
  label?: string;
}

export interface OcrSegment {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  zones: OcrZone[];
}

export interface VideoOcrSelection {
  segments: OcrSegment[];
}

export interface OcrZoneFrame {
  frameIndex: number;
  timeMs: number;
  segmentId: string;
  zoneId: string;
  role: OcrZoneRole;
  region: OcrRegion;
  text: string;
  confidence: number;
}

export interface OcrLiveDetectionEvent {
  fileId: string;
  operationId?: string | null;
  detection: OcrZoneFrame;
}
```

Update `OcrVideoFile` to replace `ocrRegion`/`ocrRegionMode` with:

```ts
ocrSelection: VideoOcrSelection;
```

Keep `OcrRegionMode` temporarily only if other code still imports it during the migration; remove it in the final cleanup task.

Update `OcrOutputFormat`:

```ts
export type OcrOutputFormat = 'srt' | 'vtt' | 'ass';
```

Update `OCR_OUTPUT_FORMATS` to include ASS and remove TXT unless an existing workflow still requires TXT. The spec requires SRT/VTT or ASS.

- [ ] **Step 4: Implement pure helpers**

Create `src/lib/utils/ocr-selection.ts`:

```ts
import type {
  OcrOutputFormat,
  OcrRegion,
  OcrSegment,
  OcrZone,
  OcrZoneRole,
  VideoOcrSelection,
} from '$lib/types';

export const DEFAULT_MAIN_SUBTITLE_REGION: OcrRegion = {
  x: 0,
  y: 0.75,
  width: 1,
  height: 0.25,
};

const MIN_REGION_SIZE = 0.02;

export interface TimelineBlock {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
}

export interface TimelineBlockWithLane extends TimelineBlock {
  lane: number;
}

export function createDefaultVideoOcrSelection(durationMs: number): VideoOcrSelection {
  const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 1;

  return {
    segments: [
      {
        id: generateSelectionId('ocr-segment'),
        startTimeMs: 0,
        endTimeMs: safeDurationMs,
        zones: [
          {
            id: generateSelectionId('ocr-zone'),
            role: 'main_subtitle',
            region: { ...DEFAULT_MAIN_SUBTITLE_REGION },
          },
        ],
      },
    ],
  };
}

export function createOcrSegmentFromZone(
  startTimeMs: number,
  endTimeMs: number,
  region: OcrRegion,
  role: OcrZoneRole = 'main_subtitle',
): OcrSegment {
  return {
    id: generateSelectionId('ocr-segment'),
    startTimeMs: Math.max(0, Math.round(startTimeMs)),
    endTimeMs: Math.max(Math.round(startTimeMs) + 1, Math.round(endTimeMs)),
    zones: [
      {
        id: generateSelectionId('ocr-zone'),
        role,
        region: clampRegion(region),
      },
    ],
  };
}

export function getActiveOcrZonesAtTime(selection: VideoOcrSelection, timeMs: number): OcrZone[] {
  return selection.segments
    .filter((segment) => timeMs >= segment.startTimeMs && timeMs < segment.endTimeMs)
    .flatMap((segment) => segment.zones);
}

export function selectionHasRole(selection: VideoOcrSelection, role: OcrZoneRole): boolean {
  return selection.segments.some((segment) => segment.zones.some((zone) => zone.role === role));
}

export function getAllowedOcrExportFormats(selection: VideoOcrSelection): OcrOutputFormat[] {
  return selectionHasRole(selection, 'on_screen_text') ? ['ass'] : ['srt', 'vtt'];
}

export function assignOcrTimelineLanes<T extends TimelineBlock>(blocks: T[]): Array<T & { lane: number }> {
  const sorted = [...blocks].sort((a, b) => a.startTimeMs - b.startTimeMs || a.endTimeMs - b.endTimeMs);
  const laneEndTimes: number[] = [];

  return sorted.map((block) => {
    const lane = laneEndTimes.findIndex((endTimeMs) => block.startTimeMs >= endTimeMs);
    const nextLane = lane === -1 ? laneEndTimes.length : lane;
    laneEndTimes[nextLane] = block.endTimeMs;
    return { ...block, lane: nextLane };
  });
}

export function validateVideoOcrSelection(selection: VideoOcrSelection, durationMs: number): string[] {
  const errors: string[] = [];
  const safeDurationMs = Math.max(1, Math.round(durationMs));

  for (const segment of selection.segments) {
    if (segment.startTimeMs < 0 || segment.endTimeMs > safeDurationMs) {
      errors.push(`Segment ${segment.id} must stay within the video duration.`);
    }
    if (segment.startTimeMs >= segment.endTimeMs) {
      errors.push(`Segment ${segment.id} must start before it ends.`);
    }
    if (segment.zones.length === 0) {
      errors.push(`Segment ${segment.id} must contain at least one OCR zone.`);
    }

    for (const zone of segment.zones) {
      if (!regionIsInsideFrame(zone.region)) {
        errors.push(`Zone ${zone.id} must stay within the video frame.`);
      }
      if (zone.region.width < MIN_REGION_SIZE || zone.region.height < MIN_REGION_SIZE) {
        errors.push(`Zone ${zone.id} is too small.`);
      }
    }
  }

  return errors;
}

export function clampRegion(region: OcrRegion): OcrRegion {
  const x = clamp01(region.x);
  const y = clamp01(region.y);
  const width = Math.min(clamp01(region.width), 1 - x);
  const height = Math.min(clamp01(region.height), 1 - y);
  return { x, y, width, height };
}

function regionIsInsideFrame(region: OcrRegion): boolean {
  return region.x >= 0
    && region.y >= 0
    && region.width > 0
    && region.height > 0
    && region.x + region.width <= 1
    && region.y + region.height <= 1;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function generateSelectionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
```

Export it from `src/lib/utils/index.ts`:

```ts
export * from './ocr-selection';
```

- [ ] **Step 5: Run helper tests**

Run:

```bash
pnpm test -- src/lib/utils/ocr-selection.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types/video-ocr.ts src/lib/utils/ocr-selection.ts src/lib/utils/ocr-selection.test.ts src/lib/utils/index.ts
git commit -m "feat: add video OCR selection helpers"
```

---

### Task 2: Store And Persistence Migration To Selection Model

**Files:**
- Modify: `src/lib/stores/video-ocr.svelte.ts`
- Modify: `src/lib/stores/video-ocr.test.ts`
- Modify: `src/lib/services/ocr-storage.ts`
- Create or modify: `src/lib/services/ocr-storage.test.ts`
- Modify: `src/lib/types/video-ocr.ts`

- [ ] **Step 1: Add failing store tests**

Append to `src/lib/stores/video-ocr.test.ts`:

```ts
import { createOcrSegmentFromZone, DEFAULT_MAIN_SUBTITLE_REGION } from '$lib/utils';

it('creates imported files with a full-duration main subtitle selection', () => {
  const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

  videoOcrStore.updateFile(file.id, { duration: 120 });

  const selected = videoOcrStore.videoFiles[0].ocrSelection;
  expect(selected.segments[0].startTimeMs).toBe(0);
  expect(selected.segments[0].endTimeMs).toBe(120_000);
  expect(selected.segments[0].zones[0].role).toBe('main_subtitle');
});

it('adds a segment zone from the current timestamp and defaults to main subtitles', () => {
  const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);
  videoOcrStore.updateFile(file.id, { duration: 120 });

  const segment = createOcrSegmentFromZone(10_000, 120_000, DEFAULT_MAIN_SUBTITLE_REGION);
  videoOcrStore.addOcrSegment(file.id, segment);

  expect(videoOcrStore.videoFiles[0].ocrSelection.segments).toContainEqual(segment);
});

it('changes a zone role without changing its geometry', () => {
  const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);
  const segment = file.ocrSelection.segments[0];
  const zone = segment.zones[0];

  videoOcrStore.setOcrZoneRole(file.id, segment.id, zone.id, 'on_screen_text');

  const updatedZone = videoOcrStore.videoFiles[0].ocrSelection.segments[0].zones[0];
  expect(updatedZone.role).toBe('on_screen_text');
  expect(updatedZone.region).toEqual(zone.region);
});
```

- [ ] **Step 2: Add failing persistence tests**

If `src/lib/services/ocr-storage.test.ts` does not exist, create it with mocks for `mediaflow-storage`. Include:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoOcrPersistenceData } from '$lib/types';
import { createDefaultVideoOcrSelection } from '$lib/utils';
import { loadOcrData, saveOcrData } from './ocr-storage';

const loadMediaflowDataMock = vi.hoisted(() => vi.fn());
const saveMediaflowDataMock = vi.hoisted(() => vi.fn());

vi.mock('./mediaflow-storage', () => ({
  loadMediaflowData: loadMediaflowDataMock,
  saveMediaflowData: saveMediaflowDataMock,
}));

describe('OCR storage', () => {
  beforeEach(() => {
    loadMediaflowDataMock.mockReset();
    saveMediaflowDataMock.mockReset();
  });

  it('saves video OCR selection data', async () => {
    saveMediaflowDataMock.mockResolvedValueOnce(true);
    loadMediaflowDataMock.mockResolvedValueOnce(null);
    const data: VideoOcrPersistenceData = {
      version: 2,
      videoPath: '/movie.mp4',
      ocrSelection: createDefaultVideoOcrSelection(60_000),
      ocrVersions: [],
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    };

    await saveOcrData('/movie.mp4', data);

    expect(saveMediaflowDataMock).toHaveBeenCalledWith('/movie.mp4', expect.objectContaining({
      videoOcr: expect.objectContaining({
        version: 2,
        ocrSelection: data.ocrSelection,
      }),
    }));
  });

  it('rejects legacy OCR region persistence', async () => {
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      videoOcr: {
        version: 1,
        videoPath: '/movie.mp4',
        ocrRegion: { x: 0, y: 0.75, width: 1, height: 0.25 },
        ocrRegionMode: 'custom',
        ocrVersions: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    await expect(loadOcrData('/movie.mp4')).rejects.toThrow(
      'This Video OCR data was created with an older MediaFlow version and is not supported.',
    );
  });
});
```

- [ ] **Step 3: Run tests and verify they fail**

```bash
pnpm test -- src/lib/stores/video-ocr.test.ts src/lib/services/ocr-storage.test.ts
```

Expected: fail on missing `ocrSelection` store actions and storage shape.

- [ ] **Step 4: Update persistence type**

In `src/lib/types/video-ocr.ts`, replace `VideoOcrPersistenceData` with:

```ts
export interface VideoOcrPersistenceData {
  version: 2;
  videoPath: string;
  previewPath?: string;
  previewSourceIdentity?: OcrPreviewSourceIdentity;
  previewVersion?: string;
  ocrSelection: VideoOcrSelection;
  ocrVersions: OcrVersion[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 5: Update store creation and selection actions**

In `src/lib/stores/video-ocr.svelte.ts`:

Import:

```ts
import type { OcrSegment, OcrZoneRole, VideoOcrSelection } from '$lib/types';
import { createDefaultVideoOcrSelection } from '$lib/utils';
```

In `createEmptyVideoFile`, initialize:

```ts
const defaultDurationMs = 1;
ocrSelection: createDefaultVideoOcrSelection(defaultDurationMs),
```

In `updateFile`, when `duration` changes from undefined to a number and the file still has the initial sentinel end time `1`, update the default selection to the real duration:

```ts
const durationMs = updates.duration ? Math.round(updates.duration * 1000) : undefined;
const nextFile = { ...f, ...updates };
if (durationMs && f.ocrSelection.segments.length === 1 && f.ocrSelection.segments[0].endTimeMs === 1) {
  return { ...nextFile, ocrSelection: createDefaultVideoOcrSelection(durationMs) };
}
return nextFile;
```

Add store actions:

```ts
setOcrSelection(fileId: string, selection: VideoOcrSelection) {
  videoFiles = videoFiles.map((file) =>
    file.id === fileId ? { ...file, ocrSelection: cloneSelection(selection) } : file
  );
},

addOcrSegment(fileId: string, segment: OcrSegment) {
  videoFiles = videoFiles.map((file) =>
    file.id === fileId
      ? {
          ...file,
          ocrSelection: {
            segments: [...file.ocrSelection.segments, cloneSegment(segment)],
          },
        }
      : file
  );
},

setOcrZoneRole(fileId: string, segmentId: string, zoneId: string, role: OcrZoneRole) {
  videoFiles = videoFiles.map((file) =>
    file.id === fileId
      ? {
          ...file,
          ocrSelection: {
            segments: file.ocrSelection.segments.map((segment) =>
              segment.id === segmentId
                ? {
                    ...segment,
                    zones: segment.zones.map((zone) =>
                      zone.id === zoneId ? { ...zone, role } : zone
                    ),
                  }
                : segment
            ),
          },
        }
      : file
  );
},
```

Define local clone helpers at module scope:

```ts
function cloneSegment(segment: OcrSegment): OcrSegment {
  return {
    ...segment,
    zones: segment.zones.map((zone) => ({ ...zone, region: { ...zone.region } })),
  };
}

function cloneSelection(selection: VideoOcrSelection): VideoOcrSelection {
  return { segments: selection.segments.map(cloneSegment) };
}
```

Remove old `setGlobalRegion`, `setFileRegionMode`, `setFileRegionCustom`, `applyGlobalRegionToGlobalFiles`, `setOcrRegion`, and `clearOcrRegion` once callers are migrated in later tasks.

- [ ] **Step 6: Update storage implementation**

In `src/lib/services/ocr-storage.ts`:

Remove `OcrRegion`/`OcrRegionMode` options. Update `createEmptyOcrData` to require `ocrSelection`:

```ts
function createEmptyOcrData(
  videoPath: string,
  ocrSelection: VideoOcrSelection,
  previewPath?: string,
  previewSourceIdentity?: OcrPreviewSourceIdentity,
  previewVersion?: string,
): VideoOcrPersistenceData {
  const now = new Date().toISOString();
  return {
    version: 2,
    videoPath,
    previewPath,
    previewSourceIdentity,
    previewVersion,
    ocrSelection,
    ocrVersions: [],
    createdAt: now,
    updatedAt: now,
  };
}
```

In `loadOcrData`, reject legacy shape:

```ts
if ('ocrRegion' in mediaflowData.videoOcr || mediaflowData.videoOcr.version !== 2) {
  throw new Error('This Video OCR data was created with an older MediaFlow version and is not supported.');
}
```

In `saveOcrData`, write `version: 2` inside `videoOcr`.

Update `addOcrVersion` options:

```ts
options?: {
  previewPath?: string;
  previewSourceIdentity?: OcrPreviewSourceIdentity;
  previewVersion?: string;
  ocrSelection: VideoOcrSelection;
}
```

- [ ] **Step 7: Run tests**

```bash
pnpm test -- src/lib/stores/video-ocr.test.ts src/lib/services/ocr-storage.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types/video-ocr.ts src/lib/stores/video-ocr.svelte.ts src/lib/stores/video-ocr.test.ts src/lib/services/ocr-storage.ts src/lib/services/ocr-storage.test.ts
git commit -m "feat: persist video OCR selections"
```

---

### Task 3: Role-Based OCR Timeline UI

**Files:**
- Create: `src/lib/components/video-ocr/OcrTimeline.svelte`
- Modify: `src/lib/components/video-ocr/VideoOcrWorkspace.svelte`
- Modify: `src/lib/components/video-ocr/VideoPreview.svelte`
- Test: `src/lib/utils/ocr-selection.test.ts`

- [ ] **Step 1: Extend lane helper tests for role grouping**

Add to `src/lib/utils/ocr-selection.test.ts`:

```ts
it('keeps role blocks independently lane-assigned by caller grouping', () => {
  const main = assignOcrTimelineLanes([block('main', 0, 5_000)]);
  const onscreen = assignOcrTimelineLanes([
    block('sign', 1_000, 4_000),
    block('board', 2_000, 3_000),
  ]);

  expect(main).toEqual([expect.objectContaining({ id: 'main', lane: 0 })]);
  expect(onscreen).toEqual([
    expect.objectContaining({ id: 'sign', lane: 0 }),
    expect.objectContaining({ id: 'board', lane: 1 }),
  ]);
});
```

- [ ] **Step 2: Run helper test**

```bash
pnpm test -- src/lib/utils/ocr-selection.test.ts
```

Expected: pass after Task 1 helpers exist.

- [ ] **Step 3: Create the timeline component**

Create `src/lib/components/video-ocr/OcrTimeline.svelte` with shadcn `Card`, `ScrollArea`, `Badge`, and `ContextMenu`:

```svelte
<script lang="ts">
  import type { OcrSegment, OcrZoneRole, VideoOcrSelection } from '$lib/types';
  import { assignOcrTimelineLanes } from '$lib/utils';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import * as ContextMenu from '$lib/components/ui/context-menu';

  interface OcrTimelineProps {
    selection: VideoOcrSelection;
    durationMs: number;
    currentTimeMs: number;
    onSelect?: (segmentId: string, zoneId: string) => void;
    onSetRole?: (segmentId: string, zoneId: string, role: OcrZoneRole) => void;
    onDeleteZone?: (segmentId: string, zoneId: string) => void;
    onTrimSegment?: (segmentId: string, startTimeMs: number, endTimeMs: number) => void;
  }

  let {
    selection,
    durationMs,
    currentTimeMs,
    onSelect,
    onSetRole,
    onDeleteZone,
  }: OcrTimelineProps = $props();

  const roles: Array<{ role: OcrZoneRole; label: string; className: string }> = [
    { role: 'main_subtitle', label: 'Main subtitle', className: 'border-blue-400 bg-blue-100 text-blue-900' },
    { role: 'on_screen_text', label: 'On-screen text', className: 'border-amber-400 bg-amber-100 text-amber-900' },
  ];

  function blocksForRole(role: OcrZoneRole) {
    return selection.segments.flatMap((segment) =>
      segment.zones
        .filter((zone) => zone.role === role)
        .map((zone) => ({
          id: `${segment.id}:${zone.id}`,
          segmentId: segment.id,
          zoneId: zone.id,
          label: zone.label ?? (role === 'main_subtitle' ? 'Dialogue' : 'Text'),
          startTimeMs: segment.startTimeMs,
          endTimeMs: segment.endTimeMs,
        }))
    );
  }

  function percent(ms: number): number {
    return durationMs > 0 ? Math.max(0, Math.min(100, (ms / durationMs) * 100)) : 0;
  }
</script>

<Card class="min-h-0">
  <CardHeader class="py-3">
    <div class="flex items-center justify-between gap-3">
      <CardTitle class="text-sm">OCR timeline</CardTitle>
      <Badge variant="secondary">{selection.segments.length} segments</Badge>
    </div>
  </CardHeader>
  <CardContent class="space-y-3">
    {#each roles as roleConfig}
      {@const blocks = assignOcrTimelineLanes(blocksForRole(roleConfig.role))}
      {@const laneCount = Math.max(1, ...blocks.map((block) => block.lane + 1))}
      <div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
        <div class="pt-2 text-xs font-medium text-muted-foreground">{roleConfig.label}</div>
        <ScrollArea class="max-h-28 rounded-md border bg-muted/20">
          <div class="relative min-h-10" style={`height: ${laneCount * 34 + 12}px`}>
            <div class="absolute left-0 right-0 top-1/2 h-px bg-border"></div>
            {#each blocks as block}
              <ContextMenu.Root>
                <ContextMenu.Trigger>
                  <button
                    type="button"
                    class={`absolute h-6 rounded border px-2 text-left text-xs ${roleConfig.className}`}
                    style={`
                      left: ${percent(block.startTimeMs)}%;
                      width: ${Math.max(1, percent(block.endTimeMs) - percent(block.startTimeMs))}%;
                      top: ${6 + block.lane * 34}px;
                    `}
                    onclick={() => onSelect?.(block.segmentId, block.zoneId)}
                  >
                    {block.label}
                  </button>
                </ContextMenu.Trigger>
                <ContextMenu.Content>
                  <ContextMenu.Item onclick={() => onSetRole?.(block.segmentId, block.zoneId, 'main_subtitle')}>
                    Set as Main subtitle
                  </ContextMenu.Item>
                  <ContextMenu.Item onclick={() => onSetRole?.(block.segmentId, block.zoneId, 'on_screen_text')}>
                    Set as On-screen text
                  </ContextMenu.Item>
                  <ContextMenu.Separator />
                  <ContextMenu.Item onclick={() => onDeleteZone?.(block.segmentId, block.zoneId)}>
                    Delete zone
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Root>
            {/each}
            <div
              class="absolute bottom-0 top-0 w-px bg-foreground"
              style={`left: ${percent(currentTimeMs)}%`}
            ></div>
          </div>
        </ScrollArea>
      </div>
    {/each}
  </CardContent>
</Card>
```

- [ ] **Step 4: Render timeline in workspace**

In `VideoOcrWorkspace.svelte`, import `OcrTimeline` and render it between `VideoPreview` and `OcrLogPanel`. Pass:

```svelte
<OcrTimeline
  selection={file.ocrSelection}
  durationMs={Math.round((file.duration ?? 0) * 1000)}
  currentTimeMs={currentTimeMsFromPreview}
  onSetRole={onSetZoneRole}
/>
```

If `currentTimeMsFromPreview` is not available yet, introduce a prop callback from `VideoPreview`:

```ts
onTimeChange?: (timeMs: number) => void;
```

- [ ] **Step 5: Run check**

```bash
pnpm check
```

Expected: no Svelte/TypeScript errors in timeline props/imports.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/video-ocr/OcrTimeline.svelte src/lib/components/video-ocr/VideoOcrWorkspace.svelte src/lib/components/video-ocr/VideoPreview.svelte src/lib/utils/ocr-selection.test.ts
git commit -m "feat: add OCR timeline lanes"
```

---

### Task 4: Preview-First Zone Creation And Context Menus

**Files:**
- Modify: `src/lib/components/video-ocr/VideoPreview.svelte`
- Modify: `src/lib/components/video-ocr/RegionSelector.svelte`
- Create: `src/lib/components/video-ocr/OcrZoneContextMenu.svelte`
- Modify: `src/lib/components/views/VideoOcrView.svelte`

- [ ] **Step 1: Define preview action props**

In `VideoPreview.svelte`, replace region-specific props with selection callbacks:

```ts
import type { OcrRegion, OcrSegment, OcrZoneRole, OcrVideoFile } from '$lib/types';

interface VideoPreviewProps {
  file?: OcrVideoFile;
  showSubtitles?: boolean;
  suspendPlayback?: boolean;
  onAddSegmentFromRegion?: (region: OcrRegion, startTimeMs: number, endTimeMs: number) => void | Promise<void>;
  onSetZoneRole?: (segmentId: string, zoneId: string, role: OcrZoneRole) => void | Promise<void>;
  onSetSegmentEndAtCurrentTime?: (segmentId: string, endTimeMs: number) => void | Promise<void>;
  onPlaybackError?: (fileId: string, reason: string) => void | Promise<void>;
  onTimeChange?: (timeMs: number) => void;
  class?: string;
}
```

- [ ] **Step 2: Make region drawing create a new segment**

Keep `RegionSelector` as the drawing overlay, but use it only while `pendingZoneStartTimeMs !== null`.

In `VideoPreview.svelte`:

```ts
let pendingZoneStartTimeMs = $state<number | null>(null);
let isDrawingZone = $derived(pendingZoneStartTimeMs !== null);

function startAddZoneFromCurrentTime() {
  if (!videoEl || !file?.duration) {
    return;
  }
  pendingZoneStartTimeMs = Math.round(videoEl.currentTime * 1000);
}

function handleNewZoneRegion(region: OcrRegion | undefined) {
  if (!region || pendingZoneStartTimeMs === null || !file?.duration) {
    return;
  }

  const endTimeMs = Math.round(file.duration * 1000);
  void onAddSegmentFromRegion?.(region, pendingZoneStartTimeMs, endTimeMs);
  pendingZoneStartTimeMs = null;
}
```

- [ ] **Step 3: Add shadcn context menu around preview**

Wrap the video container content with `ContextMenu.Root`:

```svelte
<ContextMenu.Root>
  <ContextMenu.Trigger>
    <div bind:this={containerEl} class="relative bg-black rounded-lg overflow-hidden flex-1 min-h-0">
      <!-- existing video and overlays -->
    </div>
  </ContextMenu.Trigger>
  <ContextMenu.Content>
    <ContextMenu.Item onclick={startAddZoneFromCurrentTime}>
      Add OCR zone from current time
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
```

Add `Tooltip` hint only when `file.ocrSelection.segments.length === 0` or no custom user action has happened:

```svelte
<Tooltip>
  <TooltipTrigger>
    <span class="absolute bottom-3 left-3 rounded bg-black/70 px-2 py-1 text-xs text-white">
      Right-click to add OCR zones
    </span>
  </TooltipTrigger>
  <TooltipContent>Use the current playback time as the segment start.</TooltipContent>
</Tooltip>
```

- [ ] **Step 4: Create zone context menu component**

Create `OcrZoneContextMenu.svelte`:

```svelte
<script lang="ts">
  import type { OcrZoneRole } from '$lib/types';
  import * as ContextMenu from '$lib/components/ui/context-menu';

  interface OcrZoneContextMenuProps {
    segmentId: string;
    zoneId: string;
    children: import('svelte').Snippet;
    onSetRole?: (segmentId: string, zoneId: string, role: OcrZoneRole) => void;
    onDeleteZone?: (segmentId: string, zoneId: string) => void;
  }

  let { segmentId, zoneId, children, onSetRole, onDeleteZone }: OcrZoneContextMenuProps = $props();
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content>
    <ContextMenu.Item onclick={() => onSetRole?.(segmentId, zoneId, 'main_subtitle')}>
      Set as Main subtitle
    </ContextMenu.Item>
    <ContextMenu.Item onclick={() => onSetRole?.(segmentId, zoneId, 'on_screen_text')}>
      Set as On-screen text
    </ContextMenu.Item>
    <ContextMenu.Separator />
    <ContextMenu.Item onclick={() => onDeleteZone?.(segmentId, zoneId)}>Delete zone</ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
```

- [ ] **Step 5: Wire view handlers**

In `VideoOcrView.svelte`, implement:

```ts
function handleAddSegmentFromRegion(region: OcrRegion, startTimeMs: number, endTimeMs: number): void {
  const fileId = videoOcrStore.selectedFileId;
  if (!fileId) return;

  videoOcrStore.addOcrSegment(
    fileId,
    createOcrSegmentFromZone(startTimeMs, endTimeMs, region, 'main_subtitle'),
  );
  void persistFileData(fileId);
}

function handleSetZoneRole(segmentId: string, zoneId: string, role: OcrZoneRole): void {
  const fileId = videoOcrStore.selectedFileId;
  if (!fileId) return;

  videoOcrStore.setOcrZoneRole(fileId, segmentId, zoneId, role);
  void persistFileData(fileId);
}
```

- [ ] **Step 6: Run check**

```bash
pnpm check
```

Expected: no TypeScript/Svelte errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/video-ocr/VideoPreview.svelte src/lib/components/video-ocr/RegionSelector.svelte src/lib/components/video-ocr/OcrZoneContextMenu.svelte src/lib/components/views/VideoOcrView.svelte
git commit -m "feat: add preview OCR zone context menus"
```

---

### Task 5: Live OCR Detection State And HoverCard

**Files:**
- Modify: `src/lib/types/video-ocr.ts`
- Modify: `src/lib/stores/video-ocr.svelte.ts`
- Modify: `src/lib/stores/video-ocr.test.ts`
- Create: `src/lib/components/video-ocr/LiveOcrHoverCard.svelte`
- Modify: `src/lib/components/video-ocr/VideoPreview.svelte`
- Modify: `src/lib/components/views/VideoOcrView.svelte`

- [ ] **Step 1: Add failing store test**

Append to `src/lib/stores/video-ocr.test.ts`:

```ts
it('keeps recent live OCR detections per operation and clears them after reset', () => {
  const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);
  videoOcrStore.startProcessing(file.id, 'ocr-run-1');

  videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', {
    frameIndex: 1,
    timeMs: 1000,
    segmentId: 'segment-1',
    zoneId: 'zone-1',
    role: 'main_subtitle',
    region: { x: 0, y: 0.75, width: 1, height: 0.25 },
    text: 'Hello',
    confidence: 0.91,
  });

  expect(videoOcrStore.getLiveDetections(file.id)).toHaveLength(1);

  videoOcrStore.addLiveDetection(file.id, 'stale-run', {
    frameIndex: 2,
    timeMs: 2000,
    segmentId: 'segment-1',
    zoneId: 'zone-1',
    role: 'main_subtitle',
    region: { x: 0, y: 0.75, width: 1, height: 0.25 },
    text: 'Stale',
    confidence: 0.5,
  });

  expect(videoOcrStore.getLiveDetections(file.id).map((detection) => detection.text)).toEqual(['Hello']);

  videoOcrStore.reset();
  expect(videoOcrStore.getLiveDetections(file.id)).toEqual([]);
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
pnpm test -- src/lib/stores/video-ocr.test.ts
```

Expected: fail on missing live detection store methods.

- [ ] **Step 3: Add live detection store state**

In `video-ocr.svelte.ts`:

```ts
let liveDetectionsByFileId = $state.raw<Map<string, OcrZoneFrame[]>>(new Map());
const MAX_LIVE_DETECTIONS_PER_FILE = 100;
```

Add methods:

```ts
addLiveDetection(fileId: string, operationId: string | null | undefined, detection: OcrZoneFrame) {
  const activeOperationId = activeOperationIdsByFileId.get(fileId);
  if (activeOperationId && operationId && activeOperationId !== operationId) {
    return;
  }

  const current = liveDetectionsByFileId.get(fileId) ?? [];
  liveDetectionsByFileId = new Map(liveDetectionsByFileId).set(
    fileId,
    [...current, detection].slice(-MAX_LIVE_DETECTIONS_PER_FILE),
  );
},

getLiveDetections(fileId: string): OcrZoneFrame[] {
  return liveDetectionsByFileId.get(fileId) ?? [];
},

clearLiveDetections(fileId: string) {
  const next = new Map(liveDetectionsByFileId);
  next.delete(fileId);
  liveDetectionsByFileId = next;
},
```

Clear detections in `startProcessing`, `cancelProcessing`, `removeFile`, `clear`, and successful completion.

- [ ] **Step 4: Create hovercard component**

Create `LiveOcrHoverCard.svelte`:

```svelte
<script lang="ts">
  import type { OcrZoneFrame } from '$lib/types';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as HoverCard from '$lib/components/ui/hover-card';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  interface LiveOcrHoverCardProps {
    detections: OcrZoneFrame[];
  }

  let { detections }: LiveOcrHoverCardProps = $props();

  const recent = $derived(detections.slice(-8).reverse());
</script>

{#if detections.length > 0}
  <HoverCard.Root openDelay={150} closeDelay={100}>
    <HoverCard.Trigger>
      <Button variant="secondary" size="sm" class="absolute right-3 top-3 rounded-full shadow">
        Live detections · {detections.length}
      </Button>
    </HoverCard.Trigger>
    <HoverCard.Content class="w-80">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-sm font-medium">Live detections</h3>
        <Badge variant="secondary">Provisional</Badge>
      </div>
      <ScrollArea class="max-h-64">
        <div class="space-y-2">
          {#each recent as detection}
            <div class="rounded-md border p-2 text-xs">
              <div class="mb-1 flex items-center justify-between text-muted-foreground">
                <span>{Math.round(detection.timeMs / 1000)}s · {detection.role === 'main_subtitle' ? 'Main' : 'On-screen'}</span>
                <span>{Math.round(detection.confidence * 100)}%</span>
              </div>
              <p class="text-sm text-foreground">{detection.text}</p>
            </div>
          {/each}
        </div>
      </ScrollArea>
    </HoverCard.Content>
  </HoverCard.Root>
{/if}
```

- [ ] **Step 5: Wire Tauri event listener**

In `VideoOcrView.svelte`, add listener alongside progress listener:

```ts
const unlistenLiveDetection = await listen<OcrLiveDetectionEvent>('ocr-live-detection', (event) => {
  videoOcrStore.addLiveDetection(
    event.payload.fileId,
    event.payload.operationId,
    event.payload.detection,
  );
});
```

Dispose it in the existing cleanup.

- [ ] **Step 6: Render live detections in preview**

In `VideoPreview.svelte`, pass `liveDetections` prop and render:

```svelte
<LiveOcrHoverCard detections={liveDetections ?? []} />
```

Do not add an OCR progress badge inside the preview.

- [ ] **Step 7: Run tests/check**

```bash
pnpm test -- src/lib/stores/video-ocr.test.ts
pnpm check
```

Expected: tests and check pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types/video-ocr.ts src/lib/stores/video-ocr.svelte.ts src/lib/stores/video-ocr.test.ts src/lib/components/video-ocr/LiveOcrHoverCard.svelte src/lib/components/video-ocr/VideoPreview.svelte src/lib/components/views/VideoOcrView.svelte
git commit -m "feat: show live OCR detections"
```

---

### Task 6: Frontend Processing Payload And Export Gating

**Files:**
- Modify: `src/lib/components/video-ocr/video-ocr-processing.ts`
- Modify: `src/lib/components/video-ocr/video-ocr-processing.test.ts`
- Modify: `src/lib/components/views/VideoOcrView.svelte`
- Modify: `src/lib/types/video-ocr.ts`

- [ ] **Step 1: Update failing processing test**

In `video-ocr-processing.test.ts`, change the pipeline payload assertion:

```ts
expect(invokeMock).toHaveBeenCalledWith(
  'run_ocr_pipeline',
  expect.objectContaining({
    numWorkers: DEFAULT_OCR_WORKER_COUNT,
    videoPath: '/Volumes/NAS/source.mkv',
    selection: file.ocrSelection,
  }),
);
```

Also assert the old `region` key is absent:

```ts
expect(invokeMock.mock.calls[0][1]).not.toHaveProperty('region');
```

- [ ] **Step 2: Run test and verify it fails**

```bash
pnpm test -- src/lib/components/video-ocr/video-ocr-processing.test.ts
```

Expected: fail because `region` is still sent.

- [ ] **Step 3: Send selection to Rust**

In `runFullPipeline`, change invoke payload:

```ts
selection: current.ocrSelection,
```

Remove:

```ts
region: current.ocrRegion ?? null,
```

Normalize `pipelineResult.rawOcr` as role-aware frames. If the old `normalizeOcrRawFrames` only supports old frames, add `normalizeOcrZoneFrames` in `$lib/utils` and use it here.

- [ ] **Step 4: Gate export formats in the view**

In `VideoOcrView.svelte`, wherever export formats are listed, derive:

```ts
const selectedExportFormats = $derived.by(() => {
  const file = videoOcrStore.selectedFile;
  return file ? getAllowedOcrExportFormats(file.ocrSelection) : ['srt', 'vtt'];
});
```

If selected format is not in `selectedExportFormats`, reset it to the first allowed format.

Show concise disabled reason when ASS is required:

```svelte
{#if selectedExportFormats.length === 1 && selectedExportFormats[0] === 'ass'}
  <p class="text-xs text-muted-foreground">ASS required for positioned text.</p>
{/if}
```

- [ ] **Step 5: Run frontend checks**

```bash
pnpm test -- src/lib/components/video-ocr/video-ocr-processing.test.ts
pnpm check
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/video-ocr/video-ocr-processing.ts src/lib/components/video-ocr/video-ocr-processing.test.ts src/lib/components/views/VideoOcrView.svelte src/lib/types/video-ocr.ts
git commit -m "feat: send OCR selections to pipeline"
```

---

### Task 7: Rust Selection Types, Validation, And ASS Export

**Files:**
- Modify: `src-tauri/src/tools/ocr/mod.rs`
- Modify: `src-tauri/src/tools/ocr/export.rs`

- [ ] **Step 1: Add Rust type and validation tests**

In `src-tauri/src/tools/ocr/mod.rs`, add tests under a new `#[cfg(test)] mod tests` after adding types in Step 3:

```rust
#[cfg(test)]
mod tests {
    use super::{
        validate_ocr_selection, OcrRegion, OcrSegment, OcrSelection, OcrZone, OcrZoneRole,
    };

    #[test]
    fn selection_validation_rejects_bad_segment_bounds() {
        let selection = OcrSelection {
            segments: vec![OcrSegment {
                id: "bad".to_string(),
                start_time_ms: 5000,
                end_time_ms: 1000,
                zones: vec![valid_zone()],
            }],
        };

        let error = validate_ocr_selection(&selection, 10_000).expect_err("selection should fail");
        assert!(error.contains("Segment bad must start before it ends"));
    }

    #[test]
    fn selection_validation_allows_overlapping_segments() {
        let selection = OcrSelection {
            segments: vec![
                OcrSegment {
                    id: "a".to_string(),
                    start_time_ms: 0,
                    end_time_ms: 5000,
                    zones: vec![valid_zone()],
                },
                OcrSegment {
                    id: "b".to_string(),
                    start_time_ms: 1000,
                    end_time_ms: 3000,
                    zones: vec![OcrZone {
                        id: "zone-b".to_string(),
                        role: OcrZoneRole::OnScreenText,
                        region: OcrRegion { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
                        label: None,
                    }],
                },
            ],
        };

        validate_ocr_selection(&selection, 10_000).expect("overlap should be allowed");
    }

    fn valid_zone() -> OcrZone {
        OcrZone {
            id: "zone-a".to_string(),
            role: OcrZoneRole::MainSubtitle,
            region: OcrRegion { x: 0.0, y: 0.75, width: 1.0, height: 0.25 },
            label: None,
        }
    }
}
```

- [ ] **Step 2: Add ASS export tests**

In `export.rs` tests:

```rust
#[test]
fn format_ass_positions_on_screen_text() {
    let subtitles = vec![positioned_subtitle()];
    let ass = super::format_ass(&subtitles, 1920, 1080);

    assert!(ass.contains("[Script Info]"));
    assert!(ass.contains("Dialogue:"));
    assert!(ass.contains("\\pos("));
    assert!(ass.contains("Exit"));
}

fn positioned_subtitle() -> OcrSubtitleEntry {
    OcrSubtitleEntry {
        id: "sub-positioned".to_string(),
        text: "Exit".to_string(),
        start_time: 1000,
        end_time: 2500,
        confidence: 0.92,
        role: Some(crate::tools::ocr::OcrZoneRole::OnScreenText),
        region: Some(crate::tools::ocr::OcrRegion {
            x: 0.7,
            y: 0.1,
            width: 0.2,
            height: 0.1,
        }),
        zone_id: Some("zone-sign".to_string()),
    }
}
```

- [ ] **Step 3: Run Rust tests and verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml selection_validation format_ass -- --nocapture
```

Expected: fail because types/function/ASS formatter are missing.

- [ ] **Step 4: Add Rust selection and role types**

In `src-tauri/src/tools/ocr/mod.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum OcrZoneRole {
    MainSubtitle,
    OnScreenText,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrZone {
    pub(crate) id: String,
    pub(crate) region: OcrRegion,
    pub(crate) role: OcrZoneRole,
    pub(crate) label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrSegment {
    pub(crate) id: String,
    pub(crate) start_time_ms: u64,
    pub(crate) end_time_ms: u64,
    pub(crate) zones: Vec<OcrZone>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrSelection {
    pub(crate) segments: Vec<OcrSegment>,
}
```

Extend `OcrFrameResult` and `OcrSubtitleEntry`:

```rust
pub(crate) segment_id: Option<String>,
pub(crate) zone_id: Option<String>,
pub(crate) role: Option<OcrZoneRole>,
pub(crate) region: Option<OcrRegion>,
```

Add validation:

```rust
pub(crate) fn validate_ocr_selection(selection: &OcrSelection, duration_ms: u64) -> Result<(), String> {
    if selection.segments.is_empty() {
        return Err("OCR selection must contain at least one segment".to_string());
    }

    for segment in &selection.segments {
        if segment.start_time_ms >= segment.end_time_ms {
            return Err(format!("Segment {} must start before it ends", segment.id));
        }
        if segment.end_time_ms > duration_ms {
            return Err(format!("Segment {} must stay within the video duration", segment.id));
        }
        if segment.zones.is_empty() {
            return Err(format!("Segment {} must contain at least one OCR zone", segment.id));
        }

        for zone in &segment.zones {
            validate_region(&zone.region)
                .map_err(|message| format!("Zone {} {}", zone.id, message))?;
        }
    }

    Ok(())
}

fn validate_region(region: &OcrRegion) -> Result<(), String> {
    if region.x < 0.0
        || region.y < 0.0
        || region.width < 0.02
        || region.height < 0.02
        || region.x + region.width > 1.0
        || region.y + region.height > 1.0
    {
        return Err("must stay within the video frame and be at least 2% wide/high".to_string());
    }
    Ok(())
}
```

- [ ] **Step 5: Implement ASS export**

In `export.rs`, support `"ass"`:

```rust
"ass" => format_ass(&subtitles, 1920, 1080),
```

Add formatter:

```rust
fn format_ass(subtitles: &[OcrSubtitleEntry], width: u32, height: u32) -> String {
    let mut output = format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {}\nPlayResY: {}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,42,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
        width, height
    );

    for subtitle in subtitles {
        let text = escape_ass_text(&subtitle.text);
        let positioned = subtitle.region.as_ref().map(|region| {
            let x = ((region.x + region.width / 2.0) * width as f64).round() as u32;
            let y = ((region.y + region.height + 0.03).min(0.95) * height as f64).round() as u32;
            format!("{{\\pos({},{})}}{}", x, y, text)
        }).unwrap_or(text);

        output.push_str(&format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
            format_ass_time(subtitle.start_time),
            format_ass_time(subtitle.end_time),
            positioned
        ));
    }

    output
}

fn format_ass_time(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1000;
    let centis = (ms % 1000) / 10;
    format!("{}:{:02}:{:02}.{:02}", hours, minutes, seconds, centis)
}

fn escape_ass_text(text: &str) -> String {
    text.replace('\\', "\\\\").replace('{', "\\{").replace('}', "\\}").replace('\n', "\\N")
}
```

- [ ] **Step 6: Run focused Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml selection_validation format_ass -- --nocapture
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/tools/ocr/mod.rs src-tauri/src/tools/ocr/export.rs
git commit -m "feat: add OCR selection types and ASS export"
```

---

### Task 8: Rust Multi-Zone Pipeline And Live Events

**Files:**
- Modify: `src-tauri/src/tools/ocr/pipeline.rs`
- Modify: `src-tauri/src/tools/ocr/mod.rs`

- [ ] **Step 1: Add active-zone unit tests**

In `pipeline.rs` tests, add:

```rust
#[test]
fn active_zones_for_time_returns_union_from_overlapping_segments() {
    let selection = super::tests::selection_with_overlap();
    let active = super::active_zones_for_time(&selection, 2500);

    assert_eq!(active.len(), 2);
    assert_eq!(active[0].zone.id, "dialogue-zone");
    assert_eq!(active[1].zone.id, "sign-zone");
}

#[test]
fn crop_region_to_image_bounds_scales_relative_region() {
    let rect = super::crop_rect_for_region(
        &crate::tools::ocr::OcrRegion { x: 0.25, y: 0.5, width: 0.5, height: 0.25 },
        1920,
        1080,
    );

    assert_eq!(rect, (480, 540, 960, 270));
}
```

Add helper `selection_with_overlap` in tests.

- [ ] **Step 2: Run tests and verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml active_zones_for_time crop_region_to_image_bounds -- --nocapture
```

Expected: fail due to missing functions.

- [ ] **Step 3: Change command signature**

In `run_ocr_pipeline`, replace:

```rust
region: Option<OcrRegion>,
```

with:

```rust
selection: OcrSelection,
```

Validate:

```rust
let duration_ms = duration_us.map(|us| us / 1000).unwrap_or(1);
validate_ocr_selection(&selection, duration_ms)?;
```

Update `run_ocr_pipeline_with_bins` to accept `selection: OcrSelection`.

- [ ] **Step 4: Extract full frames then crop in memory**

For the first implementation, set output spec to full frame size and remove FFmpeg crop filter. Use `build_ocr_filter_string(fps, None, output_spec)`.

Add helpers:

```rust
struct ActiveZone<'a> {
    segment_id: &'a str,
    zone: &'a OcrZone,
}

fn active_zones_for_time(selection: &OcrSelection, time_ms: u64) -> Vec<ActiveZone<'_>> {
    selection
        .segments
        .iter()
        .filter(|segment| time_ms >= segment.start_time_ms && time_ms < segment.end_time_ms)
        .flat_map(|segment| {
            segment.zones.iter().map(move |zone| ActiveZone {
                segment_id: &segment.id,
                zone,
            })
        })
        .collect()
}

fn crop_rect_for_region(region: &OcrRegion, width: u32, height: u32) -> (u32, u32, u32, u32) {
    let x = (region.x * width as f64).round() as u32;
    let y = (region.y * height as f64).round() as u32;
    let w = (region.width * width as f64).round().max(1.0) as u32;
    let h = (region.height * height as f64).round().max(1.0) as u32;
    (x, y, w.min(width.saturating_sub(x)), h.min(height.saturating_sub(y)))
}
```

Inside `process_streamed_frames`, for each frame:

1. Build a `DynamicImage` from the RGB bytes.
2. Get active zones.
3. For each active zone, crop the image.
4. Run existing OCR recognition on each crop.
5. Build `OcrFrameResult` with `segment_id`, `zone_id`, `role`, and `region`.

- [ ] **Step 5: Emit live detection events**

Add event payload in `mod.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrLiveDetectionEvent {
    pub(crate) file_id: String,
    pub(crate) operation_id: Option<String>,
    pub(crate) detection: OcrFrameResult,
}
```

In pipeline, when a non-empty OCR result is pushed, emit:

```rust
let _ = app.emit("ocr-live-detection", OcrLiveDetectionEvent {
    file_id: file_id.to_string(),
    operation_id: Some(operation_id.to_string()),
    detection: frame_result.clone(),
});
```

Pass `app`/`operation_id` into the processing context. Emit in small batches if per-result events become too chatty; preserve the event shape.

- [ ] **Step 6: Run focused Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml active_zones_for_time crop_region_to_image_bounds -- --nocapture
```

Expected: pass.

- [ ] **Step 7: Run sample pipeline test**

```bash
cargo test --manifest-path src-tauri/Cargo.toml run_ocr_pipeline_returns_results_for_sample_video -- --nocapture
```

Expected: pass. If OCR models are unavailable locally, record the missing-model error and continue to Task 10 broader validation on a machine with models.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/tools/ocr/pipeline.rs src-tauri/src/tools/ocr/mod.rs
git commit -m "feat: process OCR selection zones"
```

---

### Task 9: Role-Aware Subtitle Generation

**Files:**
- Modify: `src-tauri/src/tools/ocr/subtitles.rs`
- Modify: `src-tauri/src/tools/ocr/mod.rs`
- Modify: `src/lib/utils/ocr-subtitle-adapter.ts`
- Modify: `src/lib/types/video-ocr.ts`

- [ ] **Step 1: Add Rust subtitle grouping test**

In `subtitles.rs` tests:

```rust
#[test]
fn generate_subtitles_keeps_roles_and_zones_separate() {
    let frames = vec![
        frame("main-zone", crate::tools::ocr::OcrZoneRole::MainSubtitle, 0, "Hello"),
        frame("sign-zone", crate::tools::ocr::OcrZoneRole::OnScreenText, 0, "Exit"),
        frame("main-zone", crate::tools::ocr::OcrZoneRole::MainSubtitle, 500, "Hello"),
        frame("sign-zone", crate::tools::ocr::OcrZoneRole::OnScreenText, 500, "Exit"),
    ];

    let subtitles = super::generate_subtitles_core(
        &frames,
        2.0,
        0.5,
        OcrSubtitleCleanupOptions::default(),
        |_current, _total| {},
    ).expect("subtitles should generate");

    assert_eq!(subtitles.len(), 2);
    assert!(subtitles.iter().any(|subtitle| subtitle.role == Some(crate::tools::ocr::OcrZoneRole::MainSubtitle)));
    assert!(subtitles.iter().any(|subtitle| subtitle.role == Some(crate::tools::ocr::OcrZoneRole::OnScreenText)));
}
```

Use a local `frame` helper that fills `segment_id`, `zone_id`, `role`, and `region`.

- [ ] **Step 2: Run test and verify it fails**

```bash
cargo test --manifest-path src-tauri/Cargo.toml generate_subtitles_keeps_roles_and_zones_separate -- --nocapture
```

Expected: fail because current generation merges all frames together.

- [ ] **Step 3: Group frames by role and zone**

In `generate_subtitles_core`, partition input frames:

```rust
let mut groups: HashMap<(Option<OcrZoneRole>, Option<String>), Vec<OcrFrameResult>> = HashMap::new();
for frame in frame_results {
    groups
        .entry((frame.role.clone(), frame.zone_id.clone()))
        .or_default()
        .push(frame.clone());
}
```

Run the existing segment generation logic per group, then copy provenance to output subtitles:

```rust
subtitle.role = group_role.clone();
subtitle.zone_id = group_zone_id.clone();
subtitle.region = group_frames.iter().find_map(|frame| frame.region.clone());
```

Sort final subtitles by `start_time`, then by role priority (`main_subtitle` before `on_screen_text`), then by `zone_id`.

- [ ] **Step 4: Update frontend subtitle adapters**

In `src/lib/types/video-ocr.ts`, add optional fields to `OcrSubtitle`:

```ts
role?: OcrZoneRole;
zoneId?: string;
region?: OcrRegion;
```

In `ocr-subtitle-adapter.ts` and normalizers, map Rust `role`, `zoneId`/`zone_id`, and `region`.

- [ ] **Step 5: Run tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml generate_subtitles_keeps_roles_and_zones_separate -- --nocapture
pnpm test -- src/lib/components/video-ocr/video-ocr-processing.test.ts
pnpm check
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/tools/ocr/subtitles.rs src-tauri/src/tools/ocr/mod.rs src/lib/utils/ocr-subtitle-adapter.ts src/lib/types/video-ocr.ts
git commit -m "feat: separate OCR subtitle roles"
```

---

### Task 10: Integration Cleanup And Verification

**Files:**
- Modify: `src/lib/types/video-ocr.ts`
- Modify: `src/lib/stores/video-ocr.svelte.ts`
- Modify: `src/lib/services/ocr-storage.ts`
- Modify: `src/lib/components/video-ocr/VideoPreview.svelte`
- Modify: `src/lib/components/video-ocr/VideoOcrWorkspace.svelte`
- Modify: `src/lib/components/views/VideoOcrView.svelte`
- Modify: `src-tauri/src/tools/ocr/mod.rs`
- Modify: `src-tauri/src/tools/ocr/pipeline.rs`
- Modify: `src-tauri/src/tools/ocr/subtitles.rs`
- Modify: `src-tauri/src/tools/ocr/export.rs`
- Verify: no lingering old `ocrRegion` UI contracts except compatibility-free deletion

- [ ] **Step 1: Search for legacy region API**

Run:

```bash
rg -n "ocrRegion|ocrRegionMode|setGlobalRegion|setFileRegion|onGlobalRegionChange|onFileRegionChange|Use global region|Set OCR Region" src src-tauri
```

Expected: no app code references old UI/store contracts. If references remain in tests for unsupported legacy storage, they must be isolated to that rejection test.

- [ ] **Step 2: Remove old exports and dead code**

Delete old `OcrRegionMode`, global region state, region-mode UI, and storage options. Keep `OcrRegion` because it is still the rectangle type.

- [ ] **Step 3: Run frontend checks**

```bash
pnpm check
pnpm test
```

Expected: pass.

- [ ] **Step 4: Run Rust focused checks**

```bash
cargo test --manifest-path src-tauri/Cargo.toml selection_validation format_ass active_zones_for_time generate_subtitles_keeps_roles_and_zones_separate -- --nocapture
```

Expected: pass.

- [ ] **Step 5: Run broader Rust tests if OCR fixtures/models are available**

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture
```

Expected: pass. If local OCR models or FFmpeg prerequisites are missing, record the exact missing prerequisite and run the filtered tests from Step 4.

- [ ] **Step 6: Run app check manually**

Run:

```bash
pnpm tauri dev
```

Manual smoke flow:

1. Import OCR sample video.
2. Right-click preview and add a main subtitle zone from the current timestamp.
3. Add an overlapping on-screen text zone.
4. Confirm timeline lanes do not overlap visually and scroll when needed.
5. Start OCR.
6. Confirm `Live detections · N` appears as a hovercard trigger without a preview progress badge.
7. Confirm final preview shows main subtitles at bottom and on-screen text near its zone.
8. Confirm export offers ASS only when on-screen text exists.

- [ ] **Step 7: Final commit**

```bash
git add src src-tauri
git commit -m "feat: complete video OCR segment zone workflow"
```

---

## Self-Review Notes

- Spec coverage: UX, clean data model, preview-first context menu, role-based timeline lanes, on-screen text export constraints, live hovercard, shadcn component requirements, validation, and tests are covered.
- Scope: This is one coherent Video OCR refactor. It touches frontend state/UI, persistence, processing payload, Rust pipeline, subtitles, and export. The plan splits it into independently testable tasks.
- Type consistency: Frontend uses `VideoOcrSelection`, `OcrSegment`, `OcrZone`, `OcrZoneRole`, `OcrZoneFrame`. Rust mirrors these as `OcrSelection`, `OcrSegment`, `OcrZone`, `OcrZoneRole`, and extended `OcrFrameResult`.
- Known risk: Task 8 is the highest-risk change because the pipeline moves from FFmpeg crop filter to in-memory per-zone crops. Keep its changes isolated and verify with focused Rust tests before broad integration.
