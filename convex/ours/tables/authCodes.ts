import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// One row per (twinId, scope) — the issueCodeFor helper enforces uniqueness
// at write time (Convex schema has no unique constraint). Scopes split
// student access: spectate watches the world, control authorizes retraction
// and digest approval, edit re-uploads card.md.
export const authCodes = defineTable({
  twinId: v.id('twins'),
  scope: v.union(
    v.literal('spectate'),
    v.literal('control'),
    v.literal('edit'),
  ),
  hash: v.string(),
  issuedAt: v.number(),
  reissueCountThisSemester: v.number(),
})
  .index('twin_scope', ['twinId', 'scope'])
  .index('twinId', ['twinId']);
