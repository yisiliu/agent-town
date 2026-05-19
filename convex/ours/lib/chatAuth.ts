import { verifyCodeHash } from './codes';

export interface ChatTwinCandidate {
  twinId: string;
  state: string;
  controlHash: string | null;
  cardMarkdown: string | null;
}

export interface AuthenticatedTwin {
  twinId: string;
  cardMarkdown: string;
}

export type ChatAuthFailure =
  | 'unknown_pseudonym'
  | 'twin_not_active'
  | 'bad_code';

// Iterates over twins matching a pseudonym and returns the first one
// whose control-scope hash bcrypt-verifies against the supplied
// plaintext. Pseudonym is not a DB-level unique constraint, so we
// tolerate duplicates and pick the one whose code you actually
// possess — which is also the right semantic.
//
// Caller MUST run this in a Node action runtime — bcryptjs's compare
// uses setTimeout, which Convex's V8 isolate forbids.
export async function findMatchingTwin(
  candidates: ChatTwinCandidate[],
  plaintextCode: string,
): Promise<AuthenticatedTwin | { failure: ChatAuthFailure }> {
  if (candidates.length === 0) return { failure: 'unknown_pseudonym' };
  let sawActive = false;
  for (const cand of candidates) {
    if (cand.state !== 'active') continue;
    sawActive = true;
    if (!cand.controlHash || !cand.cardMarkdown) continue;
    if (await verifyCodeHash(plaintextCode, cand.controlHash)) {
      return { twinId: cand.twinId, cardMarkdown: cand.cardMarkdown };
    }
  }
  return { failure: sawActive ? 'bad_code' : 'twin_not_active' };
}
