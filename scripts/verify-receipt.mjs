import { readFile } from 'node:fs/promises';
import { importReceipt, verifyReceiptOpening } from '../polls/dist/index.js';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
try {
  const file = option('--receipt');
  const secretFile = option('--passphrase-file');
  if (!file || !secretFile)
    throw new Error(
      'Usage: node scripts/verify-receipt.mjs --receipt encrypted-receipt.json --passphrase-file private-passphrase.txt [--opening-only]. Keep the passphrase file private.',
    );
  const passphrase = (await readFile(secretFile, 'utf8')).replace(/\r?\n$/, '');
  const receipt = await importReceipt(await readFile(file, 'utf8'), passphrase);
  const openingMatches = await verifyReceiptOpening(receipt);
  console.log(
    JSON.stringify(
      {
        pollId: receipt.opening.pollId,
        commitment: receipt.commitment,
        environment: receipt.environment,
        openingMatches,
        chainConfirmed: false,
        includedInFinalTally: false,
        aggregateProofVerified: false,
        explanation:
          'Local opening verification only. A file is not canonical chain evidence. Chain and aggregate-proof adapters remain unavailable.',
      },
      null,
      2,
    ),
  );
  // The choice and salt are never printed. Full vote verification cannot pass yet.
  process.exitCode = openingMatches && args.includes('--opening-only') ? 0 : 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Receipt verification failed.');
  process.exitCode = 1;
}
