# Windows 11 Custom Titlebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native Windows titlebar with integrated custom controls while preserving the native Windows 11 Snap Layout flyout on the maximize button.

**Architecture:** macOS keeps the existing native traffic-light overlay. Windows gets `decorations(false)` and a Svelte `WindowsWindowControls` component inside the existing header. The frontend reports the maximize button rectangle to Rust, and a Windows-only Win32 subclass hook returns `HTMAXBUTTON` for that rectangle during `WM_NCHITTEST`.

**Tech Stack:** Svelte 5 runes, TypeScript, Tauri 2 window APIs, Rust 2024, Windows Win32 APIs through the `windows` crate, Vitest, `pnpm check`, Cargo tests.

---

## File Structure

- Modify `.gitignore`: ignore `.superpowers/` brainstorm artifacts.
- Create `src/lib/components/layout/platform-chrome.ts`: pure platform chrome mode selection.
- Create `src/lib/components/layout/platform-chrome.test.ts`: Vitest coverage for platform chrome mode selection.
- Create `src/lib/services/window-chrome.ts`: frontend wrapper for reporting the Windows maximize button rectangle to Rust.
- Create `src/lib/components/layout/WindowsWindowControls.svelte`: Windows-only custom minimize, maximize/restore, and close controls.
- Modify `src/lib/components/layout/app-header.svelte`: accept explicit platform chrome mode and render Windows controls.
- Modify `src/routes/+page.svelte`: derive `platformChrome`, pass it to `AppHeader`, and keep macOS-only header spacing.
- Modify `src-tauri/Cargo.toml`: add direct Windows dependency on the `windows` crate.
- Create `src-tauri/src/tools/window_chrome/mod.rs`: cross-platform Tauri command and shared rectangle conversion/hit-test helpers.
- Create `src-tauri/src/tools/window_chrome/windows.rs`: Windows-only subclass hook, rounded-corner setup, and rectangle state.
- Create `src-tauri/src/tools/window_chrome/non_windows.rs`: non-Windows no-op implementation.
- Modify `src-tauri/src/tools/mod.rs`: expose `window_chrome`.
- Modify `src-tauri/src/commands/mod.rs`: re-export `window_chrome`.
- Modify `src-tauri/src/lib.rs`: register the new Tauri command.
- Modify `src-tauri/src/app/mod.rs`: build the main window without decorations on Windows and install Windows chrome handling.
- Modify `src-tauri/capabilities/default.json`: grant additional window API permissions needed by the custom controls.

---

### Task 1: Ignore Companion Artifacts

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add generated artifact ignore**

Append this line near the existing generated/local agent directories:

```gitignore
.superpowers/
```

- [ ] **Step 2: Verify status**

Run:

```bash
git status --short
```

Expected: no `.superpowers/brainstorm/...` files appear.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore superpowers artifacts"
```

---

### Task 2: Add Platform Chrome Selection

**Files:**
- Create: `src/lib/components/layout/platform-chrome.ts`
- Create: `src/lib/components/layout/platform-chrome.test.ts`

- [ ] **Step 1: Write the failing Vitest coverage**

Create `src/lib/components/layout/platform-chrome.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { getPlatformChrome } from './platform-chrome';

