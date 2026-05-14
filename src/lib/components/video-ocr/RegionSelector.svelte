<script lang="ts">
  import type { OcrRegion } from '$lib/types/video-ocr';

  interface VideoBounds {
    x: number;      // Left offset (0-1 relative to container)
    y: number;      // Top offset (0-1 relative to container)
    width: number;  // Width (0-1 relative to container)
    height: number; // Height (0-1 relative to container)
  }

  type DragMode = 'none' | 'create' | 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-e' | 'resize-w';

  interface RegionSelectorProps {
    region?: OcrRegion;
    videoBounds?: VideoBounds;
    allowCreate?: boolean;
    onchange?: (region: OcrRegion | undefined) => void;
    oncommit?: (region: OcrRegion) => void;
    oncancel?: () => void;
  }

  let {
    region,
    videoBounds = { x: 0, y: 0, width: 1, height: 1 },
    allowCreate = true,
    onchange,
    oncommit,
    oncancel,
  }: RegionSelectorProps = $props();

  let containerEl = $state<HTMLButtonElement | null>(null);
  let dragMode = $state<DragMode>('none');
  let startPos = $state({ x: 0, y: 0 });
  let startRegion = $state<OcrRegion>({ x: 0, y: 0, width: 0, height: 0 });
  let latestRegion = $state<OcrRegion | undefined>();

  const MIN_SIZE = 0.02; // Minimum region size (2%)

  // Convert container coordinates to video-relative coordinates
  function containerToVideo(containerX: number, containerY: number): { x: number; y: number } {
    // Clamp to video bounds
    const clampedX = Math.max(videoBounds.x, Math.min(videoBounds.x + videoBounds.width, containerX));
    const clampedY = Math.max(videoBounds.y, Math.min(videoBounds.y + videoBounds.height, containerY));
    
    // Convert to video-relative coordinates (0-1 within video)
    const videoX = (clampedX - videoBounds.x) / videoBounds.width;
    const videoY = (clampedY - videoBounds.y) / videoBounds.height;
    
    return { x: videoX, y: videoY };
  }

  function getMousePosition(e: MouseEvent): { containerX: number; containerY: number; videoX: number; videoY: number } {
    if (!containerEl) return { containerX: 0, containerY: 0, videoX: 0, videoY: 0 };
    
    const rect = containerEl.getBoundingClientRect();
    const containerX = (e.clientX - rect.left) / rect.width;
    const containerY = (e.clientY - rect.top) / rect.height;
    const videoPos = containerToVideo(containerX, containerY);
    
    return { containerX, containerY, videoX: videoPos.x, videoY: videoPos.y };
  }

  function isInsideVideoBounds(containerX: number, containerY: number): boolean {
    return containerX >= videoBounds.x && 
           containerX <= videoBounds.x + videoBounds.width &&
           containerY >= videoBounds.y && 
           containerY <= videoBounds.y + videoBounds.height;
  }

  function handleMouseDown(e: MouseEvent) {
    const { containerX, containerY, videoX, videoY } = getMousePosition(e);
    
    // Check if click is within video bounds
    if (!isInsideVideoBounds(containerX, containerY)) {
      oncancel?.();
      return;
    }

    // Check if clicking on existing region for move/resize
    if (region && region.width > 0 && region.height > 0) {
      const handle = getHandleAtPosition(videoX, videoY);
      if (handle !== 'none') {
        dragMode = handle;
        startPos = { x: videoX, y: videoY };
        startRegion = { ...region };
        e.preventDefault();
        return;
      }
      
      // Check if inside region for move
      if (isInsideRegion(videoX, videoY)) {
        dragMode = 'move';
        startPos = { x: videoX, y: videoY };
        startRegion = { ...region };
        e.preventDefault();
        return;
      }
    }

    if (!allowCreate) {
      return;
    }

    // Start creating new region
    dragMode = 'create';
    startPos = { x: videoX, y: videoY };
    startRegion = { x: videoX, y: videoY, width: 0, height: 0 };
    latestRegion = undefined;
  }

  function getHandleAtPosition(x: number, y: number): DragMode {
    if (!region) return 'none';
    
    const handleSize = 0.025; // Handle hit area size
    const { x: rx, y: ry, width: rw, height: rh } = region;
    
    // Corner handles
    if (Math.abs(x - rx) < handleSize && Math.abs(y - ry) < handleSize) return 'resize-nw';
    if (Math.abs(x - (rx + rw)) < handleSize && Math.abs(y - ry) < handleSize) return 'resize-ne';
    if (Math.abs(x - rx) < handleSize && Math.abs(y - (ry + rh)) < handleSize) return 'resize-sw';
    if (Math.abs(x - (rx + rw)) < handleSize && Math.abs(y - (ry + rh)) < handleSize) return 'resize-se';
    
    // Edge handles (only if on the edge)
    if (Math.abs(x - rx) < handleSize && y > ry && y < ry + rh) return 'resize-w';
    if (Math.abs(x - (rx + rw)) < handleSize && y > ry && y < ry + rh) return 'resize-e';
    if (Math.abs(y - ry) < handleSize && x > rx && x < rx + rw) return 'resize-n';
    if (Math.abs(y - (ry + rh)) < handleSize && x > rx && x < rx + rw) return 'resize-s';
    
    return 'none';
  }

  function isInsideRegion(x: number, y: number): boolean {
    if (!region) return false;
    return x >= region.x && x <= region.x + region.width &&
           y >= region.y && y <= region.y + region.height;
  }

  function handleMouseMove(e: MouseEvent) {
    if (dragMode === 'none' || !containerEl) return;
    
    const { videoX, videoY } = getMousePosition(e);
    
    // Clamp to 0-1 range
    const clampedX = Math.max(0, Math.min(1, videoX));
    const clampedY = Math.max(0, Math.min(1, videoY));

    if (dragMode === 'create') {
      // Creating new region
      const x = Math.min(startPos.x, clampedX);
      const y = Math.min(startPos.y, clampedY);
      const width = Math.abs(clampedX - startPos.x);
      const height = Math.abs(clampedY - startPos.y);
      
      if (width > MIN_SIZE && height > MIN_SIZE) {
        emitRegion({ x, y, width, height });
      }
    } else if (dragMode === 'move') {
      // Moving region
      const deltaX = clampedX - startPos.x;
      const deltaY = clampedY - startPos.y;
      
      let newX = startRegion.x + deltaX;
      let newY = startRegion.y + deltaY;
      
      // Clamp to video bounds
      newX = Math.max(0, Math.min(1 - startRegion.width, newX));
      newY = Math.max(0, Math.min(1 - startRegion.height, newY));
      
      emitRegion({
        x: newX, 
        y: newY, 
        width: startRegion.width, 
        height: startRegion.height 
      });
    } else {
      // Resizing
      handleResize(clampedX, clampedY);
    }
  }

  function handleResize(currentX: number, currentY: number) {
    let { x, y, width, height } = startRegion;
    const deltaX = currentX - startPos.x;
    const deltaY = currentY - startPos.y;

    switch (dragMode) {
      case 'resize-se':
        width = Math.max(MIN_SIZE, startRegion.width + deltaX);
        height = Math.max(MIN_SIZE, startRegion.height + deltaY);
        break;
      case 'resize-sw':
        x = Math.min(startRegion.x + startRegion.width - MIN_SIZE, startRegion.x + deltaX);
        width = Math.max(MIN_SIZE, startRegion.width - deltaX);
        height = Math.max(MIN_SIZE, startRegion.height + deltaY);
        break;
      case 'resize-ne':
        y = Math.min(startRegion.y + startRegion.height - MIN_SIZE, startRegion.y + deltaY);
        width = Math.max(MIN_SIZE, startRegion.width + deltaX);
        height = Math.max(MIN_SIZE, startRegion.height - deltaY);
        break;
      case 'resize-nw':
        x = Math.min(startRegion.x + startRegion.width - MIN_SIZE, startRegion.x + deltaX);
        y = Math.min(startRegion.y + startRegion.height - MIN_SIZE, startRegion.y + deltaY);
        width = Math.max(MIN_SIZE, startRegion.width - deltaX);
        height = Math.max(MIN_SIZE, startRegion.height - deltaY);
        break;
      case 'resize-e':
        width = Math.max(MIN_SIZE, startRegion.width + deltaX);
        break;
      case 'resize-w':
        x = Math.min(startRegion.x + startRegion.width - MIN_SIZE, startRegion.x + deltaX);
        width = Math.max(MIN_SIZE, startRegion.width - deltaX);
        break;
      case 'resize-s':
        height = Math.max(MIN_SIZE, startRegion.height + deltaY);
        break;
      case 'resize-n':
        y = Math.min(startRegion.y + startRegion.height - MIN_SIZE, startRegion.y + deltaY);
        height = Math.max(MIN_SIZE, startRegion.height - deltaY);
        break;
    }

    // Clamp to video bounds
    x = Math.max(0, x);
    y = Math.max(0, y);
    width = Math.min(1 - x, width);
    height = Math.min(1 - y, height);

    emitRegion({ x, y, width, height });
  }

  function handleMouseUp() {
    const committedRegion = latestRegion ?? region;
    if (
      dragMode !== 'none'
      && committedRegion
      && committedRegion.width >= MIN_SIZE
      && committedRegion.height >= MIN_SIZE
    ) {
      oncommit?.(committedRegion);
    } else if (dragMode !== 'none') {
      oncancel?.();
    }
    latestRegion = undefined;
    dragMode = 'none';
  }

  function emitRegion(nextRegion: OcrRegion) {
    latestRegion = nextRegion;
    onchange?.(nextRegion);
  }

  function getCursor(): string {
    switch (dragMode) {
      case 'move': return 'grabbing';
      case 'resize-nw':
      case 'resize-se': return 'nwse-resize';
      case 'resize-ne':
      case 'resize-sw': return 'nesw-resize';
      case 'resize-n':
      case 'resize-s': return 'ns-resize';
      case 'resize-e':
      case 'resize-w': return 'ew-resize';
      default: return 'crosshair';
    }
  }
  
  // Convert video-relative region to container coordinates for display
  function regionToContainerStyle(r: OcrRegion): string {
    const left = videoBounds.x * 100 + r.x * videoBounds.width * 100;
    const top = videoBounds.y * 100 + r.y * videoBounds.height * 100;
    const width = r.width * videoBounds.width * 100;
    const height = r.height * videoBounds.height * 100;
    
    return `left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%;`;
  }
