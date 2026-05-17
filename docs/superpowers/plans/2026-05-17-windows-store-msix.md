# Windows Store MSIX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows x64 Microsoft Store release path that disables Tauri Updater only for the Store flavor, packages a complete MSIX staging directory, and publishes to a private Store flight from GitHub Actions.

**Architecture:** Keep the existing macOS GitHub Release/updater channel intact. Add an explicit `microsoft-store` distribution flavor across frontend, Rust, Tauri config, capabilities, and CI. Package Store builds from a staged directory containing the Tauri executable, FFmpeg/FFprobe sidecars, and OCR resources, then publish to Partner Center with `msstore`.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Tauri 2, Rust 2024, GitHub Actions, Microsoft WinApp CLI, Microsoft Store Developer CLI.

---

## File Structure

- `docs/superpowers/specs/2026-05-17-windows-store-msix-design.md`: committed design spec.
- `docs/superpowers/plans/2026-05-17-windows-store-msix.md`: this implementation plan.
- `src/lib/services/distribution.ts`: normalized frontend distribution flavor helpers.
- `src/lib/services/distribution.test.ts`: Vitest coverage for distribution normalization and update labels.
- `src/lib/stores/updater.svelte.ts`: Store-aware updater state and lazy updater plugin import.
- `src/lib/components/views/SettingsView.svelte`: Microsoft Store update text and hidden updater actions.
- `src-tauri/Cargo.toml`: `microsoft-store` feature.
- `src-tauri/src/lib.rs`: conditional updater plugin registration.
- `src-tauri/capabilities/default.json`: shared permissions without updater.
- `src-tauri/capabilities/updater.json`: updater permission isolated for non-Store builds.
- `src-tauri/tauri.conf.json`: base config explicitly enables default + updater capabilities.
- `src-tauri/tauri.macos.conf.json`: macOS overlay preserving updater artifacts.
- `src-tauri/tauri.windows.conf.json`: Windows-common overlay.
- `src-tauri/tauri.microsoft-store.conf.json`: Store overlay disabling updater config and updater capability.
- `scripts/stage-windows-store-msix.mjs`: creates Store staging directory and Package.appxmanifest from GitHub variables.
- `scripts/stage-windows-store-msix.node-test.mjs`: validates version mapping and manifest generation.
- `package.json`: adds a script for the staging tests.
- `.github/workflows/windows-store-release.yml`: manual Windows Store private-flight workflow.

## Task 1: Commit Spec And Plan Baseline

**Files:**
- Add: `docs/superpowers/specs/2026-05-17-windows-store-msix-design.md`
- Add: `docs/superpowers/plans/2026-05-17-windows-store-msix.md`

- [ ] **Step 1: Verify branch and staged files**

Run: `git branch --show-current && git status --short`
Expected: branch is `codex/windows-store-msix-release`; spec and plan are changed.

- [ ] **Step 2: Commit baseline docs**

Run:

```bash
git add docs/superpowers/specs/2026-05-17-windows-store-msix-design.md docs/superpowers/plans/2026-05-17-windows-store-msix.md
git commit -m "Add Windows Store MSIX release plan"
```

Expected: commit succeeds with only docs.

## Task 2: Add Frontend Distribution Flavor

**Files:**
- Create: `src/lib/services/distribution.ts`
- Create: `src/lib/services/distribution.test.ts`
- Modify: `src/lib/services/index.ts`

- [ ] **Step 1: Write distribution helper tests**

Create tests covering:

```ts
expect(normalizeMediaFlowDistribution('microsoft-store')).toBe('microsoft-store');
expect(normalizeMediaFlowDistribution(undefined)).toBe('standard');
expect(isMicrosoftStoreDistribution('microsoft-store')).toBe(true);
expect(getUpdateManagementLabel('microsoft-store')).toBe('Updates are managed by Microsoft Store');
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- src/lib/services/distribution.test.ts`
Expected: fail because `distribution.ts` does not exist.

- [ ] **Step 3: Implement `distribution.ts`**

Implement:

```ts
export type MediaFlowDistribution = 'standard' | 'microsoft-store';
export const MEDIAFLOW_DISTRIBUTION = normalizeMediaFlowDistribution(import.meta.env.VITE_MEDIAFLOW_DISTRIBUTION);
export function normalizeMediaFlowDistribution(value: unknown): MediaFlowDistribution { ... }
export function isMicrosoftStoreDistribution(distribution = MEDIAFLOW_DISTRIBUTION): boolean { ... }
export function getUpdateManagementLabel(distribution = MEDIAFLOW_DISTRIBUTION): string { ... }
```

- [ ] **Step 4: Export helper and rerun test**

Run: `pnpm test -- src/lib/services/distribution.test.ts`
Expected: pass.

## Task 3: Make Updater UI Store-Aware

**Files:**
- Modify: `src/lib/stores/updater.svelte.ts`
- Modify: `src/lib/components/views/SettingsView.svelte`

- [ ] **Step 1: Add Store-managed updater state**

Add `managed-by-store` to `UpdaterStatus`. Import `getUpdateManagementLabel` and `isMicrosoftStoreDistribution`.

- [ ] **Step 2: Prevent updater plugin calls for Store builds**

Change static updater import to type-only imports and lazy runtime import:

```ts
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';

async function loadUpdaterPlugin(): Promise<typeof import('@tauri-apps/plugin-updater')> {
  return import('@tauri-apps/plugin-updater');
}
```

Use `loadUpdaterPlugin()` only after checking `!isMicrosoftStoreDistribution()`.

- [ ] **Step 3: Update manual check behavior**

