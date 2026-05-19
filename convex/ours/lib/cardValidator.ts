import { parse as parseYAML, YAMLParseError } from 'yaml';

// KEEP IN SYNC with shell/src/lib/card-validator.ts. The shell validates
// client-side for fast feedback; this is the authoritative server-side
// gate per spec §4.9 ("Schema validation in CLI/web AND cheap
// re-validation server-side on submit"). Convex workspace can't import
// from shell workspace, hence the duplication. Both files should be
// behaviorally identical — if you change one, change the other.

export const REGISTERS = [
  'personal',
  'professional',
  'narrative_fiction',
  'roleplay',
] as const;
export type Register = (typeof REGISTERS)[number];

export const LANGUAGES = ['zh', 'en', 'mixed'] as const;
export type Language = (typeof LANGUAGES)[number];

// distill-twin's render output (post-2026-05 refactor) groups the
// persona by Layer 0-5 + standalone sections. Family routes prompt
// selection inside distill; agent-town doesn't currently branch on it
// but validates the value so we don't accidentally accept a typo.
export const FAMILIES = [
  'self',
  'colleague',
  'relationship',
  'celebrity',
] as const;
export type Family = (typeof FAMILIES)[number];

export const ALLOWED_FRONTMATTER_KEYS = [
  'pseudonym',
  'real_name_hash',
  'plane',
  'family',
  'schema_version',
  'created',
  'register',
  'language',
  'source_stats',
] as const;

// family + source_stats are optional in the validator (lenient at the
// boundary — distill enforces them upstream, and a manually-edited
// card without source_stats should still upload).
export const REQUIRED_FRONTMATTER_KEYS = [
  'pseudonym',
  'real_name_hash',
  'plane',
  'schema_version',
  'created',
  'register',
  'language',
] as const;

// distill-twin renders body as Layer 0-5 + Worldview + Example exchanges,
// plus the optional "How they've changed" section (only present when
// Stage 3 detected real opinion drift). Headers are matched after
// apostrophe canonicalisation (’ → '), so the curly form works too.
export const REQUIRED_SECTIONS = [
  'Layer 0 — Core personality',
  'Layer 1 — Identity',
  'Layer 2 — Expression style',
  'Layer 3 — Decisions & judgment',
  'Layer 4 — Interpersonal behavior',
  'Layer 5 — Boundaries & red lines',
  'Worldview principles',
  'Example exchanges',
] as const;

// Practical character caps. Distill's own SECTION_MAX_WORDS uses word
// counts (English-biased); we use characters so Chinese cards aren't
// over-counted. Numbers chosen as (distill_words × ~6 chars/word) —
// roomy enough that distill's soft warnings never become our hard
// rejections under normal output.
export const SECTION_LENGTH_CAPS: Record<string, number> = {
  'Layer 0 — Core personality': 1500,
  'Layer 1 — Identity': 2000,
  'Layer 2 — Expression style': 4000,
  'Layer 3 — Decisions & judgment': 3500,
  'Layer 4 — Interpersonal behavior': 3500,
  'Layer 5 — Boundaries & red lines': 2000,
  'Worldview principles': 2500,
  "How they've changed": 2500,
  'How they’ve changed': 2500,
  'Example exchanges': 4000,
};

function canonicaliseSection(s: string): string {
  return s.replace(/’/g, "'");
}

export interface CardFrontmatter {
  pseudonym: string;
  real_name_hash: string;
  plane: string;
  family?: Family;
  schema_version: number;
  created: string;
  register: Register;
  language: Language;
  source_stats?: {
    tokens: number;
    sources: string[];
    date_range: [string, string];
  };
}

export type ValidationError =
  | { kind: 'no_frontmatter' }
  | { kind: 'yaml_parse_error'; message: string }
  | { kind: 'unknown_frontmatter_key'; key: string }
  | { kind: 'missing_required_frontmatter'; key: string }
  | { kind: 'invalid_enum'; key: string; value: unknown; allowed: readonly string[] }
  | { kind: 'invalid_type'; key: string; expected: string; got: string }
  | { kind: 'missing_section'; section: string }
  | { kind: 'section_too_long'; section: string; length: number; cap: number };

