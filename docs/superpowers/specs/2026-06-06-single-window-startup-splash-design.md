# Single-Window Startup Splash Design

## Context

MediaFlow creates its main Tauri webview window immediately and makes it transparent on macOS and Windows. This direct show behavior is intentional: the native window should appear promptly, with the lightweight splash route providing the first branded frontend surface before the full app shell loads. The frontend startup path is heavy because the main route imports and mounts every tool view up front to preserve tool state, progress listeners, and long-running workflow continuity.

The persistent SPA model is intentional. Tool views install Tauri event listeners in `onMount`, expose file-drop handlers through component refs, and keep local runtime state alongside shared rune stores. A naive lazy-loading or mount/unmount navigation change would risk losing progress events, cancellation state, refs, dialogs, and in-flight tool workflow state.

## Decision

Use a single-window startup flow:

1. The Tauri `main` window is created visible.
2. The visible main window loads a lightweight startup splash route.
3. The splash waits for its first paint locally, remains visible for a short minimum duration, then navigates to `/app`.
4. `/app` contains the current full MediaFlow app shell, with all tool views still mounted and hidden with the existing persistence model.

This avoids the perceived pop that can happen with a two-window splashscreen handoff while keeping startup simple and single-window.

## Goals

- Keep the single main window visible immediately at startup.
- Show a lightweight MediaFlow-branded startup surface quickly.
- Preserve the current SPA behavior after the app loads.
- Avoid regressions in long-running workflows, Tauri progress events, drag-and-drop forwarding, export dialogs, and tool-local state.
- Keep the implementation scoped and reversible.

## Non-Goals

- Do not lazy-load or unmount tool views as part of this change.
- Do not move all tool listeners into stores in this first pass.
- Do not introduce a second visible Tauri splash window.
- Do not broaden Tauri capabilities, asset protocol scope, or CSP policy.
- Do not change command APIs used by existing tools.

## Architecture

### Routes

The current root route should be moved to `/app`:

- `src/routes/app/+page.svelte` owns the full existing app shell.
- It keeps the current all-tools-mounted behavior.
- It remains the only place where the heavy tool views are imported.

The new root route should be a startup splash:

- `src/routes/+page.svelte` becomes a small splash component.
- It uses minimal imports and avoids tool stores, tool views, updater initialization, FFmpeg checks, OCR model checks, and auth/session restoration.
- It renders the MediaFlow logo and a lightweight loading animation.
- It navigates to `/app` after the splash has painted and the main window is visible.

If SvelteKit route chunking still makes the splash too coupled to app code, use a static `splashscreen.html` entry loaded by Tauri before navigating the same webview to `/app`.

### Layout Initialization

The root layout must not perform app-heavy initialization that would run on the splash route. Current startup work in the root layout should move behind the `/app` boundary:

- Theme/settings restoration belongs in `src/routes/app/+layout.svelte` or an app startup component.
- MediaFlow session restoration belongs in the app route, not the splash route.
- Model catalog loading belongs in the app route and should stay non-blocking.
- `ModeWatcher` and `Toaster` can remain root-level only if they do not materially increase startup cost; otherwise they move to the app layout.

The splash route may apply a minimal inline/default theme before settings load. Exact persisted theme restoration can happen in `/app`.

### Tauri Window Flow

The main window builder should create the window visible:

- Keep Tauri's default visible window behavior on the existing `WebviewWindowBuilder`.
- Do not switch the main window to `visible(false)` for this splash flow.
- Keep current platform chrome settings, transparency, traffic light placement, Windows custom chrome, and sizing behavior.
- Load the startup splash path first.

The frontend does not need to notify Rust when the splash has painted because the window is already visible. Splash timing remains local to the root route.

### App Readiness

There are two readiness moments:

- Splash readiness: the user can see the controlled startup surface. This is handled by the root route before it navigates to `/app`.
- App readiness: `/app` has mounted the full app shell. This is when the splash can disappear.

The design does not need Rust to wait for splash or full app readiness before showing the window. Showing the native window immediately is preferable to hiding the app until JavaScript is evaluated.

### Tool Persistence

After `/app` loads, MediaFlow keeps its current persistent tool model:

- Tool views remain mounted.
- Hidden tools continue receiving Tauri progress events.
- Drag-and-drop forwarding through view refs continues to work.
- Runtime state in views remains alive while switching tools.
- Existing stores remain module-level rune stores.

No behavior should depend on returning from `/app` to `/`.

## User Experience

The startup splash should feel like the app, not like a separate installer splash:

- Same window size as the current app.
- Transparent or translucent background compatible with the current macOS and Windows chrome.
- Centered MediaFlow logo.
- Subtle shimmer or pulse on the logo.
- Short, non-assertive loading text if needed.

Avoid an overly long or artificial delay. A very short minimum display duration may be used only if immediate navigation causes a visual flicker.

## Error Handling

- If navigation to `/app` fails, the splash should remain visible with a simple failure state rather than leaving a blank transparent window.
- Existing tool-specific errors remain handled inside `/app` after the app shell loads.

## Testing

Validation should cover both frontend and Tauri behavior:

- `pnpm check` after Svelte route/layout changes.
- `pnpm test` if shared services, stores, or routing helpers are changed.
- `cargo test --manifest-path src-tauri/Cargo.toml` if Rust startup behavior changes.
- Manual startup verification on macOS and Windows.
- Visual verification that `/app` replaces the splash without a two-window pop or route flicker.
- Functional smoke test that switching tools after `/app` loads still preserves state.
- Functional smoke test for a progress-event workflow such as extraction, transcode, or OCR while switching tools.

## Risks

- Moving root layout initialization may subtly change when theme, auth, model catalog, or updater state becomes available.
- If the splash imports app-level stores accidentally, it can lose the startup performance benefit.
- If `/app` route creation changes relative paths or assumptions, static adapter behavior must be checked carefully.
- On Windows and macOS, transparent window behavior must be tested directly because WebView first-paint timing can vary by platform.

## Future Work

After this startup fix is stable, MediaFlow can consider a deeper architecture pass:

- Move long-lived Tauri event listeners from views into persistent stores or startup services.
- Keep views focused on rendering and user interaction.
- Lazy-load only UI-heavy views after their listeners and runtime orchestration have been made independent of component mount lifetime.

That future work should be planned tool by tool and is intentionally outside this design.
