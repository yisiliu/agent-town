'use node';

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { unzipSync, strFromU8 } from 'fflate';
import { validateCard } from '../lib/cardValidator';
import { generateUploadSessionToken } from '../lib/uploadResultsStore';

const MAX_ZIP_BYTES = 5 * 1024 * 1024; // 5 MB upload ceiling (cards
// are <5KB; avatar.png maybe <500KB; anything past 5MB is out-of-spec)

// Spec §4.9 sync upload stage: schema validation + avatar re-encode +
// pending_scan write + scheduled async scans. Returns an
// uploadSessionToken the UI polls via uploadResultByToken.byToken.
//
// Node action because:
//   - fflate's unzipSync is fine in either runtime, but
//   - sharp re-encoding (when an avatar is present) needs native libvips
//   - Convex Node actions support both
export default action({
  args: {
    zipBase64: v.string(),
  },
  handler: async (ctx, { zipBase64 }) => {
    const zipBytes = decodeBase64(zipBase64);
    if (zipBytes.byteLength > MAX_ZIP_BYTES) {
      throw new Error(
        `uploadTwin: zip exceeds ${MAX_ZIP_BYTES} byte ceiling`,
      );
    }

    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(zipBytes);
    } catch (err) {
      throw new Error(`uploadTwin: invalid zip — ${(err as Error).message}`);
    }

    const cardBytes = files['card.md'];
    if (!cardBytes) {
      throw new Error('uploadTwin: zip is missing card.md');
    }
    const cardText = strFromU8(cardBytes);
    const validation = validateCard(cardText);
    if (!validation.ok) {
      throw new Error(
        `uploadTwin: card.md failed validation — ${JSON.stringify(validation.errors).slice(0, 500)}`,
      );
    }

    // Optional avatar — present in most uploads, absent in tests / dev.
    let avatarStorageId: string | undefined;
    const avatarBytes = files['avatar.png'];
    if (avatarBytes && avatarBytes.byteLength > 0) {
      // Dynamic import keeps the native lib out of the cold-start path
      // when no avatar is supplied (tests, schema-only smoke uploads).
      const sharpModule = await import('sharp');
      const sharp = (sharpModule.default ?? sharpModule) as typeof import('sharp');
      const reEncoded = await sharp(avatarBytes)
        .resize({ width: 512, height: 512, fit: 'cover' })
        .png({ effort: 1 })
        .toBuffer();
      // sharp returns a Node Buffer whose .buffer is ArrayBufferLike;
      // copy into a fresh Uint8Array so Blob is happy under strict TS.
      const bytes = new Uint8Array(reEncoded);
      const stored = await ctx.storage.store(
        new Blob([bytes], { type: 'image/png' }),
      );
      avatarStorageId = stored;
    }

    const fm = validation.frontmatter;
    const register = fm.register === 'narrative_fiction'
      ? ('narrative_fiction' as const)
      : ('first_person' as const);
    const uploadSessionToken = generateUploadSessionToken();
    const now = Date.now();

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    const { twinId } = (await ctx.runMutation(
      ref.ours.mutations.createPendingTwin.default,
      {
        pseudonym: fm.pseudonym,
        studentRealNameHash: fm.real_name_hash,
        register,
        markdown: cardText,
        avatarStorageId,
        uploadSessionToken,
        now,
      },
    )) as { twinId: string };

    await ctx.scheduler.runAfter(
      0,
      ref.ours.actions.runTwinScans.default,
      { twinId },
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return { uploadSessionToken, twinId };
  },
});

function decodeBase64(b64: string): Uint8Array {
  // atob is available in both Node and V8 isolate. Strip data-URL prefix
  // if a browser sends one (the shell client base64-encodes raw bytes
  // and shouldn't, but be tolerant).
  const clean = b64.includes(',') ? b64.split(',', 2)[1] ?? '' : b64;
  const binStr = atob(clean);
  const out = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) out[i] = binStr.charCodeAt(i);
  return out;
}
