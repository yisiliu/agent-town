import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Doc, Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import { SelectElement } from './Player';
import { Messages } from './Messages';
import { toastOnError } from '../toasts';
import { useSendInput } from '../hooks/sendInput';
import { Player } from '../../convex/aiTown/player';
import { GameId } from '../../convex/aiTown/ids';
import { ServerGame } from '../hooks/serverGame';

// String-form refs to ours/* queries (ai-town's codegen doesn't
// always include the additive `ours/` namespace, so cast through any
// to silence the type-side gap).
/* eslint-disable @typescript-eslint/no-explicit-any */
const playerConversationsRef = 'ours/queries/playerConversations:default' as any;
const playerReflectionsRef = 'ours/queries/playerReflections:default' as any;
const getPlayerInventoryRef = 'ours/queries/getPlayerInventory:default' as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export default function PlayerDetails({
  worldId,
  engineId,
  game,
  playerId,
  setSelectedElement,
  scrollViewRef,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  playerId?: GameId<'players'>;
  setSelectedElement: SelectElement;
  scrollViewRef: React.RefObject<HTMLDivElement>;
}) {
  const humanTokenIdentifier = useQuery(api.world.userStatus, { worldId });

  const players = [...game.world.players.values()];
  const humanPlayer = players.find((p) => p.human === humanTokenIdentifier);
  const humanConversation = humanPlayer ? game.world.playerConversation(humanPlayer) : undefined;
  // Default to the conversation partner ONLY when the user hasn't picked
  // anyone else. Without this gate, every click on a different sprite (or
  // on the X close button) was silently snapping back to the partner —
  // making the panel feel locked until the conversation ended.
  if (!playerId && humanPlayer && humanConversation) {
    const otherPlayerIds = [...humanConversation.participants.keys()].filter(
      (p) => p !== humanPlayer.id,
    );
    playerId = otherPlayerIds[0];
  }

  const player = playerId && game.world.players.get(playerId);
  const playerConversation = player && game.world.playerConversation(player);

  const pastConversations = useQuery(
    playerConversationsRef,
    playerId ? { worldId, playerId } : 'skip',
  ) as Doc<'archivedConversations'>[] | undefined;
  const reflections = useQuery(
    playerReflectionsRef,
    playerId ? { playerId, limit: 5 } : 'skip',
  ) as
    | { _id: string; createdAt: number; description: string; importance: number }[]
    | undefined;

  // Query the player's inventory (playerId is a string like "p:0" in the game)
  const inventoryData = useQuery(
    getPlayerInventoryRef,
    playerId && worldId ? { worldId, playerId } : 'skip',
  ) as { items: { itemId: string; name: string; icon?: string; count: number }[] } | undefined;
  const inventory = inventoryData?.items;

  const playerDescription = playerId && game.playerDescriptions.get(playerId);

  const startConversation = useSendInput(engineId, 'startConversation');
  const acceptInvite = useSendInput(engineId, 'acceptInvite');
  const rejectInvite = useSendInput(engineId, 'rejectInvite');
  const leaveConversation = useSendInput(engineId, 'leaveConversation');

  if (!playerId) {
    return (
      <div className="h-full text-xl flex text-center items-center p-4">
        点击地图上的 AI 角色，查看 TA 的对话历史。
      </div>
    );
  }
  if (!player) {
    return null;
  }
  const isMe = humanPlayer && player.id === humanPlayer.id;
  const canInvite = !isMe && !playerConversation && humanPlayer && !humanConversation;
  const sameConversation =
    !isMe &&
    humanPlayer &&
    humanConversation &&
    playerConversation &&
    humanConversation.id === playerConversation.id;

  const humanStatus =
    humanPlayer && humanConversation && humanConversation.participants.get(humanPlayer.id)?.status;
  const playerStatus = playerConversation && playerConversation.participants.get(playerId)?.status;

  const haveInvite = sameConversation && humanStatus?.kind === 'invited';
  const waitingForAccept =
    sameConversation && playerConversation.participants.get(playerId)?.status.kind === 'invited';
  const waitingForNearby =
    sameConversation && playerStatus?.kind === 'walkingOver' && humanStatus?.kind === 'walkingOver';

  const inConversationWithMe =
    sameConversation &&
    playerStatus?.kind === 'participating' &&
    humanStatus?.kind === 'participating';

  const onStartConversation = async () => {
    if (!humanPlayer || !playerId) {
      return;
    }
    console.log(`Starting conversation`);
    await toastOnError(startConversation({ playerId: humanPlayer.id, invitee: playerId }));
  };
  const onAcceptInvite = async () => {
    if (!humanPlayer || !humanConversation || !playerId) {
      return;
    }
    await toastOnError(
      acceptInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onRejectInvite = async () => {
    if (!humanPlayer || !humanConversation) {
      return;
    }
    await toastOnError(
      rejectInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onLeaveConversation = async () => {
    if (!humanPlayer || !inConversationWithMe || !humanConversation) {
      return;
    }
    await toastOnError(
      leaveConversation({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  // const pendingSuffix = (inputName: string) =>
  //   [...inflightInputs.values()].find((i) => i.name === inputName) ? ' opacity-50' : '';

  const pendingSuffix = (s: string) => '';
  return (
    <>
      <div className="flex gap-4">
        <div className="box w-3/4 sm:w-full mr-auto">
          <h2 className="bg-brown-700 p-2 font-display text-2xl sm:text-4xl tracking-wider shadow-solid text-center">
            {playerDescription?.name}
          </h2>
        </div>
        <a
          className="button text-white shadow-solid text-2xl cursor-pointer pointer-events-auto"
          onClick={() => setSelectedElement(undefined)}
        >
          <h2 className="h-full bg-clay-700">
            <img className="w-4 h-4 sm:w-5 sm:h-5" src={closeImg} />
          </h2>
        </a>
      </div>
      {canInvite && (
        <a
          className={
            'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
            pendingSuffix('startConversation')
          }
          onClick={onStartConversation}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>发起对话</span>
          </div>
        </a>
      )}
      {waitingForAccept && (
        <a className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto opacity-50">
          <div className="h-full bg-clay-700 text-center">
            <span>等待对方接受…</span>
          </div>
        </a>
      )}
      {waitingForNearby && (
        <a className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto opacity-50">
          <div className="h-full bg-clay-700 text-center">
            <span>对方正在走过来…</span>
          </div>
        </a>
      )}
      {inConversationWithMe && (
        <a
          className={
            'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
            pendingSuffix('leaveConversation')
          }
          onClick={onLeaveConversation}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>结束对话</span>
          </div>
        </a>
      )}
      {haveInvite && (
        <>
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingSuffix('acceptInvite')
            }
            onClick={onAcceptInvite}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>接受</span>
            </div>
          </a>
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingSuffix('rejectInvite')
            }
            onClick={onRejectInvite}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>拒绝</span>
            </div>
          </a>
        </>
      )}
      {!playerConversation && player.activity && player.activity.until > Date.now() && (
        <div className="box flex-grow mt-6">
          <h2 className="bg-brown-700 text-base sm:text-lg text-center">
            {player.activity.description}
          </h2>
        </div>
      )}
      <div className="desc my-6">
        <p className="leading-tight -m-4 bg-brown-700 text-base sm:text-sm">
          {!isMe && playerDescription?.description}
          {isMe && <i>这是你自己！</i>}
          {!isMe && inConversationWithMe && (
            <>
              <br />
              <br />(<i>正在和你对话！</i>)
            </>
          )}
        </p>
      </div>
      {!isMe && playerConversation && playerStatus?.kind === 'participating' && (
        <Messages
          worldId={worldId}
          engineId={engineId}
          inConversationWithMe={inConversationWithMe ?? false}
          conversation={{ kind: 'active', doc: playerConversation }}
          humanPlayer={humanPlayer}
          scrollViewRef={scrollViewRef}
        />
      )}
      {!playerConversation && pastConversations && pastConversations.length > 0 && (
        <ConversationHistory
          conversations={pastConversations}
          worldId={worldId}
          engineId={engineId}
          humanPlayer={humanPlayer}
          scrollViewRef={scrollViewRef}
        />
      )}
      {reflections && reflections.length > 0 && (
        <Reflections reflections={reflections} />
      )}
      {inventory && inventory.length > 0 && (
        <div className="box flex-grow mt-4">
          <h2 className="bg-brown-700 text-lg text-center">背包物品</h2>
          <ul className="my-2 space-y-1">
            {inventory.map((item) => (
              <li key={item.itemId} className="bg-brown-700 rounded px-2 py-1 text-sm flex items-center gap-2">
                {item.icon && <span>{item.icon}</span>}
                <span className="flex-grow truncate">{item.name}</span>
                <span className="text-xs opacity-70">×{item.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {inventory && inventory.length === 0 && (
        <div className="box flex-grow mt-4">
          <h2 className="bg-brown-700 text-lg text-center">背包物品</h2>
          <p className="text-sm text-center opacity-70 mt-2">背包空空</p>
        </div>
      )}
    </>
  );
}

// Collapsible list of every archived conversation this player was in.
// One row per conversation: time + numMessages + partner names; click
// to expand the full <Messages> render.
function ConversationHistory({
  conversations,
  worldId,
  engineId,
  humanPlayer,
  scrollViewRef,
}: {
  conversations: Doc<'archivedConversations'>[];
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  humanPlayer: Player | undefined;
  scrollViewRef: React.RefObject<HTMLDivElement>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const descriptions = useQuery(api.world.gameDescriptions, { worldId });
  const nameOf = (pid: string) =>
    descriptions?.playerDescriptions.find((p) => p.playerId === pid)?.name ?? pid;

  return (
    <>
      <div className="box flex-grow mt-4">
        <h2 className="bg-brown-700 text-lg text-center">
          过往对话 · {conversations.length}
        </h2>
      </div>
      <ul className="my-2 space-y-1">
        {conversations.map((c) => {
          const isOpen = openId === c.id;
          const ts = new Date(c.ended).toLocaleString();
          const partners = c.participants.map(nameOf).join('、');
          return (
            <li key={c.id} className="bg-brown-700 rounded">
              <button
                className="w-full text-left px-2 py-1 text-sm hover:bg-brown-600"
                onClick={() => setOpenId(isOpen ? null : c.id)}
              >
                <span className="opacity-70 text-xs">{ts}</span>
                <span className="ml-2">{partners}</span>
                <span className="ml-2 text-xs opacity-70">· {c.numMessages} 条</span>
                <span className="float-right">{isOpen ? '▼' : '▶'}</span>
              </button>
              {isOpen && (
                <div className="px-2 pb-2">
                  <Messages
                    worldId={worldId}
                    engineId={engineId}
                    inConversationWithMe={false}
                    conversation={{ kind: 'archived', doc: c }}
                    humanPlayer={humanPlayer}
                    scrollViewRef={scrollViewRef}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// LLM-generated self-summaries the agent writes about its own life.
// Read-only — purely informational so students can see what the
// agent is keeping track of internally.
function Reflections({
  reflections,
}: {
  reflections: { _id: string; createdAt: number; description: string; importance: number }[];
}) {
  return (
    <>
      <div className="box flex-grow mt-4">
        <h2 className="bg-brown-700 text-lg text-center">自我反思</h2>
      </div>
      <ul className="my-2 space-y-2">
        {reflections.map((r) => (
          <li key={r._id} className="bg-brown-700 rounded px-2 py-2 text-sm">
            <div className="text-xs opacity-70 mb-1">
              {new Date(r.createdAt).toLocaleString()} · 重要度 {r.importance.toFixed(2)}
            </div>
            <p className="leading-snug">{r.description}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
