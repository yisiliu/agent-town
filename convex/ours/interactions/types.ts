import type { Id } from '../../_generated/dataModel';

export type Visibility = 'public' | Id<'twins'>[];

export interface TurnPlan {
  phase: string;
  kind: string;
  actorTwinId: Id<'twins'> | null;
  visibility: Visibility;
  systemText?: string;
}

export interface AppliedTurn {
  phase: string;
  kind: string;
  actorTwinId: Id<'twins'> | null;
  text?: string;
  data?: unknown;
}

export interface ParseResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface GamePlugin<TState> {
  type: string;
  minPlayers: number;
  maxPlayers: number;

  initialState(participants: Id<'twins'>[], seed: number): TState;
  planNextTurn(state: TState): TurnPlan | null;
  applyTurn(state: TState, turn: AppliedTurn): TState;
  checkWin(state: TState): { ended: boolean; winner?: string };

  buildSystemPrompt(args: {
    state: TState;
    actorTwinId: Id<'twins'>;
    cardMarkdown: string;
    aliveNames: Record<string, string>;
  }): string;

  buildUserPrompt(args: {
    state: TState;
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
  }): string;

  parseTurnText(
    rawText: string,
    kind: string,
    ctx: { aliveIds: Id<'twins'>[] },
  ): ParseResult;
}
