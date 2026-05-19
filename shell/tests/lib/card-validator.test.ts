import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  validateCard,
  SECTION_LENGTH_CAPS,
  REQUIRED_SECTIONS,
  ALLOWED_FRONTMATTER_KEYS,
  REQUIRED_FRONTMATTER_KEYS,
  REGISTERS,
  LANGUAGES,
} from '../../src/lib/card-validator';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', 'fixtures', 'cards');

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, `${name}.md`), 'utf-8');
}

describe('validateCard — allowlist + structure', () => {
  it('valid.md passes', () => {
    const r = validateCard(loadFixture('valid'));
    expect(r.ok, r.ok ? '' : JSON.stringify(r.errors)).toBe(true);
    if (r.ok) {
      expect(r.frontmatter.pseudonym).toBe('灯火');
      expect(r.frontmatter.register).toBe('personal');
      expect(r.frontmatter.language).toBe('zh');
      expect(r.frontmatter.schema_version).toBe(2);
    }
  });

  it('missing_section.md fails with required-section errors', () => {
    const r = validateCard(loadFixture('missing_section'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const missing = r.errors.filter((e) => e.kind === 'missing_section');
      // missing_section.md has Layer 0, Layer 1, Worldview, and Example
      // exchanges; the other four Layers are missing.
      const presentInFixture = [
        'Layer 0 — Core personality',
        'Layer 1 — Identity',
        'Worldview principles',
        'Example exchanges',
      ];
      const expectedMissing = REQUIRED_SECTIONS.filter(
        (s) => !presentInFixture.includes(s),
      );
      expect(missing.map((e) => e.section).sort()).toEqual(
        expectedMissing.sort(),
      );
    }
  });

  it('bad_register.md fails with a register-enum error', () => {
    const r = validateCard(loadFixture('bad_register'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.find((e) => e.kind === 'invalid_enum' && e.key === 'register'),
      ).toBeDefined();
    }
  });

  it('unknown_frontmatter_key.md fails with an unknown-key error', () => {
    const r = validateCard(loadFixture('unknown_frontmatter_key'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const unknown = r.errors.find(
        (e) => e.kind === 'unknown_frontmatter_key',
      );
      expect(unknown?.key).toBe('favorite_color');
    }
  });
});

describe('validateCard — frontmatter required keys', () => {
  it('rejects missing pseudonym', () => {
    const base = loadFixture('valid');
    const stripped = base.replace(/^pseudonym: .*$/m, '');
    const r = validateCard(stripped);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.find(
          (e) =>
            e.kind === 'missing_required_frontmatter' && e.key === 'pseudonym',
        ),
      ).toBeDefined();
    }
  });

  it('exposes the full required-key set', () => {
    // Spec §4 enumerates: pseudonym, real_name_hash, plane, schema_version,
    // created, register, language. source_stats is optional.
    expect(REQUIRED_FRONTMATTER_KEYS).toEqual([
      'pseudonym',
      'real_name_hash',
      'plane',
      'schema_version',
      'created',
      'register',
      'language',
    ]);
    for (const req of REQUIRED_FRONTMATTER_KEYS) {
      expect(ALLOWED_FRONTMATTER_KEYS).toContain(req);
    }
  });
});

describe('validateCard — section length caps', () => {
  it('flags a section that exceeds its cap', () => {
    const base = loadFixture('valid');
    // Layer 1 — Identity cap is 2000 chars. Pad past it.
    const overflow = 'X '.repeat(1200);
    const oversized = base.replace(
      '# Layer 1 — Identity\n\n一个内向',
      `# Layer 1 — Identity\n\n${overflow}一个内向`,
    );
    const r = validateCard(oversized);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const tooLong = r.errors.find(
        (e) =>
          e.kind === 'section_too_long' &&
          e.section === 'Layer 1 — Identity',
      );
      expect(tooLong).toBeDefined();
    }
  });

  it('exposes per-section caps for every required section', () => {
    for (const sec of REQUIRED_SECTIONS) {
      expect(SECTION_LENGTH_CAPS[sec]).toBeTypeOf('number');
      expect(SECTION_LENGTH_CAPS[sec]).toBeGreaterThan(0);
    }
  });
});

describe('validateCard — language and register enums', () => {
  it('exposes the spec-mandated enum values', () => {
    expect(REGISTERS.slice().sort()).toEqual(
      ['narrative_fiction', 'personal', 'professional', 'roleplay'].sort(),
    );
    expect(LANGUAGES.slice().sort()).toEqual(['en', 'mixed', 'zh'].sort());
  });

  it('rejects a non-allowlisted language', () => {
    const base = loadFixture('valid');
    const r = validateCard(base.replace('language: zh', 'language: fr'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.find(
          (e) => e.kind === 'invalid_enum' && e.key === 'language',
        ),
      ).toBeDefined();
    }
  });
});

describe('validateCard — no frontmatter', () => {
  it('fails cleanly when the YAML block is absent', () => {
    const r = validateCard('# System prompt\n\nNo frontmatter here.');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.kind === 'no_frontmatter')).toBeDefined();
    }
  });

  it('fails cleanly on malformed YAML', () => {
    const r = validateCard('---\npseudonym: [unbalanced\n---\n# System prompt');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.kind === 'yaml_parse_error')).toBeDefined();
    }
  });
});
