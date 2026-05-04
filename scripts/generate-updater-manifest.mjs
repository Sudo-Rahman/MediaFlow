import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MACOS_PLATFORM_BY_SUFFIX = {
  arm64: 'darwin-aarch64',
  intel: 'darwin-x86_64',
};

function requireValue(value, name) {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function encodeAssetName(assetName) {
  return assetName
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function buildReleaseAssetUrl({ repository, tagName, assetName }) {
  const repo = requireValue(repository, 'repository');
  const tag = requireValue(tagName, 'tagName');
  const asset = requireValue(assetName, 'assetName');

  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeAssetName(asset)}`;
}

export function platformForUpdaterAsset(assetName) {
  const match = assetName.match(/_macos_(arm64|intel)\.app\.tar\.gz$/);
  if (!match) {
    return null;
  }

  return MACOS_PLATFORM_BY_SUFFIX[match[1]];
}

export async function collectUpdaterPlatforms({ assetsDir, repository, tagName }) {
  const entries = await readdir(assetsDir);
  const archiveNames = entries
    .filter((entry) => entry.endsWith('.app.tar.gz'))
    .sort();
  const platforms = {};

  for (const archiveName of archiveNames) {
    const platform = platformForUpdaterAsset(archiveName);
    if (!platform) {
      continue;
    }

    const signaturePath = join(assetsDir, `${archiveName}.sig`);
    const signature = (await readFile(signaturePath, 'utf8')).trim();
    if (signature.length === 0) {
      throw new Error(`Updater signature is empty: ${signaturePath}`);
    }

    platforms[platform] = {
      url: buildReleaseAssetUrl({ repository, tagName, assetName: archiveName }),
      signature,
    };
  }

  return platforms;
}

export function validateUpdaterPlatforms(platforms) {
  const required = ['darwin-aarch64', 'darwin-x86_64'];
  const missing = required.filter((platform) => !platforms[platform]);

  if (missing.length > 0) {
    throw new Error(`Missing updater platform(s): ${missing.join(', ')}`);
  }
}

export async function generateUpdaterManifest({
  version,
  pubDate,
  repository,
  tagName,
  assetsDir,
}) {
  const manifest = {
    version: requireValue(version, 'version'),
    pub_date: requireValue(pubDate, 'pubDate'),
    platforms: await collectUpdaterPlatforms({ assetsDir, repository, tagName }),
  };

  validateUpdaterPlatforms(manifest.platforms);

  return manifest;
}

export async function writeUpdaterManifest({
  version,
  pubDate,
  repository,
  tagName,
  assetsDir,
  outputPath,
}) {
  const manifest = await generateUpdaterManifest({
    version,
    pubDate,
    repository,
    tagName,
    assetsDir,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

async function main() {
  const assetsDir = process.env.RELEASE_ASSETS_DIR ?? 'release-assets';
  const outputPath = process.env.UPDATER_MANIFEST_PATH ?? join(assetsDir, 'latest.json');

  const manifest = await writeUpdaterManifest({
    version: process.env.APP_VERSION,
    pubDate: process.env.PUB_DATE ?? new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY,
    tagName: process.env.TAG_NAME,
    assetsDir,
    outputPath,
  });

  console.log(`Generated ${outputPath}`);
  console.log(`Platforms: ${Object.keys(manifest.platforms).join(', ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
