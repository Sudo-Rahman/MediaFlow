import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderPackageManifest,
  stageWindowsStoreMsix,
  toMsixVersion,
} from './stage-windows-store-msix.mjs';

const manifestInputs = {
  identityName: 'Publisher.PackageName',
  publisher: 'CN=Publisher',
  version: '1.2.3.0',
  publisherDisplayName: 'Publisher',
  packageDisplayName: 'MediaFlow',
  packageDescription: 'Local-first multimedia toolkit.',
  packageExecutable: 'Mediaflow.exe',
};

test('toMsixVersion converts semver to a four-part MSIX version', () => {
  assert.equal(toMsixVersion('1.2.3'), '1.2.3.0');
  assert.equal(toMsixVersion('1.2.3-beta.1'), '1.2.3.0');
});

test('renderPackageManifest includes Store identity fields', () => {
  const manifest = renderPackageManifest(manifestInputs);

  assert.match(manifest, /Name="Publisher.PackageName"/);
  assert.match(manifest, /Publisher="CN=Publisher"/);
});

test('renderPackageManifest escapes XML attribute values', () => {
  const manifest = renderPackageManifest({
    ...manifestInputs,
    identityName: 'Publisher.Package&Name',
    publisher: 'CN=Publisher "A&B"',
    publisherDisplayName: 'Publisher <Display>',
    packageDisplayName: 'MediaFlow "Store"',
    packageDescription: "Local-first 'multimedia' & toolkit.",
  });

  assert.match(manifest, /Name="Publisher.Package&amp;Name"/);
  assert.match(manifest, /Publisher="CN=Publisher &quot;A&amp;B&quot;"/);
  assert.match(manifest, /PublisherDisplayName>Publisher &lt;Display&gt;<\/PublisherDisplayName>/);
  assert.match(manifest, /DisplayName="MediaFlow &quot;Store&quot;"/);
  assert.match(manifest, /Description="Local-first &apos;multimedia&apos; &amp; toolkit\."/);
});

test('stageWindowsStoreMsix copies release outputs, sidecars, OCR models, and manifest', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'mediaflow-msix-'));
  const targetDir = join(rootDir, 'src-tauri', 'target', 'release');
  const binariesDir = join(rootDir, 'src-tauri', 'binaries');
  const iconsDir = join(rootDir, 'src-tauri', 'icons');
  const ocrModelsDir = join(rootDir, 'src-tauri', 'ocr-models');
  const stageDir = join(rootDir, 'dist', 'windows-store-msix');

  await mkdir(targetDir, { recursive: true });
  await mkdir(binariesDir, { recursive: true });
  await mkdir(iconsDir, { recursive: true });
  await mkdir(ocrModelsDir, { recursive: true });
  await writeFile(join(rootDir, 'src-tauri', 'Cargo.toml'), [
    '[package]',
    'name = "Mediaflow"',
    'version = "2.3.4-beta.1"',
  ].join('\n'));
  await writeFile(join(targetDir, 'Mediaflow.exe'), 'app');
  await writeFile(join(binariesDir, 'ffmpeg-x86_64-pc-windows-msvc.exe'), 'ffmpeg');
  await writeFile(join(binariesDir, 'ffprobe-x86_64-pc-windows-msvc.exe'), 'ffprobe');
  await writeFile(join(iconsDir, 'StoreLogo.png'), 'store logo');
  await writeFile(join(iconsDir, 'Square150x150Logo.png'), '150 logo');
  await writeFile(join(iconsDir, 'Square44x44Logo.png'), '44 logo');
  await writeFile(join(ocrModelsDir, 'model.bin'), 'model');

  const result = await stageWindowsStoreMsix({
    rootDir,
    env: {
      MICROSOFT_STORE_PACKAGE_IDENTITY_NAME: 'Publisher.PackageName',
      MICROSOFT_STORE_PACKAGE_IDENTITY_PUBLISHER: 'CN=Publisher',
      MICROSOFT_STORE_PUBLISHER_DISPLAY_NAME: 'Publisher',
      MICROSOFT_STORE_MSIX_STAGE_DIR: stageDir,
      MICROSOFT_STORE_TARGET_DIR: targetDir,
    },
  });

  assert.equal(result.version, '2.3.4.0');
  assert.equal(await readFile(join(stageDir, 'Mediaflow.exe'), 'utf8'), 'app');
  assert.equal(await readFile(join(stageDir, 'ffmpeg.exe'), 'utf8'), 'ffmpeg');
  assert.equal(await readFile(join(stageDir, 'ffprobe.exe'), 'utf8'), 'ffprobe');
  assert.equal(await readFile(join(stageDir, 'Assets', 'StoreLogo.png'), 'utf8'), 'store logo');
  assert.equal(await readFile(join(stageDir, 'Assets', 'Square150x150Logo.png'), 'utf8'), '150 logo');
  assert.equal(await readFile(join(stageDir, 'Assets', 'Square44x44Logo.png'), 'utf8'), '44 logo');
  assert.equal(await readFile(join(stageDir, 'ocr-models', 'model.bin'), 'utf8'), 'model');
  assert.match(await readFile(join(stageDir, 'Package.appxmanifest'), 'utf8'), /Version="2.3.4.0"/);
  assert.equal((await stat(result.stageDir)).isDirectory(), true);
});
