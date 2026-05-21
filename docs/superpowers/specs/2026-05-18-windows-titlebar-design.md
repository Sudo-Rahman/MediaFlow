# Windows 11 Custom Titlebar Design

## Context

MediaFlow currently keeps macOS polished by using a Tauri overlay titlebar, native traffic lights, transparency, shadow, and a rounded AppKit mask. Windows still uses the native system titlebar, which does not match the app shell and makes the Windows experience feel less intentional.

This design improves Windows only. macOS and Linux behavior should not regress.

## Goals

- Remove native window decorations on Windows.
- Draw custom Windows window controls in the existing MediaFlow header.
- Keep macOS exactly as it works today with native traffic lights.
- Keep Linux and other platforms on the current native-decoration path.
- Preserve the current minimum window size of `1200x600`.
- Support the native Windows 11 Snap Layout flyout from the custom maximize button.
- Keep all UI text in English.

## Non-Goals

- No custom Snap Layout clone in Svelte.
- No fallback Snap menu for Windows 10.
- No change to the app minimum size for Snap compatibility.
- No broad redesign of the app shell, sidebar, or tool headers.
- No dependency on an external titlebar plugin.

## Platform Behavior

### macOS

macOS remains unchanged:

- Tauri overlay titlebar.
- Native traffic lights.
- Existing traffic light positioning.
- Existing rounded mask logic.
- Existing header offset behavior when the sidebar is closed.

### Windows 11

Windows uses custom chrome:

- The Tauri main window is created with native decorations disabled on Windows.
- The existing app header hosts custom minimize, maximize/restore, and close buttons on the right.
- The header uses drag-region behavior only on neutral header areas.
- Interactive controls are excluded from drag behavior, including the sidebar trigger, update button, tool actions, export button, logs button, and window controls.
- The maximize button reports its rectangle to Rust so the native Windows hit-test can identify it as the maximize caption button.

The app remains usable on Windows without lowering `min_inner_size(1200, 600)`. Because Microsoft recommends smaller minimum widths for full Snap Layout compatibility, some narrow Snap zones may not accept the window. That limitation is accepted.

### Linux And Other Platforms

No intentional behavior change. These platforms keep the current native-decoration path.

## UI Design

Use the selected integrated-header variant:

- Window controls sit at the far right of the current `AppHeader`.
- No dedicated extra caption row is added.
- The controls should visually match Windows 11 caption buttons: compact rectangular hit areas, minimal icon strokes, normal hover states, destructive hover for close.
- The custom controls should not use shadcn `Button` if that creates non-native dimensions or radius. A small dedicated component is acceptable because this is OS chrome, not regular app UI.
- Header platform handling should be explicit rather than scattered. Prefer a simple mode such as:
  - `macos-overlay`
  - `windows-custom`
  - `native`

This keeps `AppHeader` readable and avoids mixing macOS traffic-light spacing with Windows controls.

## Native Snap Layout Contract

Windows 11 Snap Layout support uses the Microsoft-documented Win32 approach for custom titlebars: respond to `WM_NCHITTEST` with `HTMAXBUTTON` when the cursor is inside the custom maximize/restore button.

Reference: https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/apply-snap-layout-menu

Frontend responsibilities:

- Detect Windows with the existing OS utility.
- Render `WindowsWindowControls` only for the Windows custom chrome mode.
- Measure the maximize button with `getBoundingClientRect()`.
- Send the rectangle to Rust after mount and whenever it can change:
  - window resize,
  - header layout changes,
  - sidebar open/closed changes that affect header geometry,
  - maximize/restore state changes,
  - device pixel ratio changes if observed.
- Use Tauri window APIs for minimize, maximize/restore, and close.

Rust responsibilities:

- Keep all Win32 hook code behind Windows-only `cfg` gates.
- Store the current maximize button rectangle for the main window.
- Install a window procedure hook or equivalent Tauri-supported message hook for the main window.
- On `WM_NCHITTEST`, return `HTMAXBUTTON` when the point is inside the stored maximize button rectangle.
- Preserve default handling for resize borders, dragging, minimize, close, and all non-maximize regions.

The implementation should not synthesize or draw a Snap Layout menu. Windows owns the hover delay, flyout rendering, keyboard behavior, and final snap operation.

## Window Shape

Windows should receive a polished frame:

- Native decorations disabled.
- Rounded app frame through the best supported Windows/Tauri path.
- Shadow preserved where possible.
- Web content background should not create square visual corners around the rounded frame.

This should be implemented conservatively and Windows-only. Existing macOS AppKit mask code remains untouched unless a shared abstraction is useful without changing behavior.

## Error Handling

- If updating the maximize button hit-test rectangle fails, log a background diagnostic without showing a user toast.
- The basic maximize/restore click behavior must still work even if Snap Layout hit-testing fails.
- If the Windows hook cannot be installed, return a clear backend error for diagnostics, but do not block app startup unless the failure makes the window unusable.

## Testing

Automated checks:

- Add or update frontend tests for pure platform chrome selection logic if extracted.
- Add Rust unit tests for pure rectangle hit-test logic if isolated from Win32 APIs.
- Run `pnpm check` after Svelte/TypeScript changes.
- Run focused tests if implementation touches services, stores, or Rust helpers.

Manual Windows 11 validation:

- Window has no native titlebar.
- Custom controls appear on the right side of the existing header.
- macOS traffic-light spacing does not appear on Windows.
- Header drag works from neutral header areas.
- Header buttons and tool actions remain clickable.
- Resize borders still work.
- Minimize works.
- Maximize/restore works and icon state updates.
- Close works.
- Native Windows 11 Snap Layout flyout appears when hovering the custom maximize button.
- Selecting Snap zones behaves as expected within the unchanged `1200x600` minimum size constraint.

## Implementation Boundaries

Likely touch points:

- `src-tauri/src/app/mod.rs` for Windows window creation options and Windows-only setup.
- A new Windows chrome component under `src/lib/components/layout/`.
- `src/lib/components/layout/app-header.svelte` for explicit platform chrome handling.
- `src/routes/+page.svelte` for passing the platform chrome mode and preserving OS-specific header spacing.
- A small frontend service or helper for reporting the maximize button rectangle to Rust.
- A Windows-only Rust module for native hit-testing.
- `src-tauri/src/commands/mod.rs` and command registration if the rectangle update is exposed as a Tauri command.
- `src-tauri/capabilities/default.json` only if new frontend window APIs require explicit permissions.

Generated files and companion artifacts under `.superpowers/` must not be committed.
