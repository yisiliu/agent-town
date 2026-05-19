'use node';

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import { getPlugin } from '../interactions/gameRegistry';
import '../interactions/werewolf'; // self-register

// Drives one turn for one interaction:
// 1. Load interaction + participants + prior turns.
// 2. Compute plan = plugin.planNextTurn(state).
// 3. If system turn → call appendInteractionTurn with systemText (no LLM).
// 4. Else → build prompts, call llmRouter, parse, call appendInteractionTurn.
//    Parse failure → write an 'abstain' turn so the phase machine advances.
// 5. Stale turnIndex → retry once (re-read + re-plan), then give up; cron
//    picks it up on the next heartbeat.
// 6. On success + !ended + chainCount < 5: self-schedule another invocation
//    at +2s. Otherwise yield to cron. Caps games at ~10s/turn × ~30 turns
//    ≈ ~5min wall clock if everything is hot.

const MAX_CHAIN = 5;
const CHAIN_DELAY_MS = 2_000;

type Visibility = 'public' | Id<'twins'>[];

function isVisibleTo(visibility: Visibility, actor: Id<'twins'>): boolean {
  return visibility === 'public' || visibility.includes(actor);
}

export default internalAction({
  args: {
    interactionId: v.id('interactions'),
    chainCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    const chainCount = args.chainCount ?? 0;

    const ctxData = (await ctx.runQuery(
      ref.ours.queries.getInteractionContext.default,
      { interactionId: args.interactionId },
    )) as {
      interaction: Doc<'interactions'>;
      twins: Array<{ twinId: Id<'twins'>; pseudonym: string; cardMarkdown: string }>;
      turns: Doc<'interactionTurns'>[];
    } | null;

    if (!ctxData) {
      return { status: 'no_interaction' as const };
    }
    if (ctxData.interaction.status !== 'in_progress') {
      await ctx.runMutation(ref.ours.mutations.setInteractionInflight.default, {
        interactionId: args.interactionId,
        inflightSince: null,
      });
      return { status: 'not_in_progress' as const };
    }

    const plugin = getPlugin(ctxData.interaction.type);
    if (!plugin) {
      await ctx.runMutation(ref.ours.mutations.setInteractionInflight.default, {
        interactionId: args.interactionId,
        inflightSince: null,
      });
      return { status: 'no_plugin' as const };
    }

    const plan = plugin.planNextTurn(ctxData.interaction.state);
    if (!plan) {
      await ctx.runMutation(ref.ours.mutations.setInteractionInflight.default, {
        interactionId: args.interactionId,
        inflightSince: null,
      });
      return { status: 'no_plan' as const };
    }

    const aliveNames: Record<string, string> = {};
    for (const t of ctxData.twins) {
      aliveNames[t.twinId as unknown as string] = t.pseudonym;
    }

    // System turn — no LLM call.
    if (plan.actorTwinId === null) {
      const appendRes = (await ctx.runMutation(
        ref.ours.mutations.appendInteractionTurn.default,
        {
          interactionId: args.interactionId,
          expectedTurnIndex: ctxData.interaction.turnIndex,
          phase: plan.phase,
          kind: plan.kind,
          actorTwinId: undefined,
          text: plan.systemText ?? '(system)',
          data: undefined,
          visibility: plan.visibility,
        },
      )) as { applied: boolean; ended?: boolean };
      if (appendRes.applied && !appendRes.ended && chainCount + 1 < MAX_CHAIN) {
        await ctx.scheduler.runAfter(
          CHAIN_DELAY_MS,
          ref.ours.actions.interactionTakeTurn.default,
          { interactionId: args.interactionId, chainCount: chainCount + 1 },
        );
      }
      return { status: 'system_applied' as const, ended: appendRes.ended ?? false };
    }

    // Agent turn — LLM path.
    const actor = ctxData.twins.find((t) => t.twinId === plan.actorTwinId);
    if (!actor) {
      await ctx.runMutation(ref.ours.mutations.setInteractionInflight.default, {
        interactionId: args.interactionId,
        inflightSince: null,
      });
      return { status: 'actor_not_found' as const };
    }

    const visibleTurns = ctxData.turns
      .filter((t) => isVisibleTo(t.visibility as Visibility, plan.actorTwinId!))
      .map((t) => ({
        phase: t.phase,
        kind: t.kind,
        text: t.text,
        actorTwinId: (t.actorTwinId ?? null) as Id<'twins'> | null,
      }));

    const systemPrompt = plugin.buildSystemPrompt({
      state: ctxData.interaction.state,
      actorTwinId: plan.actorTwinId,
      cardMarkdown: actor.cardMarkdown,
      aliveNames,
    });
    const userPrompt = plugin.buildUserPrompt({
      state: ctxData.interaction.state,
      actorTwinId: plan.actorTwinId,
      phase: plan.phase,
      kind: plan.kind,
      visibleTurns,
      aliveNames,
    });

    const idempotencyKey = `interaction:${args.interactionId}:${ctxData.interaction.turnIndex}:${plan.actorTwinId}`;
    let llmResponse = '';
    try {
      const result = (await ctx.runAction(ref.ours.actions.llmRouter.default, {
        callType: 'interaction_turn',
        agentId: `interaction:${args.interactionId}:${plan.actorTwinId}`,
        systemPrompt,
        userMessages: [{ role: 'user' as const, content: userPrompt }],
        idempotencyKey,
      })) as { responseText: string };
      llmResponse = result.responseText;
    } catch (e) {
      // LLM call failed — treat as abstain so the game can progress.
      console.error('interactionTakeTurn LLM call failed', e);
    }

    // alive ids = participants still alive in state
    const aliveIds = (ctxData.interaction.state as { alive: Id<'twins'>[] }).alive;
    const parsed = llmResponse
      ? plugin.parseTurnText(llmResponse, plan.kind, { aliveIds })
      : { ok: false as const, error: 'empty LLM response' };

    let appendArgs: {
      kind: string;
      text: string;
      data?: unknown;
    };
    if (parsed.ok) {
      // Extract `reasoning` for `text`; data already validated.
      let reasoning = llmResponse;
      try {
        const obj = JSON.parse(
          llmResponse.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, ''),
        );
        if (typeof obj.reasoning === 'string') reasoning = obj.reasoning;
      } catch {
        // keep llmResponse as text
      }
      appendArgs = {
        kind: plan.kind,
        text: reasoning,
        data: parsed.data,
      };
    } else {
      appendArgs = {
        kind: 'abstain',
        text: `(no response: ${parsed.error ?? 'parse failed'})`,
        data: undefined,
      };
    }

    let appendRes = (await ctx.runMutation(
      ref.ours.mutations.appendInteractionTurn.default,
      {
        interactionId: args.interactionId,
        expectedTurnIndex: ctxData.interaction.turnIndex,
        phase: plan.phase,
        actorTwinId: plan.actorTwinId,
        visibility: plan.visibility,
        ...appendArgs,
      },
    )) as { applied: boolean; reason?: string; ended?: boolean };

    // Stale turnIndex — try once more after a re-read.
    if (!appendRes.applied && appendRes.reason === 'stale_turnIndex') {
      const fresh = (await ctx.runQuery(
        ref.ours.queries.getInteraction.default,
        { id: args.interactionId },
      )) as Doc<'interactions'> | null;
      if (fresh && fresh.status === 'in_progress') {
        appendRes = (await ctx.runMutation(
          ref.ours.mutations.appendInteractionTurn.default,
          {
            interactionId: args.interactionId,
            expectedTurnIndex: fresh.turnIndex,
            phase: plan.phase,
            actorTwinId: plan.actorTwinId,
            visibility: plan.visibility,
            ...appendArgs,
          },
        )) as { applied: boolean; reason?: string; ended?: boolean };
      }
    }

    if (appendRes.applied && !appendRes.ended && chainCount + 1 < MAX_CHAIN) {
      await ctx.scheduler.runAfter(
        CHAIN_DELAY_MS,
        ref.ours.actions.interactionTakeTurn.default,
        { interactionId: args.interactionId, chainCount: chainCount + 1 },
      );
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return {
      status: 'turn_applied' as const,
      ended: appendRes.ended ?? false,
      kind: appendArgs.kind,
    };
  },
});
