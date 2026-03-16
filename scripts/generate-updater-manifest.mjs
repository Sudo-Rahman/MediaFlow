#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    throw new Error(`Missing required argument: ${flag}`);
  }

  return process.argv[index + 1];
}

async function main() {
  const version = readArg('--version');
  const pubDate = readArg('--pub-date');
  const notesFile = readArg('--notes-file');
  const signatureFile = readArg('--signature-file');
  const url = readArg('--url');
  const target = readArg('--target');
  const output = readArg('--output');

  const notes = (await readFile(notesFile, 'utf8')).trim() || `Release v${version}`;
  const signature = (await readFile(signatureFile, 'utf8')).trim();

  const manifest = {
    version,
    notes,
    pub_date: new Date(pubDate).toISOString(),
    platforms: {
      [target]: {
        signature,
        url
      }
    }
  };

  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
