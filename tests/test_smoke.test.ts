import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import root from '../package.json';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('monorepo', () => {
  it('has three workspaces', () => {
    expect(root.workspaces).toContain('shell');
    expect(root.workspaces).toContain('ai-town-fork');
    expect(root.workspaces).toContain('convex');
  });

  it('has three workspace directories', () => {
    expect(existsSync(join(__dirname, '..', 'shell', 'package.json'))).toBe(true);
    expect(existsSync(join(__dirname, '..', 'ai-town-fork', 'package.json'))).toBe(true);
    expect(existsSync(join(__dirname, '..', 'convex', 'package.json'))).toBe(true);
  });
});
