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

// Relaxed in 2026-05 to match the /spec page handed to students:
// only `pseudonym` is mandatory; everything else (intro, distill-twin
// Layer 0-5 fields, plane/register/etc) is optional. Unknown keys are
// no longer rejected so students can add `intro` and any custom fields
// without hitting an `unknown_frontmatter_key` error. distill-twin
// output still validates — it just isn't required.
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

// No structural section requirements. distill-twin output still passes;
// freeform Markdown bodies also pass. Length caps below stay (they only
// fire when a matching section name is present, so freeform bodies are
// unaffected).
export const REQUIRED_SECTIONS = [] as const;

// Dropped per-section caps in the 2026-05 lenient pass. The 5MB total
// payload cap in uploadTwin.ts is the only hard limit now — per-section
// micro-caps were rejecting distill-twin output that was 49 chars over
// (the user's first upload after the relax pass). Keep the export as
// an empty record so the consuming loop stays a no-op without removing it.
export const SECTION_LENGTH_CAPS: Record<string, number> = {};

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
  // Lenient: extra frontmatter keys are tolerated. Students/AIs often add
  // their own fields (e.g. `tone:`, `voice:`) and that shouldn't block upload.
  // ALLOWED_FRONTMATTER_KEYS is still exported for documentation purposes.
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
