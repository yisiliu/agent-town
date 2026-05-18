import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { unzipSync, strFromU8 } from 'fflate';
import schema from '../schema';
import {
  buildTestZip,
  loadFixtureCard,
} from './fixtures/buildTestZip';
import { validateCard } from '../ours/lib/cardValidator';
import { scanForPII, type PIIScanDeps } from '../ours/lib/piiScanCore';
import { scanForPromptInjection } from '../ours/lib/promptInjectionScanCore';
import { reconcileScanResults } from '../ours/lib/uploadFlowCore';
import {
  generateUploadSessionToken,
  recordPending,
  readUploadResult,
} from '../ours/lib/uploadResultsStore';
import { finalizeScanCore } from '../ours/lib/finalizeScanCore';
import { verifyCodeFor } from '../ours/lib/authCodeStore';

const modules = import.meta.glob('../**/*.ts');

// Drives the same lib path uploadTwin → runTwinScans → finalizeScan
// follows in production, just inlined inside a t.run so we can assert
// against the DB state without needing typed function refs. Each
// fixture exercises a distinct outcome; together they're a regression
// fence around the full data pipeline.

interface PipelineRunArgs {
  cardMd: string;
  // Mocked scan classifier verdicts — let each test pin a specific
  // path through the scans without real network calls.
  piiSeverity?: 'HIGH' | 'MEDIUM' | 'NONE';
  injectionVerdict?: 'safe' | 'unsafe';
}

type Outcome =
  | { state: 'rejected_validation'; errors: string[] }
  | {
      state: 'active' | 'rejected';
      codes?: { spectate: string; control: string; edit: string };
      errors?: string[];
      uploadSessionToken: string;
    };

async function runPipeline(args: PipelineRunArgs): Promise<Outcome> {
  const t = convexTest(schema, modules);

  // Stage 1 — zip sanity (the action does this with fflate; we
  // mirror it here so a malformed fixture fails the same way it
  // would in production).
  const zipBytes = buildTestZip({ cardMd: args.cardMd });
  const files = unzipSync(zipBytes);
  const text = strFromU8(files['card.md']!);

  // Stage 2 — schema validation (sync, throws upstream).
  const validation = validateCard(text);
  if (!validation.ok) {
    return {
      state: 'rejected_validation',
      errors: validation.errors.map((e) => JSON.stringify(e)),
    };
  }

  // Stage 3 — pending DB writes (twin + card + uploadResults bridge).
  const fm = validation.frontmatter;
  const uploadSessionToken = generateUploadSessionToken();
  const now = Date.UTC(2026, 4, 19, 12);
  const twinId = await t.run(async (ctx) => {
    const tId = await ctx.db.insert('twins', {
      pseudonym: fm.pseudonym,
      studentRealNameHash: fm.real_name_hash,
      state: 'pending_scan' as const,
      register:
        fm.register === 'narrative_fiction'
          ? ('narrative_fiction' as const)
          : ('first_person' as const),
      createdAt: now,
    });
    const cardId = await ctx.db.insert('cards', {
      twinId: tId,
      markdown: text,
      snapshotAt: now,
      piiScanStatus: 'pending' as const,
      promptInjectionScanStatus: 'pending' as const,
    });
    await ctx.db.patch(tId, { cardId });
    await recordPending(ctx, { uploadSessionToken, twinId: tId, now });
    return tId;
  });

  // Stage 4 — scans (using stub classifiers so we test the pipeline,
  // not Anthropic / Together).
  const piiDeps: PIIScanDeps = {
    classifyWithLLM: async () => args.piiSeverity ?? 'NONE',
  };
  const pii = await scanForPII(piiDeps, {
    text,
    idempotencyKey: 'integration',
  });
  const promptInjection = await scanForPromptInjection(
    {
      classify: async () => ({
        verdict: args.injectionVerdict ?? 'safe',
      }),
    },
    { text },
  );
  const outcome = reconcileScanResults(pii, promptInjection);

  // Stage 5 — finalize (issues codes on pass; stores errors on block).
  await t.run(async (ctx) => {
    await finalizeScanCore(ctx, {
      twinId,
      uploadSessionToken,
      outcome,
      piiDecision: pii.decision,
      promptInjectionDecision: promptInjection.decision,
      scanReasons: [...pii.reasons, ...promptInjection.reasons],
      now,
    });
  });

  // Stage 6 — read the final state out as the UI would.
  const result = await t.run(async (ctx) =>
    readUploadResult(ctx, uploadSessionToken, now + 1_000),
  );
  if (!result) throw new Error('integration: upload result missing');
  if (result.state === 'pending') {
    throw new Error(
      'integration: pipeline left twin pending — finalizeScan must have run',
    );
  }

  // Belt-and-braces: verify the issued codes actually authenticate.
  if (result.state === 'active' && result.codes) {
    const verifyAll = await t.run(async (ctx) =>
      Promise.all([
        verifyCodeFor(ctx, twinId, 'spectate', result.codes!.spectate),
        verifyCodeFor(ctx, twinId, 'control', result.codes!.control),
        verifyCodeFor(ctx, twinId, 'edit', result.codes!.edit),
      ]),
    );
    expect(verifyAll).toEqual([true, true, true]);
  }

  return {
    state: result.state,
    codes: result.codes,
    errors: result.errors,
    uploadSessionToken,
  };
}

