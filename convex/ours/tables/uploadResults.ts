import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Short-lived bridge from finalizeScan back to the upload UI. Each
// upload returns an opaque uploadSessionToken; finalizeScan writes the
// outcome (codes on pass, error reasons on block) keyed by this token;
// the UI's reactive query reads it; user confirms "I've saved these
// codes"; clearUploadResult deletes the row. The plaintext codes
// therefore only exist in this table for the seconds between scan
// completion and user confirmation.
export const uploadResults = defineTable({
  uploadSessionToken: v.string(),
  twinId: v.id('twins'),
  state: v.union(
    v.literal('pending'),
    v.literal('active'),
    v.literal('rejected'),
  ),
  // Present iff state === 'active'. Plaintext six-digit codes for the
  // three scopes. Consumed-once via clearUploadResult.
  codes: v.optional(
    v.object({
      spectate: v.string(),
      control: v.string(),
      edit: v.string(),
    }),
  ),
  // Present iff state === 'rejected'. Human-readable error reasons
  // surfaced from piiScan/promptInjectionScan/validator.
  errors: v.optional(v.array(v.string())),
  createdAt: v.number(),
  expiresAt: v.number(),
})
  .index('uploadSessionToken', ['uploadSessionToken'])
  .index('twinId', ['twinId'])
  .index('expiresAt', ['expiresAt']);
