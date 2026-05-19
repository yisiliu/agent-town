import { zipSync, strToU8 } from 'fflate';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Build a .zip suitable for the uploadTwin action — minimum is a
// card.md entry. Avatar is optional; if supplied, must be a raw PNG.
export function buildTestZip(args: {
  cardMd: string;
  avatarPng?: Uint8Array;
}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'card.md': strToU8(args.cardMd),
  };
  if (args.avatarPng) {
    files['avatar.png'] = args.avatarPng;
  }
  return zipSync(files);
}

// uploadTwin's `zipBase64` arg uses standard base64. Buffer.from with
// node's 'binary' encoding handles the byte-to-string conversion
// without losing data.
export function buildTestZipBase64(args: {
  cardMd: string;
  avatarPng?: Uint8Array;
}): string {
  const bytes = buildTestZip(args);
  return Buffer.from(bytes).toString('base64');
}

// Fixtures live at <repo>/fixtures/cards/<name>.md — load and cache
// per-name so repeated reads in a test file are cheap.
const fixtureCache = new Map<string, string>();

export async function loadFixtureCard(name: string): Promise<string> {
  const cached = fixtureCache.get(name);
  if (cached !== undefined) return cached;
  // import.meta.url is tests/fixtures/buildTestZip.ts; walk up two
  // levels to reach the repo root, then into fixtures/cards/. Lives
  // outside convex/ deliberately — Convex's bundler doesn't accept
  // node:* built-ins (readFile, fileURLToPath) in the V8 runtime, so
  // this helper would error at deploy time if it lived under convex/.
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, '..', '..', 'fixtures', 'cards', `${name}.md`);
  const content = await readFile(path, 'utf8');
  fixtureCache.set(name, content);
  return content;
}
