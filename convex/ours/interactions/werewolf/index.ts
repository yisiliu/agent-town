import { register } from '../gameRegistry';
import type { GamePlugin } from '../types';
import type { WerewolfState } from './state';
import { initialState, planNextTurn, applyTurn, checkWin } from './rules';
import { buildSystemPrompt, buildUserPrompt, parseTurnText } from './prompts';
import type { Id } from '../../../_generated/dataModel';

// Werewolf-specific post-game summary. Outcome reflects whether the
// participant's role aligned with the winning side; summary names role +
// final status (survived / killed) so post-game memory has voice.
function summarizeFor(
  state: WerewolfState,
  twinId: Id<'twins'>,
): { outcome: string; summary: string } {
  const key = twinId as unknown as string;
  const role = state.roles[key] ?? 'unknown';
  const wasWolf = role === 'werewolf';
  const survived = state.alive.includes(twinId);
  const winner = state.winner ?? 'unknown';

  let outcome = 'lost';
  if (winner === 'werewolves') outcome = wasWolf ? 'won' : 'lost';
  else if (winner === 'villagers') outcome = wasWolf ? 'lost' : 'won';
  else outcome = 'cancelled';

  const aliveLabel = survived ? '存活到终局' : `死于第 ${state.day} 天前后`;
  const winnerLabel =
    winner === 'werewolves'
      ? '狼人阵营胜利'
      : winner === 'villagers'
        ? '好人阵营胜利'
        : '游戏中止';
  const summary = `我作为${role}参加了狼人杀，${aliveLabel}。${winnerLabel}，我${outcome === 'won' ? '赢了' : outcome === 'lost' ? '输了' : '没分出胜负'}。`;
  return { outcome, summary };
}

export const werewolfPlugin: GamePlugin<WerewolfState> = {
  type: 'werewolf',
  minPlayers: 4,
  maxPlayers: 12,
  initialState,
  planNextTurn,
  applyTurn,
  checkWin,
  buildSystemPrompt,
  buildUserPrompt,
  parseTurnText,
  summarizeFor,
};

register(werewolfPlugin);
