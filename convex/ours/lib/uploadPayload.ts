import { unzipSync, strFromU8 } from 'fflate';

// Untangles the upload action's payload-parsing step from its I/O
// orchestration so the detect-zip-or-raw logic is testable without a
// Convex action runtime.
//
// Two shapes accepted today:
//   - .zip — a bundle containing card.md (and optional avatar.png).
//     Detected by ZIP magic bytes (PK\x03\x04). The student gets one
//     of these by hand-bundling distill output + avatar.png, or by
//     running a future `distill bundle` command.
//   - .md — a bare card.md file. Detected by absence of ZIP magic.
//     This is the typical shape of `distill extract` output (a
//     single card.md), so accepting it directly removes one manual
//     zip step from the student workflow.

export interface ParsedPayload {
  cardText: string;
  avatarBytes?: Uint8Array;
}

// ZIP local file header magic: 0x50 0x4B 0x03 0x04. Also accepts the
// empty-archive (0x05 0x06) and spanned-archive (0x07 0x08) signatures
// since fflate handles those, though we shouldn't see them in practice.
function isZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  const c = bytes[2];
  const d = bytes[3];
  return (c === 0x03 && d === 0x04) || (c === 0x05 && d === 0x06) || (c === 0x07 && d === 0x08);
}

export function parseUploadPayload(bytes: Uint8Array): ParsedPayload {
  if (isZip(bytes)) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch (err) {
      throw new Error(`uploadTwin: invalid zip — ${(err as Error).message}`);
    }
    const cardBytes = files['card.md'];
    if (!cardBytes) {
      throw new Error('uploadTwin: zip is missing card.md');
    }
    const result: ParsedPayload = { cardText: strFromU8(cardBytes) };
    const avatar = files['avatar.png'];
    if (avatar && avatar.byteLength > 0) result.avatarBytes = avatar;
    return result;
  }
  // Bare card.md — UTF-8 decode the whole payload.
  return { cardText: strFromU8(bytes) };
}
