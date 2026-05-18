import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const gameTurns = defineTable({
  gameId: v.id('games'),
  round: v.number(),
  speakerTwinId: v.id('twins'),
  role: v.union(
    v.literal('encryptor'),
    v.literal('guesser'),
    v.literal('interceptor'),
  ),
  text: v.string(),
  timestamp: v.number(),
  classVisible: v.boolean(),
})
  .index('gameId', ['gameId'])
  .index('game_round', ['gameId', 'round'])
  .index('speaker', ['speakerTwinId']);
