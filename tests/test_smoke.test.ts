import { describe, it, expect } from 'vitest';
import root from '../package.json';

describe('monorepo', () => {
  it('has three workspaces', () => {
    expect(root.workspaces).toContain('shell');
    expect(root.workspaces).toContain('ai-town-fork');
    expect(root.workspaces).toContain('convex');
  });
});