describe('getPlatformChrome', () => {
  it('uses macOS overlay chrome for macOS', () => {
    expect(getPlatformChrome('MacOS')).toBe('macos-overlay');
  });

  it('uses custom chrome for Windows', () => {
    expect(getPlatformChrome('Windows')).toBe('windows-custom');
  });

  it('uses native chrome for Linux and unknown platforms', () => {
    expect(getPlatformChrome('Linux')).toBe('native');
    expect(getPlatformChrome('Unknown')).toBe('native');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm test -- src/lib/components/layout/platform-chrome.test.ts
```

Expected: FAIL because `./platform-chrome` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/components/layout/platform-chrome.ts`:

```ts
import type { OSType } from '$lib/utils';

export type PlatformChrome = 'macos-overlay' | 'windows-custom' | 'native';

export function getPlatformChrome(os: OSType): PlatformChrome {
  if (os === 'MacOS') return 'macos-overlay';
  if (os === 'Windows') return 'windows-custom';
  return 'native';
}
```

- [ ] **Step 4: Run the passing test**

Run:

```bash
pnpm test -- src/lib/components/layout/platform-chrome.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/layout/platform-chrome.ts src/lib/components/layout/platform-chrome.test.ts
git commit -m "feat: select platform window chrome"
```

---

### Task 3: Add Rust Window Chrome Contract

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/tools/window_chrome/mod.rs`
- Create: `src-tauri/src/tools/window_chrome/non_windows.rs`
- Modify: `src-tauri/src/tools/mod.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Windows API dependency**

In `src-tauri/Cargo.toml`, extend `[target.'cfg(target_os = "windows")'.dependencies]`:

```toml
[target.'cfg(target_os = "windows")'.dependencies]
keyring = { version = "^3", features = ["windows-native"] }
windows = { version = "0.61", features = [
  "Win32_Foundation",
  "Win32_Graphics_Dwm",
  "Win32_UI_Controls",
  "Win32_UI_WindowsAndMessaging"
] }
```

- [ ] **Step 2: Add shared command and pure helpers**

Create `src-tauri/src/tools/window_chrome/mod.rs`:

```rust
use serde::Deserialize;

#[cfg(not(target_os = "windows"))]
mod non_windows;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(not(target_os = "windows"))]
use non_windows as platform;
#[cfg(target_os = "windows")]
use windows as platform;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowControlRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PhysicalRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl PhysicalRect {
    pub(crate) fn contains(self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
}

pub(crate) fn to_physical_rect(rect: WindowControlRect) -> Result<PhysicalRect, String> {
    if !rect.x.is_finite()
        || !rect.y.is_finite()
        || !rect.width.is_finite()
        || !rect.height.is_finite()
        || !rect.scale_factor.is_finite()
    {
        return Err("window control rectangle contains a non-finite value".to_string());
    }

    if rect.width <= 0.0 || rect.height <= 0.0 {
        return Err("window control rectangle must have positive dimensions".to_string());
    }

    if rect.scale_factor <= 0.0 {
        return Err("window control rectangle scale factor must be positive".to_string());
    }

    let left = (rect.x * rect.scale_factor).round() as i32;
    let top = (rect.y * rect.scale_factor).round() as i32;
    let right = ((rect.x + rect.width) * rect.scale_factor).round() as i32;
    let bottom = ((rect.y + rect.height) * rect.scale_factor).round() as i32;

    if right <= left || bottom <= top {
        return Err("window control rectangle collapsed after scaling".to_string());
    }

    Ok(PhysicalRect {
        left,
        top,
        right,
        bottom,
    })
}

#[tauri::command]
pub fn update_windows_maximize_button_rect(rect: WindowControlRect) -> Result<(), String> {
    platform::update_maximize_button_rect(to_physical_rect(rect)?)
}

#[cfg(target_os = "windows")]
pub(crate) fn install_windows_chrome(window: &tauri::WebviewWindow) -> Result<(), String> {
    platform::install_windows_chrome(window)
}

#[cfg(test)]
mod tests {
    use super::{to_physical_rect, PhysicalRect, WindowControlRect};

    #[test]
    fn scales_logical_rect_to_physical_rect() {
        let rect = to_physical_rect(WindowControlRect {
            x: 10.0,
            y: 20.0,
            width: 46.0,
            height: 32.0,
            scale_factor: 1.5,
        })
        .expect("rect should scale");

        assert_eq!(
            rect,
            PhysicalRect {
                left: 15,
                top: 30,
                right: 84,
                bottom: 78,
            }
        );
    }

    #[test]
    fn hit_test_uses_half_open_edges() {
        let rect = PhysicalRect {
            left: 10,
            top: 20,
            right: 56,
            bottom: 52,
        };

        assert!(rect.contains(10, 20));
        assert!(rect.contains(55, 51));
        assert!(!rect.contains(56, 51));
        assert!(!rect.contains(55, 52));
    }

    #[test]
    fn rejects_invalid_rectangles() {
        let result = to_physical_rect(WindowControlRect {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 32.0,
            scale_factor: 1.0,
        });

        assert!(result.is_err());
    }
}
```

- [ ] **Step 3: Add non-Windows implementation**

Create `src-tauri/src/tools/window_chrome/non_windows.rs`:

```rust
use super::PhysicalRect;

pub(crate) fn update_maximize_button_rect(_rect: PhysicalRect) -> Result<(), String> {
    Ok(())
}
```

- [ ] **Step 4: Export and register the command**

In `src-tauri/src/tools/mod.rs`, add:

```rust
pub(crate) mod window_chrome;
```

In `src-tauri/src/commands/mod.rs`, add:

```rust
pub(crate) use crate::tools::window_chrome;
```

In `src-tauri/src/lib.rs`, add this to `tauri::generate_handler![...]`:

```rust
commands::window_chrome::update_windows_maximize_button_rect,
```

- [ ] **Step 5: Run Rust helper tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml window_chrome
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/tools/mod.rs src-tauri/src/tools/window_chrome src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add window chrome hit-test contract"
```

---

### Task 4: Add Windows Win32 Hook

**Files:**
- Create: `src-tauri/src/tools/window_chrome/windows.rs`
- Modify: `src-tauri/src/app/mod.rs`

- [ ] **Step 1: Implement Windows-only hook**

Create `src-tauri/src/tools/window_chrome/windows.rs`:

```rust
use std::sync::Mutex;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE};
use windows::Win32::UI::Controls::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{ScreenToClient, HTMAXBUTTON, WM_NCHITTEST};

use super::PhysicalRect;

const MEDIAFLOW_CHROME_SUBCLASS_ID: usize = 1;
const DWMWCP_ROUND: u32 = 2;

static MAXIMIZE_BUTTON_RECT: Mutex<Option<PhysicalRect>> = Mutex::new(None);

pub(crate) fn update_maximize_button_rect(rect: PhysicalRect) -> Result<(), String> {
    let mut stored_rect = MAXIMIZE_BUTTON_RECT
        .lock()
        .map_err(|_| "window chrome state lock poisoned".to_string())?;
    *stored_rect = Some(rect);
    Ok(())
}

pub(crate) fn install_windows_chrome(window: &tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map_err(|e| format!("failed to get Windows window handle: {}", e))?;

    unsafe {
        let subclass_result = SetWindowSubclass(
            hwnd,
            Some(window_chrome_subclass_proc),
            MEDIAFLOW_CHROME_SUBCLASS_ID,
            0,
        );

        if !subclass_result.as_bool() {
            return Err("failed to install Windows chrome subclass".to_string());
        }

        let preference = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const u32 as *const _,
            std::mem::size_of::<u32>() as u32,
        );
    }

    Ok(())
}

unsafe extern "system" fn window_chrome_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    if msg == WM_NCHITTEST {
        let mut point = POINT {
            x: get_x_lparam(lparam),
            y: get_y_lparam(lparam),
        };

        if unsafe { ScreenToClient(hwnd, &mut point).as_bool() } {
            if let Ok(rect) = MAXIMIZE_BUTTON_RECT.lock() {
                if let Some(rect) = *rect {
                    if rect.contains(point.x, point.y) {
                        return LRESULT(HTMAXBUTTON as isize);
                    }
                }
            }
        }
    }

    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

fn get_x_lparam(lparam: LPARAM) -> i32 {
    (lparam.0 as i16) as i32
}

fn get_y_lparam(lparam: LPARAM) -> i32 {
    ((lparam.0 >> 16) as i16) as i32
}
```

- [ ] **Step 2: Build Windows without native decorations**

In `src-tauri/src/app/mod.rs`, add this branch after the macOS build path and before the fallback non-macOS build:

```rust
    #[cfg(target_os = "windows")]
    {
        let window = window
            .decorations(false)
            .shadow(true)
            .transparent(true)
            .build()
            .unwrap();

        if let Err(error) = crate::tools::window_chrome::install_windows_chrome(&window) {
            eprintln!("failed to install Windows window chrome: {}", error);
        }

        return;
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let _window = window.build().unwrap();
```

Keep the existing macOS branch and `configure_macos_window_shape(&window)` call unchanged.

- [ ] **Step 3: Compile-check current platform**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/tools/window_chrome/windows.rs src-tauri/src/app/mod.rs
git commit -m "feat: install windows titlebar hit-test hook"
```

---

### Task 5: Add Frontend Rectangle Reporting Service

**Files:**
- Create: `src/lib/services/window-chrome.ts`

- [ ] **Step 1: Create service**

Create `src/lib/services/window-chrome.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

export interface WindowControlRectPayload {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export function getElementWindowControlRect(element: HTMLElement): WindowControlRectPayload {
  const rect = element.getBoundingClientRect();

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    scaleFactor: window.devicePixelRatio || 1,
  };
}

export async function updateWindowsMaximizeButtonRect(element: HTMLElement): Promise<void> {
  await invoke('update_windows_maximize_button_rect', {
    rect: getElementWindowControlRect(element),
  });
}
```

- [ ] **Step 2: Run frontend check**

Run:

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/services/window-chrome.ts
git commit -m "feat: report window control geometry"
```

---

### Task 6: Add Windows Window Controls Component

**Files:**
- Create: `src/lib/components/layout/WindowsWindowControls.svelte`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add Tauri window permissions**

In `src-tauri/capabilities/default.json`, add:

```json
"core:window:allow-close",
"core:window:allow-is-maximized",
"core:window:allow-minimize",
"core:window:allow-toggle-maximize",
```

Keep the existing `"core:window:allow-start-dragging"` permission.

- [ ] **Step 2: Create `WindowsWindowControls.svelte`**

Create `src/lib/components/layout/WindowsWindowControls.svelte`:

```svelte
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { Copy, Minus, Square, X } from '@lucide/svelte';

  import { updateWindowsMaximizeButtonRect } from '$lib/services/window-chrome';

  let maximizeButton: HTMLButtonElement | undefined = $state();
  let isMaximized = $state(false);
  let resizeObserver: ResizeObserver | undefined;
  let unlistenResize: UnlistenFn | undefined;
  let unlistenScale: UnlistenFn | undefined;

  const appWindow = getCurrentWindow();

  async function refreshMaximizedState(): Promise<void> {
    isMaximized = await appWindow.isMaximized();
  }

  async function reportMaximizeButtonRect(): Promise<void> {
    await tick();
    if (!maximizeButton) return;

    try {
      await updateWindowsMaximizeButtonRect(maximizeButton);
    } catch (error) {
      console.warn('Failed to update Windows maximize button rectangle', error);
    }
  }

  async function handleMinimize(): Promise<void> {
    await appWindow.minimize();
  }

  async function handleToggleMaximize(): Promise<void> {
    await appWindow.toggleMaximize();
    await refreshMaximizedState();
    await reportMaximizeButtonRect();
  }

  async function handleClose(): Promise<void> {
    await appWindow.close();
  }

  onMount(() => {
    void refreshMaximizedState();
    void reportMaximizeButtonRect();

    resizeObserver = new ResizeObserver(() => {
      void reportMaximizeButtonRect();
    });

    if (maximizeButton) resizeObserver.observe(maximizeButton);

    void appWindow.onResized(() => {
      void refreshMaximizedState();
      void reportMaximizeButtonRect();
    }).then((unlisten) => {
      unlistenResize = unlisten;
    });

    void appWindow.onScaleChanged(() => {
      void reportMaximizeButtonRect();
    }).then((unlisten) => {
      unlistenScale = unlisten;
    });

    return () => {
      resizeObserver?.disconnect();
      unlistenResize?.();
      unlistenScale?.();
    };
  });
</script>

<div class="windows-window-controls" aria-label="Window controls">
  <button class="windows-window-control" type="button" aria-label="Minimize" onclick={handleMinimize}>
    <Minus class="size-4" strokeWidth={1.5} />
  </button>

  <button
    bind:this={maximizeButton}
    class="windows-window-control"
    type="button"
    aria-label={isMaximized ? 'Restore' : 'Maximize'}
    title={isMaximized ? 'Restore' : 'Maximize'}
    onclick={handleToggleMaximize}
    onmouseenter={reportMaximizeButtonRect}
    onfocus={reportMaximizeButtonRect}
  >
    {#if isMaximized}
      <Copy class="size-3.5" strokeWidth={1.5} />
    {:else}
      <Square class="size-3.5" strokeWidth={1.5} />
    {/if}
  </button>

  <button class="windows-window-control windows-window-control-close" type="button" aria-label="Close" onclick={handleClose}>
    <X class="size-4" strokeWidth={1.5} />
  </button>
</div>

<style>
  .windows-window-controls {
    display: flex;
    height: 100%;
    min-height: 2.25rem;
    align-self: stretch;
    -webkit-app-region: no-drag;
  }

  .windows-window-control {
    display: grid;
    width: 46px;
    min-width: 46px;
    height: 100%;
    min-height: 2.25rem;
    place-items: center;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--foreground);
    outline: none;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .windows-window-control:hover {
    background: color-mix(in oklch, var(--foreground) 8%, transparent);
  }

  .windows-window-control:focus-visible {
    box-shadow: inset 0 0 0 2px color-mix(in oklch, var(--ring) 55%, transparent);
  }

  .windows-window-control-close:hover {
    background: #c42b1c;
    color: white;
  }
</style>
```

- [ ] **Step 3: Run frontend check**

Run:

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/layout/WindowsWindowControls.svelte src-tauri/capabilities/default.json
git commit -m "feat: add windows window controls"
```

---

### Task 7: Integrate Windows Controls Into The Header

**Files:**
- Modify: `src/lib/components/layout/app-header.svelte`
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Update `AppHeader`**

Replace the script block in `src/lib/components/layout/app-header.svelte` with:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { PlatformChrome } from './platform-chrome';
  import WindowsWindowControls from './WindowsWindowControls.svelte';

  interface AppHeaderProps {
    title: string;
    description?: string;
    platformChrome: PlatformChrome;
    showTitle?: boolean;
    leading?: Snippet;
    titleSuffix?: Snippet;
    status?: Snippet;
    actions?: Snippet;
    trailing?: Snippet;
  }

  let {
    title,
    description,
    platformChrome,
    showTitle = true,
    leading,
    titleSuffix,
    status,
    actions,
    trailing,
  }: AppHeaderProps = $props();

  const usesHeaderDragRegion = $derived(
    platformChrome === 'macos-overlay' || platformChrome === 'windows-custom',
  );
  const usesWindowsControls = $derived(platformChrome === 'windows-custom');
</script>
```

Update the header markup to render snippets in non-drag wrappers and append Windows controls:

```svelte
<header
  class="flex min-h-14 shrink-0 items-center gap-2 border-b px-4 py-2"
  data-tauri-drag-region={usesHeaderDragRegion}
>
  {#if leading}
    <div class="shrink-0">{@render leading()}</div>
  {/if}

  <div class="flex min-w-0 flex-1 items-center gap-2" data-tauri-drag-region={usesHeaderDragRegion}>
    {#if showTitle}
      <div class="min-w-0" data-tauri-drag-region={usesHeaderDragRegion}>
        <h1 data-tauri-drag-region={usesHeaderDragRegion} class="truncate text-lg font-semibold">{title}</h1>
        {#if description}
          <p data-tauri-drag-region={usesHeaderDragRegion} class="truncate text-sm text-muted-foreground">{description}</p>
        {/if}
      </div>
    {/if}

    {#if titleSuffix}
      <div class="shrink-0">{@render titleSuffix()}</div>
    {/if}
  </div>

  {#if status}
    <div class="shrink-0">{@render status()}</div>
  {/if}

  {#if actions}
    <div class="shrink-0">{@render actions()}</div>
  {/if}

  {#if trailing}
    <div class="shrink-0">{@render trailing()}</div>
  {/if}

  {#if usesWindowsControls}
    <WindowsWindowControls />
  {/if}
</header>
```

- [ ] **Step 2: Update `+page.svelte` platform mode**

In `src/routes/+page.svelte`, add:

```ts
import { getPlatformChrome } from '$lib/components/layout/platform-chrome';
```

Replace:

```ts
const isMacOS = OS() === 'MacOS';
```

with:

```ts
const platformChrome = getPlatformChrome(OS());
const isMacOS = platformChrome === 'macos-overlay';
```

Update the `AppHeader` call:

```svelte
<AppHeader
  title={activeHeaderTitle}
  description={activeHeaderDescription}
  showTitle={!sidebarOpen}
  {platformChrome}
>
```

Keep the sidebar trigger class as:

```svelte
<Sidebar.Trigger class="{!sidebarOpen && isMacOS ? 'ml-20' : '-ml-1'} transition-all duration-300" />
```

- [ ] **Step 3: Run frontend checks**

Run:

```bash
pnpm test -- src/lib/components/layout/platform-chrome.test.ts
pnpm check
```

Expected: both commands PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/layout/app-header.svelte src/routes/+page.svelte
git commit -m "feat: integrate windows chrome in header"
```

---

### Task 8: Polish The Transparent Window Frame

**Files:**
- Modify: `src/app.css`
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Add transparent document base**

In `src/app.css`, update the existing base rules so `html` and `body` are transparent while body still owns text color:

```css
@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply text-foreground;
    min-height: 100vh;
    background: transparent;
  }
  html {
    @apply font-sans;
    background: transparent;
  }
}
```

- [ ] **Step 2: Add Windows-only rounded app frame**

In `src/routes/+page.svelte`, wrap the current `Sidebar.Provider` block:

```svelte
<div class={platformChrome === 'windows-custom'
  ? 'h-screen overflow-hidden rounded-[18px] bg-background'
  : 'h-screen overflow-hidden bg-background'}
>
  <Sidebar.Provider bind:open={sidebarOpen}>
    ...
  </Sidebar.Provider>
</div>
```

Move the existing `Sidebar.Provider` content inside that wrapper without changing the internal content structure.

- [ ] **Step 3: Run frontend check**

Run:

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app.css src/routes/+page.svelte
git commit -m "style: polish windows app frame"
```

---

### Task 9: Validate Full Build Surface

**Files:**
- No planned file changes.

- [ ] **Step 1: Run frontend tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run Svelte/TypeScript check**

Run:

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 3: Run Rust helper tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml window_chrome
```

Expected: PASS.

- [ ] **Step 4: Run Rust compile check**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS on the current platform.

- [ ] **Step 5: Run Windows compile validation on Windows 11**

On a Windows 11 machine, run:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
pnpm check
```

Expected: both commands PASS, proving the Windows-only hook compiles.

- [ ] **Step 6: Manual Windows 11 UX validation**

Run the desktop app on Windows 11:

```powershell
pnpm tauri dev
```

Verify:

- The native Windows titlebar is gone.
- Custom window controls appear at the far right of the existing app header.
- No macOS traffic-light spacing appears on Windows.
- Sidebar trigger, update button, tool actions, export button, and logs button remain clickable.
- Dragging neutral header space moves the window.
- Resize borders work.
- Minimize works.
- Maximize/restore works and the icon changes.
- Close works.
- Hovering the maximize/restore button shows the native Windows 11 Snap Layout flyout.
- Narrow Snap zones may be limited by the unchanged `1200x600` minimum window size.

---

## Self-Review

- Spec coverage: Windows-only custom titlebar, macOS unchanged, Linux unchanged, integrated header controls, no Snap fallback, unchanged `1200x600` minimum size, native `HTMAXBUTTON` Snap Layout support, platform-specific header handling, and validation expectations are covered by Tasks 2 through 9.
- Placeholder scan: the plan contains no incomplete markers or intentionally vague implementation steps.
- Type consistency: `PlatformChrome`, `WindowControlRectPayload`, `WindowControlRect`, `PhysicalRect`, `updateWindowsMaximizeButtonRect`, and `update_windows_maximize_button_rect` are defined before use and keep consistent names across tasks.
