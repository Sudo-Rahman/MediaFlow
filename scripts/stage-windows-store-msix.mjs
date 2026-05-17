import { constants as fsConstants } from 'node:fs';
import { access, cp, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_STAGE_DIR = 'dist/windows-store-msix';
const DEFAULT_TARGET_DIR = 'src-tauri/target/x86_64-pc-windows-msvc/release';
const FALLBACK_TARGET_DIR = 'src-tauri/target/release';
const DEFAULT_PACKAGE_DISPLAY_NAME = 'MediaFlow';
const DEFAULT_PACKAGE_DESCRIPTION = 'Local-first multimedia toolkit.';
const DEFAULT_PACKAGE_EXECUTABLE = 'Mediaflow.exe';
const PACKAGE_ASSETS = [
  'StoreLogo.png',
  'Square150x150Logo.png',
  'Square44x44Logo.png',
];

function requireValue(value, name) {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function optionalValue(value, fallback) {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  return value.trim();
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveFromRoot(rootDir, path) {
  if (isAbsolute(path)) {
    return path;
  }

  return resolve(rootDir, path);
}

function isPathInside(parentDir, childPath) {
  const relativePath = relative(parentDir, childPath);
  return relativePath.length > 0 && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function assertSafeStageDir({ rootDir, targetDir, stageDir }) {
  const distDir = resolve(rootDir, 'dist');

  if (stageDir === parse(stageDir).root) {
    throw new Error(`Unsafe MSIX stage directory: ${stageDir} is the filesystem root`);
  }

  if (stageDir === rootDir) {
    throw new Error(`Unsafe MSIX stage directory: ${stageDir} equals the repository root`);
  }

  if (stageDir === targetDir) {
    throw new Error(`Unsafe MSIX stage directory: ${stageDir} equals the Cargo target directory`);
  }

  if (isPathInside(stageDir, targetDir)) {
    throw new Error(
      `Unsafe MSIX stage directory: ${stageDir} is an ancestor of the Cargo target directory`,
    );
  }

  if (!isPathInside(rootDir, stageDir)) {
    throw new Error(`Unsafe MSIX stage directory: ${stageDir} must be inside ${rootDir}`);
  }

  if (stageDir === distDir) {
    throw new Error(`Unsafe MSIX stage directory: ${stageDir} equals the dist directory`);
  }

  if (!isPathInside(distDir, stageDir)) {
    throw new Error(`Unsafe MSIX stage directory: ${stageDir} must be inside ${distDir}`);
  }
}

function assertSafePackageExecutable(packageExecutable) {
  const invalidWindowsFilenameChars = /[<>:"/\\|?*\x00-\x1f]/;

  if (
    packageExecutable === '.' ||
    packageExecutable === '..' ||
    isAbsolute(packageExecutable) ||
    win32.isAbsolute(packageExecutable) ||
    packageExecutable.includes('/') ||
    packageExecutable.includes('\\') ||
    invalidWindowsFilenameChars.test(packageExecutable) ||
    !packageExecutable.toLowerCase().endsWith('.exe')
  ) {
    throw new Error(
      `Unsafe MSIX package executable: ${packageExecutable} must be a plain .exe filename`,
    );
  }
}

export function toMsixVersion(version) {
  const match = requireValue(version, 'version').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Invalid Cargo package version for MSIX: ${version}`);
  }

  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function readCargoPackageVersion(cargoToml) {
  const match = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  if (!match) {
    throw new Error('Cargo package version is required');
  }

  return match[1];
}

export function renderPackageManifest({
  identityName,
  publisher,
  version,
  publisherDisplayName,
  packageDisplayName,
  packageDescription,
  packageExecutable,
}) {
  const escaped = {
    identityName: escapeXml(identityName),
    publisher: escapeXml(publisher),
    version: escapeXml(version),
    publisherDisplayName: escapeXml(publisherDisplayName),
    packageDisplayName: escapeXml(packageDisplayName),
    packageDescription: escapeXml(packageDescription),
    packageExecutable: escapeXml(packageExecutable),
  };

  return `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:desktop6="http://schemas.microsoft.com/appx/manifest/desktop/windows10/6"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap desktop6 rescap">
  <Identity
    Name="${escaped.identityName}"
    Publisher="${escaped.publisher}"
    Version="${escaped.version}"
    ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>${escaped.packageDisplayName}</DisplayName>
    <PublisherDisplayName>${escaped.publisherDisplayName}</PublisherDisplayName>
    <Description>${escaped.packageDescription}</Description>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop"
      MinVersion="10.0.17763.0"
      MaxVersionTested="10.0.22621.0" />
  </Dependencies>
  <Applications>
    <Application
      Id="MediaFlow"
      Executable="${escaped.packageExecutable}"
      EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="${escaped.packageDisplayName}"
        Description="${escaped.packageDescription}"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png"
        BackgroundColor="transparent" />
      <Extensions>
        <desktop6:Extension Category="windows.fullTrustProcess" Executable="${escaped.packageExecutable}" />
      </Extensions>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`;
}

function readManifestInputs(env) {
  const packageExecutable = optionalValue(
    env.MICROSOFT_STORE_PACKAGE_EXECUTABLE,
    DEFAULT_PACKAGE_EXECUTABLE,
  );
  assertSafePackageExecutable(packageExecutable);

  return {
    identityName: requireValue(
      env.MICROSOFT_STORE_PACKAGE_IDENTITY_NAME,
      'MICROSOFT_STORE_PACKAGE_IDENTITY_NAME',
    ),
    publisher: requireValue(
      env.MICROSOFT_STORE_PACKAGE_IDENTITY_PUBLISHER,
      'MICROSOFT_STORE_PACKAGE_IDENTITY_PUBLISHER',
    ),
    publisherDisplayName: requireValue(
      env.MICROSOFT_STORE_PUBLISHER_DISPLAY_NAME,
      'MICROSOFT_STORE_PUBLISHER_DISPLAY_NAME',
    ),
    packageDisplayName: optionalValue(
      env.MICROSOFT_STORE_PACKAGE_DISPLAY_NAME,
      DEFAULT_PACKAGE_DISPLAY_NAME,
    ),
    packageDescription: optionalValue(
      env.MICROSOFT_STORE_PACKAGE_DESCRIPTION,
      DEFAULT_PACKAGE_DESCRIPTION,
    ),
    packageExecutable,
  };
}

async function resolveTargetDir(rootDir, env) {
  if (env.MICROSOFT_STORE_TARGET_DIR) {
    return resolveFromRoot(rootDir, env.MICROSOFT_STORE_TARGET_DIR);
  }

  const defaultTargetDir = resolve(rootDir, DEFAULT_TARGET_DIR);
  if (await pathExists(defaultTargetDir)) {
    return defaultTargetDir;
  }

  return resolve(rootDir, FALLBACK_TARGET_DIR);
}

async function firstExisting(paths, label) {
  for (const path of paths) {
    if (await pathExists(path)) {
      return path;
    }
  }

  throw new Error(`Unable to locate ${label}. Checked: ${paths.join(', ')}`);
}

async function copySidecar({ targetDir, rootDir, executableName, stageName, stageDir }) {
  const sourcePath = await firstExisting(
    [
      join(targetDir, stageName),
      join(rootDir, 'src-tauri', 'binaries', executableName),
    ],
    stageName,
  );

  await copyFile(sourcePath, join(stageDir, stageName));
}

async function copyPackageAssets(rootDir, stageDir) {
  const assetsDir = join(stageDir, 'Assets');
  await mkdir(assetsDir, { recursive: true });

  for (const assetName of PACKAGE_ASSETS) {
    await copyFile(
      join(rootDir, 'src-tauri', 'icons', assetName),
      join(assetsDir, assetName),
    );
  }
}

export async function stageWindowsStoreMsix({ rootDir = process.cwd(), env = process.env } = {}) {
  const absoluteRootDir = resolve(rootDir);
  const manifestInputs = readManifestInputs(env);
  const cargoTomlPath = join(absoluteRootDir, 'src-tauri', 'Cargo.toml');
  const cargoVersion = readCargoPackageVersion(await readFile(cargoTomlPath, 'utf8'));
  const version = toMsixVersion(cargoVersion);
  const targetDir = await resolveTargetDir(absoluteRootDir, env);
  const stageDir = resolveFromRoot(
    absoluteRootDir,
    optionalValue(env.MICROSOFT_STORE_MSIX_STAGE_DIR, DEFAULT_STAGE_DIR),
  );
  assertSafeStageDir({ rootDir: absoluteRootDir, targetDir, stageDir });
  const executablePath = await firstExisting(
    [join(targetDir, manifestInputs.packageExecutable)],
    manifestInputs.packageExecutable,
  );

  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  await copyFile(executablePath, join(stageDir, manifestInputs.packageExecutable));
  await copySidecar({
    targetDir,
    rootDir: absoluteRootDir,
    executableName: 'ffmpeg-x86_64-pc-windows-msvc.exe',
    stageName: 'ffmpeg.exe',
    stageDir,
  });
  await copySidecar({
    targetDir,
    rootDir: absoluteRootDir,
    executableName: 'ffprobe-x86_64-pc-windows-msvc.exe',
    stageName: 'ffprobe.exe',
    stageDir,
  });

  const ocrModelsDir = join(absoluteRootDir, 'src-tauri', 'ocr-models');
  if (await pathExists(ocrModelsDir)) {
    await cp(ocrModelsDir, join(stageDir, 'ocr-models'), { recursive: true });
  }
  await copyPackageAssets(absoluteRootDir, stageDir);

  const manifest = renderPackageManifest({
    ...manifestInputs,
    version,
  });
  await writeFile(join(stageDir, 'Package.appxmanifest'), manifest);

  return {
    stageDir,
    targetDir,
    version,
  };
}

async function appendGitHubOutput(outputPath, stageDir) {
  if (!outputPath) {
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `msix_stage_dir=${stageDir}\n`, { flag: 'a' });
}

async function main() {
  const result = await stageWindowsStoreMsix();
  console.log(`MSIX_STAGE_DIR=${result.stageDir}`);
  await appendGitHubOutput(process.env.GITHUB_OUTPUT, result.stageDir);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
