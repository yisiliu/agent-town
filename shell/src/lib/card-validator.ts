import { parse as parseYAML, YAMLParseError } from 'yaml';

// Server-side card.md validator. Mirrors `distill validate` from Plan 1
// (the Pydantic CardFrontmatter schema) but in TypeScript and lighter:
// no LLM/PII passes here — those are async Convex actions (Task 9).
//
// The validator is pure: input string → discriminated result. No I/O.

export const REGISTERS = [
  'personal',
  'professional',
  'narrative_fiction',
  'roleplay',
] as const;
export type Register = (typeof REGISTERS)[number];

export const LANGUAGES = ['zh', 'en', 'mixed'] as const;
export type Language = (typeof LANGUAGES)[number];

// See convex/ours/lib/cardValidator.ts for the canonical comment —
// this file MUST stay in sync.
export const FAMILIES = [
  'self',
  'colleague',
  'relationship',
  'celebrity',
] as const;
export type Family = (typeof FAMILIES)[number];

// KEEP IN SYNC with convex/ours/lib/cardValidator.ts. Relaxed 2026-05 to
// match /spec page: only `pseudonym` mandatory; unknown keys tolerated.
export const ALLOWED_FRONTMATTER_KEYS = [
  'pseudonym',
  'intro',
  'real_name_hash',
  'plane',
  'family',
  'schema_version',
  'created',
  'register',
  'language',
  'source_stats',
] as const;

export const REQUIRED_FRONTMATTER_KEYS = ['pseudonym'] as const;

export const REQUIRED_SECTIONS = [] as const;

// Dropped in 2026-05 — see cardValidator.ts mirror for reasoning.
export const SECTION_LENGTH_CAPS: Record<string, number> = {};

function canonicaliseSection(s: string): string {
  return s.replace(/’/g, "'");
}

export interface CardFrontmatter {
  pseudonym: string;
  real_name_hash: string;
  plane: string;
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
  // Lenient: extra frontmatter keys tolerated. See cardValidator.ts mirror.
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
  // ATX-style headers at column 0, e.g. "# Voice". Captures level 1 only —
  // the schema uses a flat list of H1 sections and embedded H2+ would be
  // unusual; if a card ships an H2 we ignore it for cap purposes.
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
