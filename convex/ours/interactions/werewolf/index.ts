import { register } from '../gameRegistry';
import type { GamePlugin } from '../types';
import type { WerewolfState } from './state';
import { initialState, planNextTurn, applyTurn, checkWin } from './rules';
import { buildSystemPrompt, buildUserPrompt, parseTurnText } from './prompts';

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
};

register(werewolfPlugin);
