import { describe, it, expect } from 'vitest';
import { reconcileScanResults } from '../ours/lib/uploadFlowCore';

describe('reconcileScanResults', () => {
  it('returns pass only when BOTH scans pass', () => {
    expect(
      reconcileScanResults(
        { decision: 'pass', reasons: [] },
        { decision: 'pass', reasons: [] },
      ),
    ).toEqual({ decision: 'pass' });
  });

  it('returns block when piiScan blocks (carries reasons)', () => {
    const out = reconcileScanResults(
      { decision: 'block', reasons: ['regex match: email'] },
      { decision: 'pass', reasons: [] },
    );
    expect(out.decision).toBe('block');
    if (out.decision === 'block') {
      expect(out.errors).toEqual(['PII (block): regex match: email']);
    }
  });

  it('returns block when promptInjectionScan blocks', () => {
    const out = reconcileScanResults(
      { decision: 'pass', reasons: [] },
      { decision: 'block', reasons: ['Llama Guard flagged unsafe: S1'] },
    );
    expect(out.decision).toBe('block');
    if (out.decision === 'block') {
      expect(out.errors).toEqual([
        'prompt injection (block): Llama Guard flagged unsafe: S1',
      ]);
    }
  });

  it('combines reasons when both scans block', () => {
    const out = reconcileScanResults(
      { decision: 'block', reasons: ['regex match: email'] },
      { decision: 'block', reasons: ['Llama Guard flagged unsafe'] },
    );
    expect(out.decision).toBe('block');
    if (out.decision === 'block') {
      expect(out.errors).toHaveLength(2);
    }
  });

  it('treats manual_review as block-needing-review', () => {
    const out = reconcileScanResults(
      { decision: 'manual_review', reasons: ['classifier severity: MEDIUM'] },
      { decision: 'pass', reasons: [] },
    );
    expect(out.decision).toBe('block');
    if (out.decision === 'block') {
      expect(out.errors[0]).toMatch(/manual_review/);
    }
  });

  it('surfaces a label even when reasons array is empty', () => {
    const out = reconcileScanResults(
      { decision: 'block', reasons: [] },
      { decision: 'pass', reasons: [] },
    );
    if (out.decision === 'block') {
      expect(out.errors).toEqual(['PII (block)']);
    }
  });
});
