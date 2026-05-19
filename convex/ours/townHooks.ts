// Spec §3.2 — gate ai-town's tick loop on our worldState. Lives under
// ai-town-fork/convex/ours/ which the additivity gate exempts from its
// unauthorized-new-file check, so this file can coexist with the
// upstream fork without tripping CI. The corresponding edit in
// aiTown/main.ts is itself pre-authorized via an EXEMPT annotation in
// UPSTREAM_FILES.txt (see plan Task 14 Step 2).
//
// Cross-tree contract: this file runs inside ai-town's deploy surface,
// but the worldState row lives in OUR additive schema. After Task 13's
// schema lands, both surfaces share the same Convex deployment via the
// schema composition at /convex/schema.ts. Until then, the try/catch
// here keeps ai-town running unmodified if our query path can't
// resolve (defensive default: allow tick).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionCtxLike = { runQuery: (ref: any, args?: any) => Promise<any> };

interface WorldStatusShape {
  state: 'live' | 'frozen';
  nextChange: number | null;
}

// Pure predicate — extracted so the gating semantics are testable
// without a Convex runtime. The "no row" case maps to allow-tick: a
// fresh deploy with no sessions configured behaves like upstream.
export function isTickAllowedFor(status: WorldStatusShape | null): boolean {
  if (!status) return true;
  return status.state === 'live';
}

export async function isTownTickAllowed(ctx: ActionCtxLike): Promise<boolean> {
  try {
    const status = (await ctx.runQuery(
      'ours/queries/worldStatus:default',
      {},
    )) as WorldStatusShape | null;
    return isTickAllowedFor(status);
  } catch {
    // worldStatus query not resolvable in this deployment surface —
    // fall back to upstream behavior (always tick). Avoids breaking
    // ai-town in isolation if the schema composition hasn't landed.
    return true;
  }
}