export type ValidationResult =
  | { ok: true; frontmatter: CardFrontmatter; body: string }
  | { ok: false; errors: ValidationError[] };

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function validateCard(input: string): ValidationResult {
  const errors: ValidationError[] = [];
  const match = FRONTMATTER_RE.exec(input);
  if (!match) {
    return { ok: false, errors: [{ kind: 'no_frontmatter' }] };
  }
  const [, yamlText, body] = match;

  let raw: unknown;
  try {
    raw = parseYAML(yamlText ?? '');
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          kind: 'yaml_parse_error',
          message: err instanceof YAMLParseError ? err.message : String(err),
        },
      ],
    };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [
        { kind: 'invalid_type', key: '<frontmatter>', expected: 'object', got: typeof raw },
      ],
    };
  }

  const fm = raw as Record<string, unknown>;
  const allowedSet = new Set<string>(ALLOWED_FRONTMATTER_KEYS);
  for (const key of Object.keys(fm)) {
    if (!allowedSet.has(key)) {
      errors.push({ kind: 'unknown_frontmatter_key', key });
    }
  }
  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!(key in fm) || fm[key] === undefined || fm[key] === null) {
      errors.push({ kind: 'missing_required_frontmatter', key });
    }
  }

  if ('register' in fm && !REGISTERS.includes(fm.register as Register)) {
    errors.push({
      kind: 'invalid_enum',
      key: 'register',
      value: fm.register,
      allowed: REGISTERS,
    });
  }
  if ('language' in fm && !LANGUAGES.includes(fm.language as Language)) {
    errors.push({
      kind: 'invalid_enum',
      key: 'language',
      value: fm.language,
      allowed: LANGUAGES,
    });
  }
  if (
    'family' in fm &&
    fm.family !== undefined &&
    !FAMILIES.includes(fm.family as Family)
  ) {
    errors.push({
      kind: 'invalid_enum',
      key: 'family',
      value: fm.family,
      allowed: FAMILIES,
    });
  }
  if ('schema_version' in fm && typeof fm.schema_version !== 'number') {
    errors.push({
      kind: 'invalid_type',
      key: 'schema_version',
      expected: 'number',
      got: typeof fm.schema_version,
    });
  }

  const sections = parseSections(body ?? '');
  const presentCanonical = new Set(
    Object.keys(sections).map((s) => canonicaliseSection(s)),
  );
  for (const sec of REQUIRED_SECTIONS) {
    if (!presentCanonical.has(canonicaliseSection(sec))) {
      errors.push({ kind: 'missing_section', section: sec });
    }
  }

  for (const [section, content] of Object.entries(sections)) {
    const cap =
      SECTION_LENGTH_CAPS[section] ??
      SECTION_LENGTH_CAPS[canonicaliseSection(section)];
    if (cap !== undefined && content.length > cap) {
      errors.push({
        kind: 'section_too_long',
        section,
        length: content.length,
        cap,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    frontmatter: fm as unknown as CardFrontmatter,
    body: body ?? '',
  };
}

function parseSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // ATX-style headers at column 0, e.g. "# Layer 1 — Identity".
  // Captures level 1 only; embedded H2+ are part of the parent
  // section's content.
  const lines = body.split('\n');
  let currentHeader: string | null = null;
  let buf: string[] = [];
  const commit = () => {
    if (currentHeader !== null) {
      out[currentHeader] = buf.join('\n').trim();
    }
  };
  for (const line of lines) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) {
      commit();
      currentHeader = m[1] ?? null;
      buf = [];
    } else if (currentHeader !== null) {
      buf.push(line);
    }
  }
  commit();
  return out;
}
