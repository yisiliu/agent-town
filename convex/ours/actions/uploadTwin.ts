'use node';

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { validateCard } from '../lib/cardValidator';
import { parseUploadPayload } from '../lib/uploadPayload';
import { generateUploadSessionToken } from '../lib/uploadResultsStore';

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB upload ceiling.
// Card.md alone is <5KB; a zip with avatar.png maybe <500KB; anything
// past 5MB is out-of-spec.

// Spec §4.9 sync upload stage: schema validation + avatar re-encode +
// pending_scan write + scheduled async scans. Returns an
// uploadSessionToken the UI polls via uploadResultByToken.byToken.
//
// Accepts EITHER a .zip bundle (card.md + optional avatar.png) OR a
// bare card.md file — see lib/uploadPayload.ts for the detection.
// distill-twin's `extract` command produces a single card.md, so the
// bare-md path removes the manual-zip step from the student workflow.
//
// Node action because:
//   - fflate's unzipSync is fine in either runtime
//   - sharp re-encoding (when an avatar is present) needs native libvips
export default action({
  args: {
    fileBase64: v.string(),
  },
  handler: async (ctx, { fileBase64 }) => {
    const bytes = decodeBase64(fileBase64);
    if (bytes.byteLength > MAX_PAYLOAD_BYTES) {
      throw new Error(
        `uploadTwin: payload exceeds ${MAX_PAYLOAD_BYTES} byte ceiling`,
      );
    }

    const { cardText, avatarBytes } = parseUploadPayload(bytes);
    const validation = validateCard(cardText);
    if (!validation.ok) {
      throw new Error(
        `uploadTwin: card.md failed validation — ${JSON.stringify(validation.errors).slice(0, 500)}`,
      );
    }

    let avatarStorageId: string | undefined;
    if (avatarBytes && avatarBytes.byteLength > 0) {
      // Dynamic import keeps the native lib out of the cold-start path
      // when no avatar is supplied (tests, bare-card.md uploads).
      const sharpModule = await import('sharp');
      const sharp = (sharpModule.default ?? sharpModule) as typeof import('sharp');
      const reEncoded = await sharp(avatarBytes)
        .resize({ width: 512, height: 512, fit: 'cover' })
        .png({ effort: 1 })
        .toBuffer();
      // sharp returns a Node Buffer whose .buffer is ArrayBufferLike;
      // copy into a fresh Uint8Array so Blob is happy under strict TS.
      const out = new Uint8Array(reEncoded);
      const stored = await ctx.storage.store(
        new Blob([out], { type: 'image/png' }),
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
