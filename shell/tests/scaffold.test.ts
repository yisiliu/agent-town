import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

describe('shell scaffold', () => {
  it('package.json declares Next.js 16 + React 19 + Tailwind v4', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    expect(pkg.dependencies?.next).toMatch(/^\^?16\./);
    expect(pkg.dependencies?.react).toMatch(/^\^?19\./);
    expect(pkg.dependencies?.['react-dom']).toMatch(/^\^?19\./);
    expect(pkg.devDependencies?.tailwindcss).toMatch(/^\^?4\./);
    expect(pkg.devDependencies?.['@tailwindcss/postcss']).toMatch(/^\^?4\./);
  });

  it('exposes the App Router entry points', () => {
    expect(existsSync(join(root, 'src/app/layout.tsx'))).toBe(true);
    expect(existsSync(join(root, 'src/app/page.tsx'))).toBe(true);
    expect(existsSync(join(root, 'src/app/globals.css'))).toBe(true);
  });

  it('Tailwind v4 lives in CSS, not a config file', () => {
    // Tailwind v4 moved configuration into the stylesheet itself
    // (`@theme {...}` directive) — there should be no tailwind.config.ts.
    expect(existsSync(join(root, 'tailwind.config.ts'))).toBe(false);
    expect(existsSync(join(root, 'tailwind.config.js'))).toBe(false);
    const css = readFileSync(join(root, 'src/app/globals.css'), 'utf-8');
    expect(css).toMatch(/@import\s+["']tailwindcss["']/);
  });

  it('has its own tsconfig that targets the Next.js plugin', () => {
    const tsconfig = JSON.parse(
      readFileSync(join(root, 'tsconfig.json'), 'utf-8'),
    );
    // Next.js 16 normalizes jsx to "react-jsx" on first `next build` — the
    // automatic-runtime setting it actually needs.
    expect(['react-jsx', 'preserve']).toContain(tsconfig.compilerOptions?.jsx);
    const pluginNames = (tsconfig.compilerOptions?.plugins ?? []).map(
      (p: { name?: string }) => p.name,
    );
    expect(pluginNames).toContain('next');
  });

  it('next.config.ts exists', () => {
    expect(existsSync(join(root, 'next.config.ts'))).toBe(true);
  });
});
