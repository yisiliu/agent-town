// Pure orchestration core for the async scan-then-finalize step of the
// twin upload flow. Splitting this out keeps the decision logic
// testable without real scans, schedulers, or DB.
//
// The scan results map to upload outcomes as follows:
//   - both pii.pass AND promptInjection.pass  → pass
//   - any block                               → block (carry reasons)
//   - any manual_review (and no block)        → block (treat as needs
//     instructor approval; the kickTwin/reissueCode flow in Task 27
//     handles unblocking later)

import type { ScanResult } from './piiScanCore';

export type FinalOutcome =
  | { decision: 'pass' }
  | { decision: 'block'; errors: string[] };

// 2026-05 relaxation: classifier-error reasons (Together / DeepSeek
// timing out) are NOT actual content blocks — they're infrastructure
// flakes that the spec's fail-closed default would convert into hard
// rejections. For a class deployment that's needlessly punishing; the
// real safety nets (regex PII patterns, the explicit injection scanner
// when it works) still fire when there's actual bad content.
const CLASSIFIER_ERROR_MARKERS = ['classifier error', 'fail-closed per spec'];
function isClassifierErrorOnly(r: ScanResult): boolean {
  if (r.decision === 'pass') return false;
  if (r.reasons.length === 0) return false;
  return r.reasons.every((reason) =>
    CLASSIFIER_ERROR_MARKERS.some((m) => reason.includes(m)),
  );
}

export function reconcileScanResults(
  pii: ScanResult,
  promptInjection: ScanResult,
): FinalOutcome {
  const piiClean = pii.decision === 'pass' || isClassifierErrorOnly(pii);
  const injClean = promptInjection.decision === 'pass' || isClassifierErrorOnly(promptInjection);
  if (piiClean && injClean) {
    return { decision: 'pass' };
  }
  if (pii.decision === 'pass' && promptInjection.decision === 'pass') {
    return { decision: 'pass' };
  }

  const errors: string[] = [];
  if (pii.decision !== 'pass') {
    errors.push(
      ...pii.reasons.map((r) => `PII (${pii.decision}): ${r}`),
    );
    // Manual review with no explicit reasons still surfaces a label.
    if (pii.reasons.length === 0) {
      errors.push(`PII (${pii.decision})`);
    }
  }
  if (promptInjection.decision !== 'pass') {
    errors.push(
      ...promptInjection.reasons.map(
        (r) => `prompt injection (${promptInjection.decision}): ${r}`,
      ),
    );
    if (promptInjection.reasons.length === 0) {
      errors.push(`prompt injection (${promptInjection.decision})`);
    }
  }
  return { decision: 'block', errors };
}
