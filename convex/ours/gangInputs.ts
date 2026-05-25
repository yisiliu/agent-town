import { v } from 'convex/values';
import { inputHandler } from '../aiTown/inputHandler';

// Gang system inputs. EXEMPT: gang feature integration
//
// NOTE: These handlers operate within the ai-town engine's synchronous game loop
// and do NOT have access to Convex's ctx.db. The gang tables (gangs, gangMembers,
// gangMessages) are Convex database tables defined in convex/ours/tables/.
//
// Therefore, actual gang operations (create, join, leave, sendMessage) must be
// performed via the corresponding mutations in convex/ours/mutations/gangs.ts.
// These input handlers serve as integration points for the ai-town engine to
// react to gang-related events when needed.

export const gangInputs = {
  // Create a new gang. EXEMPT: gang feature integration
  createGang: inputHandler({
    args: {
      name: v.string(),
      motto: v.string(),
      worldId: v.id('worlds'),
      founderId: v.string(),
    },
    handler: (game, now, args) => {
      // NOTE: Cannot access ctx.db here. Gang creation is handled by
      // convex/ours/mutations/gangs.ts::createGang mutation.
      // This input serves for engine integration if needed.
      console.log(`[gangInputs] createGang called: ${args.name} in world ${args.worldId}`);
      return null;
    },
  }),

  // Join an existing gang. EXEMPT: gang feature integration
  joinGang: inputHandler({
    args: {
      gangId: v.id('gangs'),
      playerId: v.string(),
    },
    handler: (game, now, args) => {
      // NOTE: Cannot access ctx.db here. Gang joining is handled by
      // convex/ours/mutations/gangs.ts::joinGang mutation.
      console.log(`[gangInputs] joinGang called: player ${args.playerId} joining gang ${args.gangId}`);
      return null;
    },
  }),

  // Leave a gang. EXEMPT: gang feature integration
  leaveGang: inputHandler({
    args: {
      gangId: v.id('gangs'),
      playerId: v.string(),
    },
    handler: (game, now, args) => {
      // NOTE: Cannot access ctx.db here. Gang leaving is handled by
      // convex/ours/mutations/gangs.ts::leaveGang mutation.
      console.log(`[gangInputs] leaveGang called: player ${args.playerId} leaving gang ${args.gangId}`);
      return null;
    },
  }),

  // Send a message to a gang. EXEMPT: gang feature integration
  sendGangMessage: inputHandler({
    args: {
      gangId: v.id('gangs'),
      senderId: v.string(),
      content: v.string(),
    },
    handler: (game, now, args) => {
      // NOTE: Cannot access ctx.db here. Gang messaging is handled by
      // convex/ours/mutations/gangs.ts::sendGangMessage mutation.
      console.log(`[gangInputs] sendGangMessage called: sender ${args.senderId} to gang ${args.gangId}`);
      return null;
    },
  }),
};
