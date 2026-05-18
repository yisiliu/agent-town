// Module shim for the unmodified ai-town upstream schema.
//
// The actual file lives at ../ai-town-fork/convex/schema.ts, pinned by the
// Task 2 additivity gate. ai-town-fork has its own tsconfig (less strict
// than ours: no noUncheckedIndexedAccess, allowImportingTsExtensions, JSX).
// If our root tsc descends into that tree it surfaces upstream-only
// errors that have nothing to do with our code.
//
// Routing the import through a virtual module name "ai-town/upstream"
// lets tsc resolve via this declaration (loose type — opaque tables map)
// while vitest's resolve.alias resolves the same name to the real file
// at runtime. Identity-check still works because both schema.ts and the
// test import from the same alias, so they share the runtime module.
declare module 'ai-town/upstream' {
  const schema: { tables: Record<string, unknown> };
  export default schema;
}
