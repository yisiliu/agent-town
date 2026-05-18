import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// ai-town-fork ships its own jest test suite; running them through vitest
// would falsely fail (different runner, different config). Our tests live
// under tests/ (smoke + future cross-workspace), convex/tests/, and
// shell/tests/. The shell workspace will land in Task 7+.
//
// resolve.alias maps the virtual 'ai-town/upstream' module to the real
// upstream schema file. The matching .d.ts shim at convex/types/upstream.d.ts
// gives tsc a loose type so it doesn't descend into ai-town-fork's tree
// (which lives under its own tsconfig).
export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.ts',
      'convex/tests/**/*.test.ts',
      'shell/tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', 'ai-town-fork/**'],
  },
  resolve: {
    alias: {
      'ai-town/upstream': fileURLToPath(
        new URL('./ai-town-fork/convex/schema.ts', import.meta.url),
      ),
    },
  },
});
