// Spec §4.9 — block-by-default PII gate on card uploads. Two-phase scan:
//
// 1. Deterministic regex (piiPatterns.ts) catches the unambiguous cases
//    cheaply — any hit short-circuits the LLM call.
// 2. LLM classifier (via llmRouter callType `pii_scan`) catches non-obvious
//    PII the regexes can't reach: distinctive bio details, real-person
//    references, etc. The classifier returns one of three severities.
//
// This file is pure orchestration so tests exercise the decision logic
// without Convex runtime or network. The action wrapper at
// ours/actions/piiScan.ts wires the real llmRouter call as the
// classifyWithLLM dep.

import { matchPII } from './piiPatterns';

export type LLMSeverity = 'HIGH' | 'MEDIUM' | 'NONE';

export type ScanDecision = 'pass' | 'block' | 'manual_review';

export interface ScanResult {
  decision: ScanDecision;
  reasons: string[];
}

export interface PIIScanRequest {
  text: string;
  idempotencyKey: string;
}

export interface PIIScanDeps {
  classifyWithLLM: (args: {
    text: string;
    idempotencyKey: string;
  }) => Promise<LLMSeverity>;
}

export const PII_CLASSIFIER_SYSTEM = `You classify text for PII risk.
Read the text and reply with EXACTLY ONE word, no punctuation or explanation:
- HIGH if the text names a real, identifiable individual or contains direct contact info, workplace + role specific enough to identify a single person, or a precise location (specific building/apartment).
- MEDIUM if the text has details that could plausibly identify someone (uncommon employer + neighborhood, distinctive medical or legal situation) but is ambiguous on its own.
- NONE if the text reads as a fictional or generic persona with no identifying details.
Reply with HIGH, MEDIUM, or NONE only.`;

function parseSeverity(raw: string): LLMSeverity | null {
  const upper = raw.trim().toUpperCase();
  if (upper === 'HIGH' || upper === 'MEDIUM' || upper === 'NONE') return upper;
  return null;
}

export async function scanForPII(
  deps: PIIScanDeps,
  req: PIIScanRequest,
): Promise<ScanResult> {
  const regexHits = matchPII(req.text);
  if (regexHits.length > 0) {
    return {
      decision: 'block',
      reasons: regexHits.map((label) => `regex match: ${label}`),
    };
  }

  let severity: LLMSeverity | null;
  try {
    const raw = await deps.classifyWithLLM({
      text: req.text,
      idempotencyKey: req.idempotencyKey,
    });
    severity = parseSeverity(String(raw));
  } catch {
    return {
      decision: 'manual_review',
      reasons: ['classifier error — flagged for instructor review'],
    };
  }

  if (severity === null) {
    return {
      decision: 'manual_review',
      reasons: ['classifier returned unparseable severity'],
    };
  }
  if (severity === 'HIGH') {
    return { decision: 'block', reasons: ['classifier severity: HIGH'] };
  }
  if (severity === 'MEDIUM') {
    return {
      decision: 'manual_review',
      reasons: ['classifier severity: MEDIUM'],
    };
  }
  return { decision: 'pass', reasons: [] };
}
