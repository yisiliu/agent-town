import { inputHandler } from './inputHandler';
import { parseGameId, playerId } from './ids';
import { point, vector } from '../util/types';

export const dungeonInputs = {
  teleportPlayer: inputHandler({
    args: { playerId, position: point, facing: vector },
    handler: (game, _now, args) => {
      const id = parseGameId('players', args.playerId);
      const player = game.world.players.get(id);
      if (!player) {
        throw new Error(`Invalid player ID ${id}`);
      }
      player.position = args.position;
      player.facing = args.facing;
      player.pathfinding = undefined;
      player.activity = undefined;
      player.speed = 0;
      return null;
    },
  }),
};
