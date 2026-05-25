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
        await ctx.runMutation(ref.ours.mutations.setInteractionInflight.default, {
          interactionId: args.interactionId,
          inflightSince: Date.now(),
        });
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
      // parsed.data already has {thinking, say?, target?, use_save?, poison_target?, self_explode?}.
      // turn.text is the PUBLIC `say` (visible to other agents per visibility
      // rules); turn.data carries everything including the private `thinking`.
      const d = (parsed.data as Record<string, unknown>) ?? {};
      let sayField = typeof d.say === 'string' ? d.say : '';
      // 警下 silence: in sheriff-claim phase, a player who decides NOT to
      // run shouldn't broadcast a speech to other players. The rules-side
      // applyTurn already advances the cursor based on `data.run`; we
      // just clear the public text so the transcript stays quiet for
      // non-candidates. The final tally line (单独上警 / 全员上警 / 无人上警)
      // gets pushed to publicLog by the rules handler.
      if (plan.phase === 'sheriff-claim' && plan.kind === 'sheriff-claim' && d.run !== true) {
        sayField = '';
      }
      // Silent voting: vote turns (lynch / sheriff-election / PK revote) emit
      // only a private thinking + their target — no public 发言. The vote
      // target still flows into pendingVotes via turn.data unchanged. (PK
      // *speech* kinds stay public; they're speeches, not votes.)
      if (
        plan.kind === 'vote' ||
        plan.kind === 'sheriff-vote' ||
        plan.kind === 'sheriff-pk-vote' ||
        plan.kind === 'day-pk-vote'
      ) {
        sayField = '';
      }
      // 自爆 override — if the wolf returned self_explode:true, the parser
      // already filtered to wolf-eligible phases. Write a 'self-explode'
      // turn (visibility=public) regardless of the original plan kind.
      const isSelfExplode = d.self_explode === true;
      appendArgs = {
        kind: isSelfExplode ? 'self-explode' : plan.kind,
        text: isSelfExplode
          ? (sayField || '我自爆！')
          : sayField,
        data: d,
      };
    } else {
      appendArgs = {
        kind: 'abstain',
        text: `(no response: ${parsed.error ?? 'parse failed'})`,
        data: undefined,
      };
    }

    const appendRes = (await ctx.runMutation(
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

    // Drop on stale_turnIndex — DO NOT retry with the old plan against the
    // new turnIndex. The first live game showed that pattern produces
    // same-actor consecutive turns (the retry committed the prior actor's
    // LLM output at the next cursor). The cron heartbeat will re-pick
    // this interaction up cleanly with a fresh plan.
    if (!appendRes.applied) {
      console.warn(
        'interactionTakeTurn dropped turn',
        appendRes.reason,
        'for',
        args.interactionId,
      );
      return { status: 'dropped' as const, reason: appendRes.reason };
    }

    if (!appendRes.ended && chainCount + 1 < MAX_CHAIN) {
      // Set inflightSince BEFORE scheduling so the cron's dedup gate also
      // covers chain-self-scheduled runs. (The previous appendInteractionTurn
      // call cleared it; we reclaim it here for the next chain link.)
      await ctx.runMutation(ref.ours.mutations.setInteractionInflight.default, {
        interactionId: args.interactionId,
        inflightSince: Date.now(),
      });
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
