#!/usr/bin/env node
// Downloads Midnight's public parameter files for on-device proving (ADR-011)
// into ui/public/zk-params, so the app serves them from its own origin.
//
// Only the sizes a citizen's device proves are fetched: k=13 for revealVote and
// k=15 for castVote. Each file is checked against a pinned SHA-256 and is
// written only when it matches. The files are public and carry no secret.
//
//   node scripts/fetch-zk-params.mjs [target-directory]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The bucket the Midnight proof server and wallet SDK read from. */
export const MIDNIGHT_PARAMS_SOURCE =
  'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';

/** Must equal MIDNIGHT_PARAMS_SHA256 in api/src/passport-v2/device-proving.ts. */
export const MIDNIGHT_PARAMS_SHA256 = Object.freeze({
  13: 'd3324910969c4cc54143b8045b649e5c3a4bd5fb7b8f85fe1b770f640ce1c803',
  15: '724c7c3d779148bb113c7ee9c034b2f27db16e6bdf315fde90105a9bad00b1de',
});

export const paramsFileName = (k) => `bls_midnight_2p${k}`;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function fetchZkParams({ targetDirectory, fetchImpl = fetch, log = console.log }) {
  mkdirSync(targetDirectory, { recursive: true });
  for (const [k, expected] of Object.entries(MIDNIGHT_PARAMS_SHA256)) {
    const name = paramsFileName(k);
    const target = path.join(targetDirectory, name);
    if (existsSync(target) && sha256(readFileSync(target)) === expected) {
      log(`${name}: present and verified`);
      continue;
    }
    const response = await fetchImpl(`${MIDNIGHT_PARAMS_SOURCE}/${name}`);
    if (!response.ok) throw new Error(`${name}: download failed with HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = sha256(bytes);
    if (digest !== expected) {
      throw new Error(`${name}: SHA-256 is ${digest}, expected ${expected}. Nothing was written.`);
    }
    // Written under another name first, so an interrupted run leaves no partial file.
    const partial = `${target}.partial`;
    try {
      writeFileSync(partial, bytes);
      renameSync(partial, target);
    } finally {
      rmSync(partial, { force: true });
    }
    log(`${name}: downloaded and verified (${(bytes.length / 1e6).toFixed(2)} MB)`);
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const targetDirectory = path.resolve(process.argv[2] ?? path.join(root, 'ui/public/zk-params'));
  fetchZkParams({ targetDirectory }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
