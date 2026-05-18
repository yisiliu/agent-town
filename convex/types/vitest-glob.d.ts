// Minimal ambient typing for Vite/Vitest's `import.meta.glob`. We use it
// only in tests (convex-test wants a module map). Pulling the full
// `vite/client` reference would require vite as a root dep just for this
// one shape — not worth it.
interface ImportMeta {
  glob(pattern: string): Record<string, () => Promise<unknown>>;
}