</script>

<button
  type="button"
  bind:this={containerEl}
  class="absolute inset-0 border-0 bg-transparent p-0"
  style="cursor: {getCursor()};"
  aria-label="Region selector"
  onmousedown={handleMouseDown}
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
  onmouseleave={handleMouseUp}
>
  <!-- Semi-transparent overlay outside video bounds -->
  <div class="absolute inset-0 bg-black/30 pointer-events-none"></div>
  
  <!-- Region highlight -->
  {#if region && region.width > 0 && region.height > 0}
    <div
      class="absolute border-2 border-primary bg-primary/10"
      style={regionToContainerStyle(region)}
    >
      <!-- Corner handles -->
      <div class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-primary rounded-sm cursor-nwse-resize"></div>
      <div class="absolute -top-1.5 -right-1.5 w-3 h-3 bg-primary rounded-sm cursor-nesw-resize"></div>
      <div class="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-primary rounded-sm cursor-nesw-resize"></div>
      <div class="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-primary rounded-sm cursor-nwse-resize"></div>
      
      <!-- Edge handles -->
      <div class="absolute -top-1 left-1/2 -translate-x-1/2 w-6 h-2 bg-primary rounded-sm cursor-ns-resize"></div>
      <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-2 bg-primary rounded-sm cursor-ns-resize"></div>
      <div class="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-6 bg-primary rounded-sm cursor-ew-resize"></div>
      <div class="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-6 bg-primary rounded-sm cursor-ew-resize"></div>
      
      <!-- Move indicator in center -->
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div class="bg-black/50 text-white text-xs px-2 py-1 rounded opacity-0 hover:opacity-100 transition-opacity">
          Drag to move
        </div>
      </div>
    </div>
  {/if}
  
  <!-- Instructions -->
  <div class="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-3 py-1.5 rounded text-sm pointer-events-none">
    {#if region && region.width > 0}
      Drag region to move, use handles to resize
    {:else if !allowCreate}
      Select an existing zone to edit
    {:else}
      Click and drag to select OCR region
    {/if}
  </div>
</button>
