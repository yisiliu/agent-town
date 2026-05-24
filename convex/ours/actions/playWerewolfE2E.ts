'use node';

/**
 * Headless end-to-end werewolf game driver — dev-only internalAction.
 *
 * Replicates the EXACT per-turn path from
 *   convex/ours/actions/interactionTakeTurn.ts (lines 113-206)
 * using the same:
 *   - prompt builders:  plugin.buildSystemPrompt / plugin.buildUserPrompt
 *   - callType:         'interaction_turn'  (→ tier = LOCAL → model = deepseek-v4-flash)
 *   - maxTokens:        OUTPUT_TOKEN_CAPS['interaction_turn'] = 4500
 *   - parse fn:         plugin.parseTurnText(rawText, plan.kind, { aliveIds })
 *   - parse fallback:   kind='abstain' text='(no response: ...)' when parse fails
 *   - self-explode:     overrides kind to 'self-explode' when data.self_explode===true
 *   - sheriff-claim:    clears sayField when data.run !== true (警下 silence)
 *
 * Participant setup: SYNTHETIC (no DB rows).
 * buildSystemPrompt needs: actorTwinId, cardMarkdown (string), aliveNames (Record).
 * buildUserPrompt needs: actorTwinId, aliveNames (Record).
 * The live path sources these from DB twins rows (pseudonym + cardMarkdown).
 * Here we synthesise fake twin IDs using the same ID-length strings Convex uses,
 * supply simple P0..Pn names as pseudonyms, and empty cardMarkdown ("").
 * This is faithful because:
 *   - The ID string is only used as a Record key lookup — the format is irrelevant
 *     to the game-logic and prompt-building code.
 *   - cardMarkdown is passed into <UNTRUSTED_CARD> in the system prompt; an empty
 *     card is valid (produces a blank block, no crash).
 *   - The game-logic functions (rules.ts) only use participant IDs as keys in
 *     roles/alive/etc. — they make no DB lookups.
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import '../interactions/werewolf'; // register the plugin
import { getPlugin } from '../interactions/gameRegistry';
import { callDeepseekAPI } from '../lib/deepseekClient';
import { OUTPUT_TOKEN_CAPS, LOCAL_MODEL } from '../lib/llmRouterCore';

// ---------------------------------------------------------------------------
// Synthetic participant IDs — Convex IDs are base64url strings of ~22 chars.
// We use zero-padded hex strings of 22 chars so they are distinct, stable,
// and pass the ID-as-string usage in rules/prompts.
// ---------------------------------------------------------------------------
function makeFakeId(i: number): Id<'twins'> {
  const hex = i.toString(16).padStart(22, '0');
  return hex as unknown as Id<'twins'>;
}

// ---------------------------------------------------------------------------
// Transcript entry recorded per turn
// ---------------------------------------------------------------------------
interface TurnEntry {
  i: number;
  day: number;
  phase: string;
  actor: string | null;
  callType: 'interaction_turn' | 'system';
  rawText: string; // first 200 chars, or '' for system turns
  emptyContent: boolean;
  parsedOk: boolean;
  parsedAction: unknown;
}

export default internalAction({
  args: {
    numPlayers: v.number(),
    seed: v.optional(v.number()),
    maxLlmTurns: v.optional(v.number()),
  },
  handler: async (_ctx, args): Promise<{
    numPlayers: number;
    winner: string | undefined;
    finalDay: number;
    totalTurns: number;
    llmTurns: number;
    emptyContentCount: number;
    parseFailCount: number;
    stalled: boolean;
    crashError?: string;
    transcript: TurnEntry[];
  }> => {
    const { numPlayers, seed = 42, maxLlmTurns } = args;
    const SAFETY_CAP = 500;

    const plugin = getPlugin('werewolf');
    if (!plugin) throw new Error('werewolf plugin not registered');

    // --- Participant setup --------------------------------------------------
    // Synthesise participant IDs and name map. No DB interaction required;
    // see module-level comment for faithfulness reasoning.
    const participants: Id<'twins'>[] = [];
    const aliveNames: Record<string, string> = {};
    const cardMarkdownMap: Record<string, string> = {};
    for (let i = 0; i < numPlayers; i++) {
      const id = makeFakeId(i);
      participants.push(id);
      aliveNames[id as unknown as string] = `P${i}`;
      cardMarkdownMap[id as unknown as string] = '';
    }

    // --- Game state init ----------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let state: any = plugin.initialState(participants, seed);

    // In-memory turn history — mirrors what interactionTakeTurn reads from
    // `interactionTurns` DB rows (phase, kind, text, actorTwinId) for the
    // visibleTurns filter.
    const turnHistory: Array<{
      phase: string;
      kind: string;
      text: string;
      actorTwinId: Id<'twins'> | null;
      visibility: 'public' | Id<'twins'>[];
    }> = [];

    const transcript: TurnEntry[] = [];
    let llmTurns = 0;
    let emptyContentCount = 0;
    let parseFailCount = 0;
    let stalled = false;
    let crashError: string | undefined;
    const maxTokens = OUTPUT_TOKEN_CAPS['interaction_turn']; // 4500
    const model = LOCAL_MODEL; // deepseek-v4-flash (interaction_turn → local tier)

    // --- Main loop ----------------------------------------------------------
    for (let i = 0; i < SAFETY_CAP; i++) {
      if (state.phase === 'ended') break;
      if (maxLlmTurns !== undefined && llmTurns >= maxLlmTurns) break;

      try {
      const plan = plugin.planNextTurn(state);
      if (!plan) break;

      // ---- SYSTEM turn (no LLM) ------------------------------------------
      if (plan.actorTwinId === null) {
        const entry: TurnEntry = {
          i,
          day: state.day as number,
          phase: plan.phase,
          actor: null,
          callType: 'system',
          rawText: '',
          emptyContent: false,
          parsedOk: true,
          parsedAction: plan.systemText ?? '(system)',
        };
        transcript.push(entry);

        turnHistory.push({
          phase: plan.phase,
          kind: plan.kind,
          text: plan.systemText ?? '(system)',
          actorTwinId: null,
          visibility: plan.visibility,
        });

        state = plugin.applyTurn(state, {
          phase: plan.phase,
          kind: plan.kind,
          actorTwinId: null,
          text: plan.systemText,
          data: undefined,
        });
        continue;
      }

      // ---- ACTOR turn (LLM path) -----------------------------------------
      const actorId = plan.actorTwinId;
      const actorKey = actorId as unknown as string;
      const actorName = aliveNames[actorKey] ?? actorKey;

      // Build visibleTurns — same filter as interactionTakeTurn.ts:120-130
      function isVisibleTo(
        visibility: 'public' | Id<'twins'>[],
        actor: Id<'twins'>,
      ): boolean {
        return visibility === 'public' || visibility.includes(actor);
      }
      const visibleTurns = turnHistory
        .filter((t) => isVisibleTo(t.visibility, actorId))
        .map((t) => ({
          phase: t.phase,
          kind: t.kind,
          text: t.text,
          actorTwinId: t.actorTwinId,
        }));

      // Build prompts — same calls as interactionTakeTurn.ts:132-145
      const systemPrompt = plugin.buildSystemPrompt({
        state,
        actorTwinId: actorId,
        cardMarkdown: cardMarkdownMap[actorKey] ?? '',
        aliveNames,
      });
      const userPrompt = plugin.buildUserPrompt({
        state,
        actorTwinId: actorId,
        phase: plan.phase,
        kind: plan.kind,
        visibleTurns,
        aliveNames,
      });

      // Call LLM — same path as interactionTakeTurn.ts:150-161
      // callType='interaction_turn' → tierFor() returns 'local' → model=LOCAL_MODEL
      // maxTokens=OUTPUT_TOKEN_CAPS['interaction_turn']=4500
      // Deviation note: the live path uses the full routeLLMCall() which adds
      // idempotency cache + daily spend tracking. Here we call callDeepseekAPI
      // directly (same underlying function wired to both callFrontier and
      // callLocal in llmRouter). Cache and spend tracking are omitted because:
      // (a) there is no Convex DB context available to a headless driver
      //     without inserting real rows, and (b) this is a one-shot dev tool
      //     not subject to the daily spend cap. The LLM call itself (model,
      //     maxTokens, system, messages) is bit-for-bit identical.
      llmTurns++;
      let rawText = '';
      try {
        const result = await callDeepseekAPI({
          model,
          maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });
        rawText = result.text;
      } catch (e) {
        // LLM call failed — treat as abstain (same as interactionTakeTurn.ts:158-161)
        rawText = '';
      }

      const emptyContent = rawText.trim().length === 0;
      if (emptyContent) emptyContentCount++;

      // Parse — same call as interactionTakeTurn.ts:165-167
      const aliveIds = (state as { alive: Id<'twins'>[] }).alive;
      const parsed = rawText
        ? plugin.parseTurnText(rawText, plan.kind, { aliveIds })
        : { ok: false as const, error: 'empty LLM response' };

      // Build appendArgs — same logic as interactionTakeTurn.ts:169-206
      let appendKind: string;
      let appendText: string;
      let appendData: unknown;

      if (parsed.ok) {
        const d = (parsed.data as Record<string, unknown>) ?? {};
        let sayField = typeof d.say === 'string' ? d.say : '';
        // 警下 silence — same as interactionTakeTurn.ts:186-188
        if (plan.phase === 'sheriff-claim' && plan.kind === 'sheriff-claim' && d.run !== true) {
          sayField = '';
        }
        // 自爆 override — same as interactionTakeTurn.ts:192-198
        const isSelfExplode = d.self_explode === true;
        appendKind = isSelfExplode ? 'self-explode' : plan.kind;
        appendText = isSelfExplode ? (sayField || '我自爆！') : sayField;
        appendData = d;
      } else {
        // Parse failure → abstain (same as interactionTakeTurn.ts:200-205)
        parseFailCount++;
        appendKind = 'abstain';
        appendText = `(no response: ${parsed.error ?? 'parse failed'})`;
        appendData = undefined;
      }

      transcript.push({
        i,
        day: state.day as number,
        phase: plan.phase,
        actor: actorName,
        callType: 'interaction_turn',
        rawText: rawText.slice(0, 200),
        emptyContent,
        parsedOk: parsed.ok,
        parsedAction: parsed.ok
          ? (parsed.data as Record<string, unknown>)?.action ?? parsed.data
          : appendData,
      });

      // Record in history for future visibleTurns filters
      turnHistory.push({
        phase: plan.phase,
        kind: appendKind,
        text: appendText,
        actorTwinId: actorId,
        visibility: plan.visibility,
      });

      // Apply turn
      state = plugin.applyTurn(state, {
        phase: plan.phase,
        kind: appendKind,
        actorTwinId: actorId,
        text: appendText,
        data: appendData as Record<string, unknown> | undefined,
      });
      } catch (e) {
        crashError = `crash at i${i} phase=${(state as { phase?: string })?.phase}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`;
        break;
      }
    }

    if (state.phase !== 'ended') {
      stalled = true;
    }

    return {
      numPlayers,
      winner: (state as { winner?: string }).winner,
      finalDay: (state as { day: number }).day,
      totalTurns: transcript.length,
      llmTurns,
      emptyContentCount,
      parseFailCount,
      stalled,
      crashError,
      transcript,
    };
  },
});
