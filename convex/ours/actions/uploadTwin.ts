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

    const { cardText: rawCardText, avatarBytes } = parseUploadPayload(bytes);
    // Auto-heal common AI-generated-card omissions before validating:
    //   - no YAML frontmatter at all → wrap with a minimal one
    //   - frontmatter present but missing pseudonym → inject derived one
    // Pseudonym is derived from the first H1 heading, or a random handle.
    const cardText = ensurePseudonymFrontmatter(rawCardText);
    const validation = validateCard(cardText);
    if (!validation.ok) {
      // Surface a readable Chinese error message instead of stringified JSON.
      // The client shows this verbatim in the upload-failed banner.
      throw new Error(formatValidationErrors(validation.errors));
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
    // real_name_hash is optional under the relaxed validator. Derive a
    // deterministic fallback from the pseudonym so the twins table's
    // non-optional `studentRealNameHash` field still has a value AND
    // so the same student re-uploading the same pseudonym hits the
    // dedupe path. Real distill-twin output always supplies its own
    // hash; this only fires for hand-written cards per /spec.
    const realNameHash =
      fm.real_name_hash && fm.real_name_hash.length > 0
        ? fm.real_name_hash
        : `pseudo-${await sha256Hex(fm.pseudonym)}`;
    const uploadSessionToken = generateUploadSessionToken();
    const now = Date.now();

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    const { twinId } = (await ctx.runMutation(
      ref.ours.mutations.createPendingTwin.default,
      {
        pseudonym: fm.pseudonym,
        studentRealNameHash: realNameHash,
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

// Auto-heal a card.md that's missing frontmatter or pseudonym so the
// upload doesn't reject. Returns the original text unchanged if both
// frontmatter and pseudonym are already present.
function ensurePseudonymFrontmatter(input: string): string {
  const trimmed = input.replace(/^﻿/, '');
  const hasFrontmatter = /^---\n[\s\S]*?\n---\n?/.test(trimmed);
  if (hasFrontmatter) {
    const m = /^---\n([\s\S]*?)\n---/.exec(trimmed);
    const fm = m?.[1] ?? '';
    if (/^pseudonym\s*:/m.test(fm)) {
      return trimmed; // already good
    }
    // Frontmatter exists but no pseudonym → inject one inside it.
    const derived = deriveHandle(trimmed.slice(m![0].length));
    const newFm = `${fm.trim()}\npseudonym: ${derived}`;
    return trimmed.replace(m![0], `---\n${newFm}\n---\n`);
  }
  // No frontmatter at all → prepend a minimal one.
  const derived = deriveHandle(trimmed);
  return `---\npseudonym: ${derived}\n---\n\n${trimmed}`;
}

// Section names that students often use as their first H1. If we pick
// one of these as a handle the twin shows up in the town as "背景" —
// confusing for everyone. Skip them and fall through to the random
// handle path.
const SECTION_NAME_BLACKLIST = new Set([
  '背景', '简介', '介绍', '自我介绍', '性格', '说话方式', '在乎',
  '在乎的事', '人物背景', '人物介绍', '基本信息',
  // English-side common section headers in distill-twin output:
  'background', 'intro', 'introduction', 'about', 'bio',
  'identity', 'personality', 'expression', 'expression style',
  'layer 0', 'layer 1', 'layer 2', 'layer 3', 'layer 4', 'layer 5',
  'worldview principles', 'example exchanges',
]);

function deriveHandle(body: string): string {
  // Prefer the first H1 that ISN'T a section name. distill-twin output
  // typically starts with `# Layer 0 ...` which is useless as a handle;
  // student-written cards may start with `# 阿娆` (a real name) or
  // `# 背景` (a section header). The blacklist catches the latter.
  const lines = body.split('\n');
  for (const line of lines) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (!m || !m[1]) continue;
    const name = m[1].replace(/[*_`~"'#]/g, '').trim();
    if (name.length < 1 || name.length > 20) continue;
    if (SECTION_NAME_BLACKLIST.has(name.toLowerCase())) continue;
    // Also skip distill-twin's "Layer N — ..." headers which the
    // blacklist's "layer N" prefix entries cover, but be defensive
    // about typographic dash variants.
    if (/^Layer\s+\d/i.test(name)) continue;
    return name;
  }
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `游客-${rand}`;
}

// Validation errors live in JS-tagged-union form. Translate the
// handful of common kinds into Chinese sentences for the upload UI.
// Unknown kinds fall through as JSON (better than nothing).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatValidationErrors(errors: any[]): string {
  const lines = errors.map((e) => {
    switch (e.kind) {
      case 'no_frontmatter':
        return '没找到 YAML frontmatter（顶部那段 `---\\n...\\n---`）。最简单的写法是把这两行加到文件最顶上：\n\n---\npseudonym: 你的化名\n---';
      case 'yaml_parse_error':
        return `YAML 解析失败：${e.message}。看一下是不是缩进或冒号写错了。`;
      case 'missing_required_frontmatter':
        return `frontmatter 里缺少必填字段 \`${e.key}\`。比如 pseudonym: 灯火。`;
      case 'invalid_enum':
        return `字段 \`${e.key}\` 的值 \`${String(e.value)}\` 不合法，只能用：${(e.allowed ?? []).join(' / ')}`;
      case 'invalid_type':
        return `字段 \`${e.key}\` 类型错了，期望 ${e.expected}，实际 ${e.got}。`;
      default:
        return `未识别错误：${JSON.stringify(e).slice(0, 200)}`;
    }
  });
  return lines.join('\n\n');
}

async function sha256Hex(input: string): Promise<string> {
  // node Web Crypto in 'use node' actions. Used only as a fallback
  // pseudonymous-id for hand-written cards lacking real_name_hash.
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

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