describe('upload pipeline — end-to-end through each fixture', () => {
  it('clean-zh.md → active twin + 3 verifiable codes', async () => {
    const md = await loadFixtureCard('clean-zh');
    const out = await runPipeline({
      cardMd: md,
      piiSeverity: 'NONE',
      injectionVerdict: 'safe',
    });
    expect(out.state).toBe('active');
    if (out.state === 'active' && out.codes) {
      expect(out.codes.spectate).toMatch(/^\d{6}$/);
      expect(out.codes.control).toMatch(/^\d{6}$/);
      expect(out.codes.edit).toMatch(/^\d{6}$/);
      // Three distinct codes — collision is astronomically unlikely,
      // but worth a sanity check.
      expect(
        new Set([out.codes.spectate, out.codes.control, out.codes.edit]).size,
      ).toBe(3);
    }
  });

  it('with-pii.md → rejected with PII reasons (phone + email + address)', async () => {
    const md = await loadFixtureCard('with-pii');
    const out = await runPipeline({
      cardMd: md,
      piiSeverity: 'NONE',
      injectionVerdict: 'safe',
    });
    expect(out.state).toBe('rejected');
    if (out.state !== 'rejected') return;
    expect(out.codes).toBeUndefined();
    const joined = (out.errors ?? []).join(' ');
    expect(joined).toMatch(/PII/);
    expect(joined).toMatch(/phone/i);
    expect(joined).toMatch(/email/i);
    expect(joined).toMatch(/address/i);
  });

  it('with-injection.md → rejected with prompt-injection reasons', async () => {
    const md = await loadFixtureCard('with-injection');
    const out = await runPipeline({
      cardMd: md,
      piiSeverity: 'NONE',
      injectionVerdict: 'unsafe',
    });
    expect(out.state).toBe('rejected');
    if (out.state !== 'rejected') return;
    expect((out.errors ?? []).join(' ')).toMatch(/prompt injection/i);
  });

  it('invalid-missing-section.md → rejected at schema stage (never hits scans)', async () => {
    const md = await loadFixtureCard('invalid-missing-section');
    const out = await runPipeline({ cardMd: md });
    expect(out.state).toBe('rejected_validation');
    if (out.state !== 'rejected_validation') return;
    const errString = out.errors.join('|');
    expect(errString).toMatch(/missing_section.*Voice/);
    expect(errString).toMatch(/missing_section.*Signature phrases/);
  });
});

describe('pipeline state assertions — DB shape after each outcome', () => {
  it('active flow leaves twin.state=active and card statuses=pass', async () => {
    const md = await loadFixtureCard('clean-zh');
    const t = convexTest(schema, modules);
    const ctx0 = await t.run(async (ctx) => {
      const tId = await ctx.db.insert('twins', {
        pseudonym: 'p',
        studentRealNameHash: 'h',
        state: 'pending_scan' as const,
        createdAt: 0,
      });
      const cId = await ctx.db.insert('cards', {
        twinId: tId,
        markdown: md,
        snapshotAt: 0,
        piiScanStatus: 'pending' as const,
        promptInjectionScanStatus: 'pending' as const,
      });
      await ctx.db.patch(tId, { cardId: cId });
      const token = generateUploadSessionToken();
      await recordPending(ctx, { uploadSessionToken: token, twinId: tId, now: 0 });
      return { tId, cId, token };
    });

    await t.run(async (ctx) =>
      finalizeScanCore(ctx, {
        twinId: ctx0.tId,
        uploadSessionToken: ctx0.token,
        outcome: { decision: 'pass' },
        piiDecision: 'pass',
        promptInjectionDecision: 'pass',
        scanReasons: [],
        now: 1,
      }),
    );

    await t.run(async (ctx) => {
      const twin = await ctx.db.get(ctx0.tId);
      const card = await ctx.db.get(ctx0.cId);
      expect(twin?.state).toBe('active');
      expect(card?.piiScanStatus).toBe('pass');
      expect(card?.promptInjectionScanStatus).toBe('pass');
      const codes = await ctx.db
        .query('authCodes')
        .withIndex('twinId', (q) => q.eq('twinId', ctx0.tId))
        .collect();
      expect(codes).toHaveLength(3);
      expect(codes.map((c) => c.scope).sort()).toEqual([
        'control',
        'edit',
        'spectate',
      ]);
    });
  });

  it('blocked flow leaves twin.state=rejected, card statuses copied, no codes issued', async () => {
    const md = await loadFixtureCard('with-pii');
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tId = await ctx.db.insert('twins', {
        pseudonym: 'p2',
        studentRealNameHash: 'h2',
        state: 'pending_scan' as const,
        createdAt: 0,
      });
      const cId = await ctx.db.insert('cards', {
        twinId: tId,
        markdown: md,
        snapshotAt: 0,
        piiScanStatus: 'pending' as const,
        promptInjectionScanStatus: 'pending' as const,
      });
      await ctx.db.patch(tId, { cardId: cId });
      const token = generateUploadSessionToken();
      await recordPending(ctx, { uploadSessionToken: token, twinId: tId, now: 0 });
      return { tId, cId, token };
    });

    await t.run(async (ctx) =>
      finalizeScanCore(ctx, {
        twinId: seeded.tId,
        uploadSessionToken: seeded.token,
        outcome: {
          decision: 'block',
          errors: ['PII (block): regex match: email'],
        },
        piiDecision: 'block',
        promptInjectionDecision: 'pass',
        scanReasons: ['regex match: email'],
        now: 1,
      }),
    );

    await t.run(async (ctx) => {
      const twin = await ctx.db.get(seeded.tId);
      const card = await ctx.db.get(seeded.cId);
      expect(twin?.state).toBe('rejected');
      expect(card?.piiScanStatus).toBe('block');
      expect(card?.scanReasons).toEqual(['regex match: email']);
      const codes = await ctx.db
        .query('authCodes')
        .withIndex('twinId', (q) => q.eq('twinId', seeded.tId))
        .collect();
      expect(codes).toHaveLength(0);
    });
  });
});
