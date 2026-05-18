import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// One row per instructor account. v1 deploys with a single instructor
// per cohort, but the schema admits multiple so TA delegation (deferred
// to v2) can land without migration.
export const instructors = defineTable({
  username: v.string(),
  displayName: v.string(),
  createdAt: v.number(),
})
  .index('username', ['username']);
