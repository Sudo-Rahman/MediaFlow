import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReleaseAssetUrl,
  generateUpdaterManifest,
  platformForUpdaterAsset,
  writeUpdaterManifest,
} from './generate-updater-manifest.mjs';

async function makeAssets() {
  const assetsDir = await mkdtemp(join(tmpdir(), 'mediaflow-updater-'));
  await writeFile(join(assetsDir, 'MediaFlow_1.2.3_macos_arm64.app.tar.gz'), 'arm archive');
  await writeFile(join(assetsDir, 'MediaFlow_1.2.3_macos_arm64.app.tar.gz.sig'), 'arm-signature\n');
  await writeFile(join(assetsDir, 'MediaFlow_1.2.3_macos_intel.app.tar.gz'), 'intel archive');
  await writeFile(join(assetsDir, 'MediaFlow_1.2.3_macos_intel.app.tar.gz.sig'), 'intel-signature\n');
  await writeFile(join(assetsDir, 'MediaFlow_1.2.3_macos_arm64.dmg'), 'ignored');
  return assetsDir;
}

test('platformForUpdaterAsset maps macOS updater archives', () => {
  assert.equal(platformForUpdaterAsset('MediaFlow_1.2.3_macos_arm64.app.tar.gz'), 'darwin-aarch64');
  assert.equal(platformForUpdaterAsset('MediaFlow_1.2.3_macos_intel.app.tar.gz'), 'darwin-x86_64');
  assert.equal(platformForUpdaterAsset('MediaFlow_1.2.3_macos_arm64.dmg'), null);
});

test('buildReleaseAssetUrl encodes tag and asset names', () => {
  assert.equal(
    buildReleaseAssetUrl({
      repository: 'Sudo-Rahman/RsExtractor',
      tagName: 'v1.2.3',
      assetName: 'MediaFlow 1.2.3.app.tar.gz',
    }),
    'https://github.com/Sudo-Rahman/RsExtractor/releases/download/v1.2.3/MediaFlow%201.2.3.app.tar.gz',
  );
});

test('generateUpdaterManifest builds static macOS updater JSON without notes', async () => {
  const assetsDir = await makeAssets();
  const manifest = await generateUpdaterManifest({
    version: '1.2.3',
    pubDate: '2026-05-04T12:00:00.000Z',
    repository: 'Sudo-Rahman/RsExtractor',
    tagName: 'v1.2.3',
    assetsDir,
  });

  assert.deepEqual(manifest, {
    version: '1.2.3',
    pub_date: '2026-05-04T12:00:00.000Z',
    platforms: {
      'darwin-aarch64': {
        url: 'https://github.com/Sudo-Rahman/RsExtractor/releases/download/v1.2.3/MediaFlow_1.2.3_macos_arm64.app.tar.gz',
        signature: 'arm-signature',
      },
      'darwin-x86_64': {
        url: 'https://github.com/Sudo-Rahman/RsExtractor/releases/download/v1.2.3/MediaFlow_1.2.3_macos_intel.app.tar.gz',
        signature: 'intel-signature',
      },
    },
  });
  assert.equal(Object.hasOwn(manifest, 'notes'), false);
});

test('writeUpdaterManifest writes pretty JSON', async () => {
  const assetsDir = await makeAssets();
  const outputPath = join(assetsDir, 'latest.json');

  await writeUpdaterManifest({
    version: '1.2.3',
    pubDate: '2026-05-04T12:00:00.000Z',
    repository: 'Sudo-Rahman/RsExtractor',
    tagName: 'v1.2.3',
    assetsDir,
    outputPath,
  });

  const parsed = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(parsed.platforms['darwin-aarch64'].signature, 'arm-signature');
  assert.equal(Object.hasOwn(parsed, 'notes'), false);
});

test('generateUpdaterManifest fails when required macOS platform is missing', async () => {
  const assetsDir = await mkdtemp(join(tmpdir(), 'mediaflow-updater-missing-'));
  await writeFile(join(assetsDir, 'MediaFlow_1.2.3_macos_arm64.app.tar.gz'), 'arm archive');
  await writeFile(join(assetsDir, 'MediaFlow_1.2.3_macos_arm64.app.tar.gz.sig'), 'arm-signature\n');

  await assert.rejects(
    generateUpdaterManifest({
      version: '1.2.3',
      pubDate: '2026-05-04T12:00:00.000Z',
      repository: 'Sudo-Rahman/RsExtractor',
      tagName: 'v1.2.3',
      assetsDir,
    }),
    /Missing updater platform\(s\): darwin-x86_64/,
  );
});
