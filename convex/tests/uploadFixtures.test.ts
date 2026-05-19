import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildTestZip, loadFixtureCard } from '../../tests/fixtures/buildTestZip';
import { validateCard } from '../ours/lib/cardValidator';
import { scanForPII, type PIIScanDeps } from '../ours/lib/piiScanCore';
import { scanForPromptInjection } from '../ours/lib/promptInjectionScanCore';
import { reconcileScanResults } from '../ours/lib/uploadFlowCore';

// Pinned classifier mocks — keep the fixture-driven tests deterministic
// regardless of real Anthropic / Together availability.
const stubPIIDeps = (severity: 'HIGH' | 'NONE' = 'NONE'): PIIScanDeps => ({
  classifyWithLLM: async () => severity,
});

describe('buildTestZip — round-trip', () => {
  it('packs card.md back to readable bytes', () => {
    const zip = buildTestZip({ cardMd: 'hello\nworld' });
    const files = unzipSync(zip);
    expect(files['card.md']).toBeDefined();
    expect(strFromU8(files['card.md']!)).toBe('hello\nworld');
  });

  it('omits avatar.png entry when no avatar supplied', () => {
    const zip = buildTestZip({ cardMd: 'x' });
    expect(unzipSync(zip)).not.toHaveProperty('avatar.png');
  });

  it('includes avatar.png when supplied', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const zip = buildTestZip({ cardMd: 'x', avatarPng: bytes });
    expect(Array.from(unzipSync(zip)['avatar.png']!)).toEqual([1, 2, 3, 4]);
  });
});

describe('fixture cards — end-to-end gate behavior', () => {
  it('clean-zh.md passes validation', async () => {
    const md = await loadFixtureCard('clean-zh');
    const v = validateCard(md);
    expect(v.ok).toBe(true);
  });

  it('clean-zh.md passes both scans → final outcome pass', async () => {
    const md = await loadFixtureCard('clean-zh');
    const pii = await scanForPII(stubPIIDeps('NONE'), {
      text: md,
      idempotencyKey: 'fixture-clean',
    });
    const pi = await scanForPromptInjection(
      { classify: async () => ({ verdict: 'safe' }) },
      { text: md },
    );
    expect(pii.decision).toBe('pass');
    expect(pi.decision).toBe('pass');
    expect(reconcileScanResults(pii, pi).decision).toBe('pass');
  });

  it('with-pii.md passes validation but piiScan blocks on regex hits', async () => {
    const md = await loadFixtureCard('with-pii');
    expect(validateCard(md).ok).toBe(true);
    const pii = await scanForPII(stubPIIDeps('NONE'), {
      text: md,
      idempotencyKey: 'fixture-pii',
    });
    expect(pii.decision).toBe('block');
    // The fixture contains a zh mobile, email, and zh street address —
    // all three patterns should hit.
    const labels = pii.reasons.join(' ');
    expect(labels).toMatch(/phone/i);
    expect(labels).toMatch(/email/i);
    expect(labels).toMatch(/address/i);
  });

  it('with-pii.md → reconciled outcome is block, regardless of injection result', async () => {
    const md = await loadFixtureCard('with-pii');
    const pii = await scanForPII(stubPIIDeps('NONE'), {
      text: md,
      idempotencyKey: 'fixture-pii-2',
    });
    const pi = await scanForPromptInjection(
      { classify: async () => ({ verdict: 'safe' }) },
      { text: md },
    );
    const out = reconcileScanResults(pii, pi);
    expect(out.decision).toBe('block');
    if (out.decision === 'block') {
      expect(out.errors.some((e) => e.includes('PII'))).toBe(true);
    }
  });

  it('with-injection.md passes validation; injection scanner blocks it', async () => {
    const md = await loadFixtureCard('with-injection');
    expect(validateCard(md).ok).toBe(true);
    // PII regex isn't expected to hit; LLM classifier sees plain
    // injection language. Tested via stubbed classify=unsafe to mirror
    // a real Llama Guard verdict.
    const pi = await scanForPromptInjection(
      {
        classify: async () => ({ verdict: 'unsafe', categories: ['S14'] }),
      },
      { text: md },
    );
    expect(pi.decision).toBe('block');
  });

  it('invalid-missing-section.md fails validateCard with missing-section errors', async () => {
    const md = await loadFixtureCard('invalid-missing-section');
    const v = validateCard(md);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const missing = v.errors
        .filter((e) => e.kind === 'missing_section')
        .map((e) => (e as { section: string }).section);
      expect(missing).toContain('Voice');
      expect(missing).toContain('Signature phrases');
    }
  });
});
