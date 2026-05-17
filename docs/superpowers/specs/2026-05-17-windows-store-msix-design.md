# Windows Store MSIX Release Design

## Purpose

MediaFlow currently has a macOS release path that builds, signs, notarizes, publishes GitHub release assets, and generates a Tauri updater manifest. The first Windows distribution path should publish MediaFlow through Microsoft Store as an x64 MSIX package.

This design adds a separate Windows Store release channel without weakening the macOS release channel and without disabling Tauri Updater for every future Windows distribution. Microsoft Store builds must be treated as a distinct distribution flavor because Store updates are managed by Microsoft Store.

## Scope

In scope:

- Windows x64 only.
- Microsoft Store MSIX distribution only.
- A dedicated GitHub Actions workflow for Windows Store releases.
- Private flight publication for validation.
- Production submission behind a GitHub Environment approval gate.
- Minimal Partner Center listing for the first Store release.
- A Microsoft Store link or badge for the website once the public listing exists.
- Tauri configuration split into base and overlays.
- Disable Tauri Updater only for the Microsoft Store distribution flavor.
- Preserve the existing macOS release and updater behavior.

Out of scope:

- Windows ARM64.
- MSI, NSIS, or any other non-Store Windows installer.
- Direct `.msix` download from the website.
- Azure Trusted Signing or another non-Store signing channel.
- Implementation of a future direct Windows distribution channel with Tauri Updater.
- Linux distribution changes.

## Current Project Context

Relevant current state:

- `.github/workflows/bundle-release.yml` builds macOS Apple Silicon and Intel artifacts, notarizes DMGs, publishes GitHub release assets, and generates `latest.json`.
- `.github/workflows/ci-windows.yml` already validates Windows x64 with Rust tests, Vulkan setup, and `pnpm tauri build --no-bundle`.
- `src-tauri/tauri.conf.json` currently contains shared app configuration, updater plugin endpoint configuration, bundle resources, updater artifact generation, icons, and FFmpeg/FFprobe sidecars.
- `src-tauri/src/lib.rs` registers `tauri-plugin-updater` unconditionally.
- `src-tauri/capabilities/default.json` exposes `updater:default` unconditionally.
- `src/lib/stores/updater.svelte.ts` imports and calls `@tauri-apps/plugin-updater` directly.
- `scripts/generate-updater-manifest.mjs` and its tests currently require only macOS updater platforms.
- `src-tauri/ffmpeg_bundle.rs` supports `x86_64-pc-windows-msvc` sidecars through the BtbN `win64-gpl-8.1` build.

## Chosen Approach

Use a dedicated Windows Store workflow instead of folding Store publication into `bundle-release.yml`.

This keeps the two release channels clear:

- macOS release: GitHub Release assets, Apple signing/notarization, Tauri updater manifest.
- Windows Store release: x64 MSIX package, Partner Center flight, production submission.

The workflows can share version metadata from `src-tauri/Cargo.toml`, but they should not share publication steps. Microsoft Store publication has separate identity, flight, certification, and update semantics.

## Tauri Configuration Layout

Split Tauri configuration into base plus overlays.

Target layout:

```text
src-tauri/tauri.conf.json
  Common application configuration:
  product name, identifier baseline, frontend build settings, shared resources,
  icons, external FFmpeg/FFprobe sidecars, common plugins that apply everywhere.

src-tauri/tauri.macos.conf.json
  macOS-specific bundle and updater settings that must remain active for the
  existing macOS release pipeline.

src-tauri/tauri.windows.conf.json
  Windows-common build and bundle settings for x64 validation and future Windows
  variants.

src-tauri/tauri.microsoft-store.conf.json
  Microsoft Store-specific override:
  Store package identity, Store-compatible package metadata, updater disabled,
  and any MSIX-related settings needed by the packaging tooling.
```

Use Tauri config overlays rather than full copied config files. Tauri supports platform config files such as `tauri.windows.conf.json` and additional merge files passed with `tauri build --config`. This keeps shared resources, icons, and sidecars in one place and makes distribution-specific differences explicit.

The Store workflow should build with an explicit overlay:

```bash
pnpm tauri build --target x86_64-pc-windows-msvc --config src-tauri/tauri.microsoft-store.conf.json
```

The implementation must also adjust `.github/workflows/bundle-release.yml` and `.github/workflows/ci-macos.yml` if any macOS settings move out of the base config. macOS build, signing, notarization, and updater manifest generation must continue to work after the config split.

## Microsoft Store Distribution Flavor

Add an explicit Microsoft Store distribution flavor. The key rule is:

```text
Disable updater when distribution == microsoft-store.
Do not disable updater merely because target_os == windows.
```

The distribution flavor is represented in two places:

- A Cargo feature named `microsoft-store` for Rust-side conditional plugin registration and capability selection.
- A Vite environment value named `VITE_MEDIAFLOW_DISTRIBUTION=microsoft-store` for frontend UI and updater behavior.
- Tauri config overlay for Store-specific bundle/config changes.

