import { describe, it, expect } from 'vitest';
import schema from '../schema';
// Tests resolve via the same 'ai-town/upstream' alias schema.ts uses, so
// the identity check below verifies real reference sharing through the
// alias-resolved module.
import upstream from 'ai-town/upstream';

// Includes the 14 tables listed in Task 3 plus `authCodes` added in Task 4
// (the plan listed it as `auth.codes` in Task 4 prose but missed it from
// the Task 3 enumeration; bookkeeping resolved here so future tasks that
// add tables update the same enumeration).
const OUR_TABLES = [
  'twins',
  'cards',
  'consents',
  'objects',
  'games',
  'gameTurns',
  'noticeboard',
  'digests',
  'retractions',
  'auditLog',
  'reflections',
  'rateLimits',
  'llmCallIdempotency',
  'crossBorderTransfers',
  'authCodes',
] as const;

type Tables = Record<string, { [' indexes'](): { indexDescriptor: string; fields: string[] }[] }>;

function indexes(t: Tables, name: string) {
  const table = t[name];
  if (!table) throw new Error(`table ${name} not in schema`);
  return table[' indexes']();
}

describe('convex schema', () => {
  it('exports a SchemaDefinition with a tables map', () => {
    expect(schema.tables).toBeDefined();
    expect(typeof schema.tables).toBe('object');
  });

  describe('our additive tables', () => {
    for (const name of OUR_TABLES) {
      it(`includes ${name}`, () => {
        expect(schema.tables).toHaveProperty(name);
      });
    }
  });

  describe('ai-town tables preserved untouched', () => {
    const upstreamNames = Object.keys(upstream.tables);
    it('upstream schema has tables to preserve', () => {
      expect(upstreamNames.length).toBeGreaterThan(0);
    });
    for (const name of Object.keys(upstream.tables)) {
      it(`re-exports upstream table ${name} by identity`, () => {
        const ours = (schema.tables as Record<string, unknown>)[name];
        const theirs = (upstream.tables as Record<string, unknown>)[name];
        expect(ours).toBe(theirs);
      });
    }
  });

  describe('required indexes', () => {
    it('twins.pseudonym index on [pseudonym]', () => {
      const ix = indexes(schema.tables as unknown as Tables, 'twins');
      const found = ix.find((i) => i.indexDescriptor === 'pseudonym');
      expect(found).toBeDefined();
      expect(found?.fields).toEqual(['pseudonym']);
    });

    it('auditLog.timestamp index on [timestamp]', () => {
      const ix = indexes(schema.tables as unknown as Tables, 'auditLog');
      const found = ix.find((i) => i.indexDescriptor === 'timestamp');
      expect(found).toBeDefined();
      expect(found?.fields).toEqual(['timestamp']);
    });

    it('rateLimits has a composite (multi-field) index', () => {
      const ix = indexes(schema.tables as unknown as Tables, 'rateLimits');
      const composite = ix.find((i) => i.fields.length >= 2);
      expect(composite).toBeDefined();
    });
  });
});
