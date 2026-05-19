import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { callDeepseekAPI } from '../lib/deepseekClient';
import { LOCAL_MODEL } from '../lib/llmRouterCore';

// Generates N diverse personas via DeepSeek, then queues each as a
// createAgentInline input on the default world. The seed personas
// match ai-town's persona shape — name, character sprite slot,
// identity paragraph, behavioral plan — but are LLM-rolled instead
// of indexed against the static Descriptions array.
//
// Sprite slots: ai-town ships f1-f8 (female-ish) + p1-p3 (male-ish);
// see data/spritesheets/. We rotate through the available slots so
// agents render with different sprites even if the LLM picks
// duplicate names.

const SPRITE_SLOTS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'] as const;

const SEED_SYSTEM = `You generate a small cast of distinct fictional characters for a 2D town simulation. The town is small (a few dozen residents at most), and characters should feel grounded — they're not heroes or wizards, they're people with jobs, habits, and quirks.

For each character, output:
  name: a single given name, 2-12 characters, no titles.
  identity: 3-5 sentences in third person. Concrete: where they're from, what they do, one or two habits, one thing they care about deeply. Avoid generic "passionate about life" filler.
  plan: one sentence in second person ("You want to..."). A behavioral goal that shapes how this character engages with strangers — e.g., "You want to learn one new thing from everyone you meet," or "You want to avoid being noticed."

Make them DIFFERENT from each other. Different jobs, different temperaments, different conversation styles. If you're tempted to write two introverts, change one to be loud.

Output ONLY valid JSON, no commentary. Schema:
{
  "characters": [
    {"name": "...", "identity": "...", "plan": "..."},
    ...
  ]
}`;

interface SeedCharacter {
  name: string;
  identity: string;
  plan: string;
}

export default action({
  args: {
    numPlayers: v.number(),
    theme: v.optional(v.string()),
  },
  handler: async (ctx, { numPlayers, theme }) => {
    if (numPlayers < 1 || numPlayers > 12) {
      throw new Error('seedTownPlayers: numPlayers must be 1..12');
    }

    const userPrompt = theme
      ? `Generate ${numPlayers} characters for a town themed around: ${theme}.`
      : `Generate ${numPlayers} diverse characters for a small town.`;

    // V4 Flash (no reasoning mode) so the action completes inside
    // deepseekClient's 30s timeout. Flash is plenty for "make up N
    // characters that follow a JSON schema."
    const llm = await callDeepseekAPI({
      model: LOCAL_MODEL,
      maxTokens: 2400,
      system: SEED_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const characters = parseCharacters(llm.text, numPlayers);

    // Look up the default world to enqueue inputs against. ai-town's
    // init.ts marks one worldStatus row as isDefault.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    const worldStatus = (await ctx.runQuery(
      ref.ours.queries.defaultWorldStatus.default,
      {},
    )) as { worldId: string } | null;
    if (!worldStatus) {
      throw new Error('seedTownPlayers: no default world — run init first');
    }

    const queued: Array<{ name: string; inputId: string }> = [];
    for (let i = 0; i < characters.length; i++) {
      const c = characters[i]!;
      const character = SPRITE_SLOTS[i % SPRITE_SLOTS.length]!;
      const inputId = (await ctx.runMutation(
        ref.ours.mutations.queueCreateAgentInline.default,
        {
          worldId: worldStatus.worldId,
          name: c.name,
          character,
          identity: c.identity,
          plan: c.plan,
        },
      )) as string;
      queued.push({ name: c.name, inputId });
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return { queued, count: queued.length };
  },
});

// Tolerant JSON extraction — DeepSeek may wrap the JSON in
// markdown fences or add a brief preamble despite the instruction.
function parseCharacters(raw: string, expected: number): SeedCharacter[] {
  const trimmed = raw.trim();
  // Strip ```json ... ``` fences if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonText = fenceMatch ? fenceMatch[1]! : trimmed;
  // Find the outermost { ... } if the model added preamble text.
  const openIdx = jsonText.indexOf('{');
  const closeIdx = jsonText.lastIndexOf('}');
  if (openIdx < 0 || closeIdx <= openIdx) {
    throw new Error(`seedTownPlayers: model output not parseable as JSON: ${raw.slice(0, 200)}`);
  }
  const slice = jsonText.slice(openIdx, closeIdx + 1);
  let parsed: { characters?: SeedCharacter[] };
  try {
    parsed = JSON.parse(slice);
  } catch (err) {
    throw new Error(
      `seedTownPlayers: JSON.parse failed — ${(err as Error).message}; payload starts with: ${slice.slice(0, 200)}`,
    );
  }
  const chars = parsed.characters ?? [];
  if (chars.length === 0) {
    throw new Error('seedTownPlayers: model returned 0 characters');
  }
  // Defensive: trim each field, drop anything missing core fields.
  return chars
    .map((c) => ({
      name: (c.name ?? '').trim(),
      identity: (c.identity ?? '').trim(),
      plan: (c.plan ?? '').trim(),
    }))
    .filter((c) => c.name && c.identity && c.plan)
    .slice(0, expected);
}