Rust/Tauri behavior:

- Do not register `tauri-plugin-updater` in Microsoft Store builds.
- Do not expose updater permissions in the Store capability set.
- Keep updater registration intact for macOS.
- Leave room for a future non-Store Windows channel that can use Tauri Updater.

Frontend behavior:

- Do not call `check()` or `downloadAndInstall()` from `@tauri-apps/plugin-updater` in Microsoft Store builds.
- Settings/About should show that updates are managed by Microsoft Store.
- The update dialog and `Check now` action should be unavailable for Microsoft Store builds.
- Non-Tauri browser/dev behavior should keep its existing unsupported handling.

Updater manifest behavior:

- `latest.json` remains macOS-only for this first Windows Store scope.
- Do not add Windows Store platforms to `scripts/generate-updater-manifest.mjs`.
- Keep `pnpm test:updater-manifest` aligned with macOS updater platforms only.

## Windows Store Workflow

Add a dedicated workflow at `.github/workflows/windows-store-release.yml`.

Initial trigger:

```text
workflow_dispatch
```

The first implementation does not add automatic tag-driven production publication. That can be added after several successful Store releases.

Recommended flow:

```text
checkout release commit
read and validate Cargo version
setup pnpm, Node, Rust
setup Windows build dependencies
setup Vulkan SDK as in existing Windows CI
cache FFmpeg sidecars for x86_64-pc-windows-msvc
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:updater-manifest
build frontend
build Tauri x64 with Microsoft Store overlay
package MSIX using WinApp/MSIX tooling
upload package to Partner Center private flight using Microsoft Store tooling
wait for test validation outside CI
promote/submit to production behind GitHub Environment approval
```

The production step uses a GitHub Environment approval. Fully automatic production on tag is a future enhancement, not part of this first implementation.

The workflow must not upload Windows assets to GitHub Releases in this scope. Windows distribution is Store-only.

## Partner Center Bootstrap

Because MediaFlow does not exist in Partner Center yet, the first phase includes manual bootstrap work:

- Reserve or create the MediaFlow app in Partner Center.
- Retrieve the Store package identity and required publisher metadata.
- Prepare privacy and support URLs.
- Create a minimal English Store listing.
- Create or identify a private flight for Windows x64 testing.
- Configure CI credentials for Microsoft Store tooling.

Minimal listing contents:

- Product name: MediaFlow.
- Category: utility/tooling category appropriate for multimedia workflow software.
- Short English description focused on local-first multimedia tooling.
- Required screenshots.
- Support URL.
- Privacy URL.
- Certification notes explaining local FFmpeg/OCR/media-file processing behavior.

The public website should link to the Store listing or official Microsoft Store badge once the app is public. It should not link to a raw `.msix` file in this scope.

## Validation Strategy

Pre-flight validation:

- `pnpm check`
- `pnpm test`
- `pnpm test:updater-manifest`
- Existing Windows x64 Rust test workflow.
- `pnpm tauri build --no-bundle` on Windows x64.
- Store flavor build with `x86_64-pc-windows-msvc`.
- Verify the Microsoft Store build does not call Tauri Updater.
- Verify FFmpeg and FFprobe x64 sidecars are included.

Private flight validation:

- Install from Microsoft Store private flight.
- Launch without a console window.
- Import a media file.
- Run FFprobe inspection.
- Run a short FFmpeg extraction.
- Confirm Settings/About says updates are managed by Microsoft Store.
- Validate OCR model discovery or a clean missing-model message.
- Validate `mediaflow://` deep links if supported by the Store package.
- Validate Store update behavior across two flight versions.

Production validation:

- Production submission requires manual approval at first.
- After approval, Partner Center handles certification and Store signing.
- After public availability, the website can expose the Microsoft Store link or badge.

## Risks

- MSIX Store packaging can impose constraints that differ from Tauri MSI/NSIS behavior, especially around app identity, protocols, sidecars, filesystem access, and app data paths.
- WinApp/MSIX and Microsoft Store Developer CLI may require Partner Center metadata that cannot be inferred from the repository.
- The current updater integration is unconditional across Rust, capabilities, and frontend code. Store builds must avoid both plugin registration and UI calls.
- Splitting Tauri config can break macOS if release workflows are not updated with the config change.
- Store-only Windows release means the website cannot offer a direct Windows download in this scope.
- ARM64 remains intentionally unsupported in this first design.

## References

- Tauri configuration overlays and `--config`: https://v2.tauri.app/develop/configuration-files/
- Tauri configuration reference: https://v2.tauri.app/reference/config/
- Microsoft WinApp CLI Tauri guide: https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri
- Microsoft Store Developer CLI overview: https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/overview
- Microsoft Store product identity details: https://learn.microsoft.com/en-us/windows/apps/publish/view-app-identity-details
- Microsoft Store badges: https://developer.microsoft.com/en-us/store/badges/index.html
