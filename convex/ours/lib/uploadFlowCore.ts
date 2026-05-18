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

export function reconcileScanResults(
  pii: ScanResult,
  promptInjection: ScanResult,
): FinalOutcome {
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
