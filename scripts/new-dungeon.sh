#!/usr/bin/env bash
set -euo pipefail

# scripts/new-dungeon.sh <plugin-name>
#
# Scaffolds a new Interactions plugin directory with minimal stubs ready
# to fill in. Designed for live-coding in class.
#
# Usage:
#   bash scripts/new-dungeon.sh trolley
#
# Creates:
#   convex/ours/interactions/trolley/
#     state.ts, rules.ts, prompts.ts, index.ts, README.md

if [ $# -ne 1 ]; then
  echo "Usage: $0 <plugin-name>"
  exit 1
fi

NAME="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/convex/ours/interactions/$NAME"

if [ -e "$DIR" ]; then
  echo "Error: $DIR already exists. Pick a different name or delete it first."
  exit 1
fi

# Portable capitalize-first-letter (works on macOS bash 3.2).
CAP="$(echo "${NAME:0:1}" | tr '[:lower:]' '[:upper:]')${NAME:1}"
TYPE_NAME="${CAP}State"
PHASE_TYPE="${CAP}Phase"

mkdir -p "$DIR"

cat > "$DIR/state.ts" <<EOF
import type { Id } from '../../../_generated/dataModel';

// TODO: fill in the plugin-specific state shape. Whatever fields the
// engine needs to track between turns lives here. The framework stores
// this as opaque JSON in interactions.state.

export type ${PHASE_TYPE} = 'lobby' | 'turn' | 'ended';

export interface ${TYPE_NAME} {
  participants: Id<'twins'>[];
  alive: Id<'twins'>[];
  phase: ${PHASE_TYPE};
  cursor: number;
  publicLog: string[];
  // TODO: add your game-specific fields here
  winner?: string;
}
EOF

cat > "$DIR/rules.ts" <<EOF
import type { Id } from '../../../_generated/dataModel';
import type { AppliedTurn, TurnPlan } from '../types';
import type { ${TYPE_NAME} } from './state';

// Mulberry32 — small deterministic PRNG.
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function initialState(
  participants: Id<'twins'>[],
  seed: number,
): ${TYPE_NAME} {
  if (participants.length < 2) {
    throw new Error('${NAME} needs at least 2 players');
  }
  // TODO: any setup logic (role assignment, deck shuffle, etc.)
  // Use mulberry32(seed) for any randomness you need.
  void seed;
  return {
    participants: participants.slice(),
    alive: participants.slice(),
    phase: 'turn',
    cursor: 0,
    publicLog: [\`${NAME} game begins with \${participants.length} players.\`],
  };
}

export function checkWin(s: ${TYPE_NAME}): { ended: boolean; winner?: string } {
  // TODO: when does the game end? Who won?
  void s;
  return { ended: false };
}

export function planNextTurn(s: ${TYPE_NAME}): TurnPlan | null {
  if (s.phase === 'ended') return null;
  const actor = s.alive[s.cursor];
  if (!actor) return null;
  return {
    phase: s.phase,
    kind: 'speak',
    actorTwinId: actor,
    visibility: 'public',
  };
}

export function applyTurn(s: ${TYPE_NAME}, t: AppliedTurn): ${TYPE_NAME} {
  // TODO: apply the turn to state, then maybe check win
  void t;
  const next = { ...s, cursor: s.cursor + 1 };
  if (next.cursor >= next.alive.length) {
    next.phase = 'ended';
    const win = checkWin(next);
    if (win.ended) next.winner = win.winner;
  }
  return next;
}
EOF

cat > "$DIR/prompts.ts" <<EOF
import type { Id } from '../../../_generated/dataModel';
import type { ParseResult } from '../types';
import type { ${TYPE_NAME} } from './state';

export function buildSystemPrompt(args: {
  state: ${TYPE_NAME};
  actorTwinId: Id<'twins'>;
  cardMarkdown: string;
  aliveNames: Record<string, string>;
}): string {
  void args;
  return \`你正在玩「${NAME}」游戏。保持角色一致，按你的人设发挥。

你的人设（来自 card.md）：
\${args.cardMarkdown}

每回合输出 JSON：
{"thinking": "...", "say": "..."}\`;
}

export function buildUserPrompt(args: {
  state: ${TYPE_NAME};
  actorTwinId: Id<'twins'>;
  phase: string;
  kind: string;
  visibleTurns: Array<{
    phase: string;
    kind: string;
    text: string;
    actorTwinId: Id<'twins'> | null;
  }>;
  aliveNames: Record<string, string>;
}): string {
  // TODO: build phase-specific prompts. Example:
  return \`轮到你了。

\${args.visibleTurns.map((t) => \`\${t.actorTwinId ? args.aliveNames[t.actorTwinId as unknown as string] ?? t.actorTwinId : 'SYSTEM'}: \${t.text}\`).join('\\n')}

请发言。\`;
}

export function parseTurnText(
  rawText: string,
  kind: string,
  ctx: { aliveIds: Id<'twins'>[] },
): ParseResult {
  void kind;
  void ctx;
  const stripped = rawText
    .replace(/^\\s*\\\`\\\`\\\`(?:json)?\\s*/i, '')
    .replace(/\\s*\\\`\\\`\\\`\\s*\$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    return { ok: false, error: \`JSON parse error: \${(e as Error).message}\` };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'JSON root is not an object' };
  }
  const obj = parsed as { thinking?: unknown; say?: unknown };
  const thinking = typeof obj.thinking === 'string' ? obj.thinking : '';
  const say = typeof obj.say === 'string' ? obj.say : '';
  if (!say) return { ok: false, error: 'requires "say"' };
  return { ok: true, data: { thinking, say } };
}
EOF

cat > "$DIR/index.ts" <<EOF
import { register } from '../gameRegistry';
import type { GamePlugin } from '../types';
import type { Id } from '../../../_generated/dataModel';
import type { ${TYPE_NAME} } from './state';
import { initialState, planNextTurn, applyTurn, checkWin } from './rules';
import { buildSystemPrompt, buildUserPrompt, parseTurnText } from './prompts';

function summarizeFor(
  state: ${TYPE_NAME},
  twinId: Id<'twins'>,
): { outcome: string; summary: string } {
  void twinId;
  const winner = state.winner ?? 'unknown';
  return {
    outcome: winner === 'unknown' ? 'cancelled' : 'completed',
    summary: \`I played ${NAME}; winner: \${winner}.\`,
  };
}

export const ${NAME}Plugin: GamePlugin<${TYPE_NAME}> = {
  type: '${NAME}',
  minPlayers: 2,  // TODO: adjust
  maxPlayers: 12, // TODO: adjust
  initialState,
  planNextTurn,
  applyTurn,
  checkWin,
  buildSystemPrompt,
  buildUserPrompt,
  parseTurnText,
  summarizeFor,
};

register(${NAME}Plugin);
EOF

cat > "$DIR/README.md" <<EOF
# ${NAME} plugin

Scaffold created by \`scripts/new-dungeon.sh ${NAME}\`. Live-coding order:

1. **state.ts** — define ${PHASE_TYPE} union + ${TYPE_NAME} fields
2. **rules.ts** — initialState, planNextTurn, applyTurn, checkWin
3. **prompts.ts** — buildSystemPrompt, buildUserPrompt (per phase), parseTurnText
4. **index.ts** — usually no changes; assembles + registers
5. Add \`import '../interactions/${NAME}';\` to:
   - \`convex/ours/mutations/startInteraction.ts\`
   - \`convex/ours/mutations/startDungeonGame.ts\`
6. \`bunx convex dev --once\` → \`startInteraction\` with \`type: "${NAME}"\`
EOF

echo "Scaffolded $DIR/"
ls "$DIR/"
echo ""
echo "Next steps (also in $DIR/README.md):"
echo "  1. Fill in state.ts → rules.ts → prompts.ts"
echo "  2. Add import to startInteraction.ts AND startDungeonGame.ts"
echo "  3. bunx convex dev --once"
echo "  4. Start a game"