For Store builds, `initialize()` and `checkForUpdates()` set status to `managed-by-store`; manual checks show an info toast with `Updates are managed by Microsoft Store`.

- [ ] **Step 4: Update Settings UI**

`formatUpdateStatus()` returns the Store label for `managed-by-store`. Hide `Check now` and `View update` when `updaterStore.isManagedByStore` is true. Show `Last check` only when the updater is not Store-managed.

- [ ] **Step 5: Validate frontend**

Run:

```bash
pnpm check
pnpm test
```

Expected: both pass.

## Task 4: Split Tauri Updater Capability And Config

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Create: `src-tauri/capabilities/updater.json`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/tauri.macos.conf.json`
- Create: `src-tauri/tauri.windows.conf.json`
- Create: `src-tauri/tauri.microsoft-store.conf.json`

- [ ] **Step 1: Add Cargo feature**

Add:

```toml
[features]
default = []
microsoft-store = []
```

- [ ] **Step 2: Isolate updater capability**

Remove `"updater:default"` from `default.json`. Create `updater.json` with identifier `updater` and permission `"updater:default"` for window `main`.

- [ ] **Step 3: Explicitly enable capabilities in base config**

Add `app.security.capabilities` in `tauri.conf.json`:

```json
"capabilities": ["default", "updater"]
```

- [ ] **Step 4: Add Store overlay**

Create `tauri.microsoft-store.conf.json` overriding:

```json
{
  "app": { "security": { "capabilities": ["default"] } },
  "plugins": { "updater": null },
  "bundle": { "createUpdaterArtifacts": false }
}
```

- [ ] **Step 5: Gate updater plugin in Rust**

In `src-tauri/src/lib.rs`, register `tauri_plugin_updater` only when `not(feature = "microsoft-store")`.

- [ ] **Step 6: Validate Rust and Tauri**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --features microsoft-store
pnpm tauri build --no-bundle
```

Expected: all pass locally for the host target.

## Task 5: Add MSIX Staging Script

**Files:**
- Create: `scripts/stage-windows-store-msix.mjs`
- Create: `scripts/stage-windows-store-msix.node-test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write script tests**

Cover:

```js
assert.equal(toMsixVersion('1.2.3'), '1.2.3.0');
assert.equal(toMsixVersion('1.2.3-beta.1'), '1.2.3.0');
assert.match(renderPackageManifest(inputs), /Name="Publisher.PackageName"/);
assert.match(renderPackageManifest(inputs), /Publisher="CN=..."/);
```

- [ ] **Step 2: Implement script**

The script must:

- Read `src-tauri/Cargo.toml` version.
- Convert it to four-part MSIX version.
- Require env vars for Store identity.
- Locate target release exe, FFmpeg, and FFprobe.
- Copy them to `dist/windows-store-msix/`.
- Copy `src-tauri/ocr-models` into the staging dir.
- Render `Package.appxmanifest`.
- Print `MSIX_STAGE_DIR=...` for GitHub Actions.

- [ ] **Step 3: Add package script and validate**

Add:

```json
"test:windows-store-msix": "node --test scripts/stage-windows-store-msix.node-test.mjs"
```

Run: `pnpm test:windows-store-msix`
Expected: pass.

## Task 6: Add Windows Store Release Workflow

**Files:**
- Create: `.github/workflows/windows-store-release.yml`

- [ ] **Step 1: Add manual workflow inputs**

Inputs:

- `flight_id`
- `publish_flight`
- `poll_flight`

Use repository variables:

- `MICROSOFT_STORE_PRODUCT_ID`
- `MICROSOFT_STORE_PACKAGE_IDENTITY_NAME`
- `MICROSOFT_STORE_PACKAGE_IDENTITY_PUBLISHER`
- `MICROSOFT_STORE_PUBLISHER_DISPLAY_NAME`

- [ ] **Step 2: Build Store flavor**

Run Windows x64 build with:

```powershell
$env:VITE_MEDIAFLOW_DISTRIBUTION = "microsoft-store"
pnpm tauri build --no-bundle --target x86_64-pc-windows-msvc --features microsoft-store --config src-tauri/tauri.microsoft-store.conf.json
```

- [ ] **Step 3: Stage and pack MSIX**

Run:

```powershell
node scripts/stage-windows-store-msix.mjs
winapp pack dist\windows-store-msix
```

- [ ] **Step 4: Configure Store CLI and publish flight**

Use Microsoft official action and CLI:

```yaml
- uses: microsoft/microsoft-store-apppublisher@v1.1
- run: msstore reconfigure ...
- run: msstore publish '<msix path>' -id '${{ vars.MICROSOFT_STORE_PRODUCT_ID }}'
```

For private flights, keep `msstore flights submission` commands documented but initially make flight publication opt-in through `publish_flight`.

- [ ] **Step 5: Upload MSIX artifact**

Upload the generated `.msix` as a workflow artifact for inspection.

## Task 7: Validate, Commit, Push, PR, CI

**Files:**
- All changed files.

- [ ] **Step 1: Run full local validation**

Run:

```bash
pnpm check
pnpm test
pnpm test:updater-manifest
pnpm test:windows-store-msix
cargo check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --features microsoft-store
```

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add .
git commit -m "Add Windows Store MSIX release pipeline"
```

- [ ] **Step 3: Push and open PR**

Run:

```bash
git push -u origin codex/windows-store-msix-release
gh pr create --draft --title "Add Windows Store MSIX release pipeline" --body-file <generated-pr-body>
```

- [ ] **Step 4: Watch CI**

Run:

```bash
gh pr checks --watch
```

Fix failures with focused commits until required checks pass or a platform/external credential blocker is confirmed.

