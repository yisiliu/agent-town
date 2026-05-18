// Spec §4.9 prompt-injection gate — fail-closed: any classifier error,
// timeout, or parse failure produces `decision: 'block'`. Per-card budget
// cap is $0.05 (plan Task 9 Step 1); we approximate cost by character
// length against Together's published Llama-Guard-3-8B price (~$0.20 per
// 1M input tokens). 4 chars/token × 250K input tokens = ~1M chars.
//
// This file is pure orchestration. The action wrapper at
// ours/actions/promptInjectionScan.ts wires the real Together call.

import type { ScanResult } from './piiScanCore';
import type { LlamaGuardVerdict } from './togetherClient';

export type { ScanResult } from './piiScanCore';

export const PER_SCAN_BUDGET_USD = 0.05;

// Together Llama-Guard-3-8B list price: $0.20 / 1M input tokens
// (≈ 4 chars / token by Together's own tokenizer estimate). The
// budget cap is mostly a paranoia guard — card.md is capped at 5KB
// upstream, so the threshold should only ever fire on adversarial
// payloads that bypass the schema validator.
const TOGETHER_INPUT_USD_PER_TOKEN = 0.2 / 1_000_000;
const CHARS_PER_TOKEN = 4;
const MAX_CHARS_FOR_BUDGET = Math.floor(
  (PER_SCAN_BUDGET_USD / TOGETHER_INPUT_USD_PER_TOKEN) * CHARS_PER_TOKEN,
);

export interface PromptInjectionRequest {
  text: string;
}

export interface PromptInjectionDeps {
  classify: (text: string) => Promise<LlamaGuardVerdict>;
}

export async function scanForPromptInjection(
  deps: PromptInjectionDeps,
  req: PromptInjectionRequest,
): Promise<ScanResult> {
  if (req.text.length > MAX_CHARS_FOR_BUDGET) {
    return {
      decision: 'block',
      reasons: [
        `scan would exceed per-card budget of $${PER_SCAN_BUDGET_USD} — instructor review required`,
      ],
    };
  }

  let verdict: LlamaGuardVerdict;
  try {
    verdict = await deps.classify(req.text);
  } catch {
    return {
      decision: 'block',
      reasons: ['classifier error — fail-closed per spec §4.9'],
    };
  }

  if (verdict.verdict === 'safe') {
    return { decision: 'pass', reasons: [] };
  }

  const cats = verdict.categories ?? [];
  const tail = cats.length > 0 ? `: ${cats.join(', ')}` : '';
  return {
    decision: 'block',
    reasons: [`Llama Guard flagged unsafe${tail}`],
  };
}
