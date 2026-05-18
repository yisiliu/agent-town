// Deterministic PII patterns — the cheap first-pass before the LLM
// classifier. Pattern coverage is deliberately conservative: we'd rather
// false-positive a clean card into `block` (instructor can review on the
// student override path) than smuggle real PII through. See spec §4.9
// "Block-by-default on PII detection; student-initiated override".
//
// Each entry's `label` is what we surface in the scan result `reasons[]`.
// Keep labels short — they show up in the rejected-twin instructor UI.

export interface PIIPattern {
  label: string;
  regex: RegExp;
}

export const PII_PATTERNS: PIIPattern[] = [
  // RFC 5322 lite. Covers the everyday Latin-script cases; doesn't try
  // for IDN or quoted local parts (those would mostly false-positive).
  {
    label: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  },
  // Mainland China mobile: 1[3-9] + 9 digits. Anchored on non-digit
  // boundaries so we don't catch the middle of longer numerics.
  {
    label: 'phone (CN mobile)',
    regex: /(?<!\d)1[3-9]\d{9}(?!\d)/,
  },
  // North American phone: optional +1, optional area-code parens, three
  // common separators. The leading non-digit anchor matters because
  // student IDs / years can look like 7-digit runs.
  {
    label: 'phone (US/NA)',
    regex: /(?<!\d)(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/,
  },
  // Chinese street address: "X路" or "X街" followed within a short
  // window by 号 + digits. The X路X号 / X街X号 combo is the strongest
  // address signal in zh; matching either keyword alone catches too
  // many fictional place names (光明路 isn't always PII). The gap
  // permits whitespace ("建国路 88 号") but stops at sentence
  // punctuation so we don't bridge two phrases.
  {
    label: 'address (CN street)',
    regex: /[路街弄巷][^，。,.\n]{0,12}?\d+\s*号/,
  },
  // US-style street address: number + word + Street/Ave/Rd/Blvd/Ln/Dr.
  // Word boundary on both sides; case-insensitive suffix.
  {
    label: 'address (US street)',
    regex:
      /\b\d{1,5}\s+[A-Za-z][A-Za-z0-9.'-]*(?:\s+[A-Za-z][A-Za-z0-9.'-]*)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?/i,
  },
];

export function matchPII(text: string): string[] {
  const hits: string[] = [];
  for (const { label, regex } of PII_PATTERNS) {
    if (regex.test(text)) hits.push(label);
  }
  return hits;
}
