import { useState, useEffect } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';

// Gang panel component: Pixel Art Style
// EXEMPT: gang feature integration - new component for gang system

interface Gang {
  _id: string;
  name: string;
  motto: string;
  founderId: string;
  worldId: string;
  createdAt: number;
}

interface GangMember {
  _id: string;
  gangId: string;
  playerId: string;
  joinedAt: number;
}

interface GangMessage {
  _id: string;
  gangId: string;
  senderId: string;
  content: string;
  createdAt: number;
}

interface GangDetail extends Gang {
  members: GangMember[];
  messages: GangMessage[];
}

interface PlayerGangEntry {
  gang: Gang;
  joinedAt: number;
}

interface PlayerWithGangStatus {
  id: string;
  name: string;
  isAI: boolean;
  gangInfo: {
    gangId: string;
    gangName: string;
    isFounder: boolean;
  } | null;
}

interface PendingInvite {
  _id: string;
  gangId: string;
  inviterId: string;
  inviteeId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
  gangName: string;
}

// Pixel art colors
const COLORS = {
  bg: '#2d1810',
  bgLight: '#3d2820',
  bgDark: '#1d0800',
  border: '#8b6914',
  borderLight: '#c4a35a',
  text: '#d4c4a4',
  textMuted: '#8b7355',
  accent: '#c4a35a',
  button: '#4a3728',
  buttonHover: '#5a4738',
  flash: '#ffff00',
};

// String-form refs to ours/* queries (ai-town's codegen doesn't
// always include the additive `ours/` namespace, so cast through any
// to silence the type-side gap).
/* eslint-disable @typescript-eslint/no-explicit-any */
const listGangsRef = 'ours/queries/gangs:listGangs' as any;
const getPlayerGangsRef = 'ours/queries/gangs:getPlayerGangs' as any;
const createGangRef = 'ours/mutations/gangs:createGang' as any;
const joinGangRef = 'ours/mutations/gangs:joinGang' as any;
const getGangDetailRef = 'ours/queries/gangs:getGangDetail' as any;
const leaveGangRef = 'ours/mutations/gangs:leaveGang' as any;
const sendGangMessageRef = 'ours/mutations/gangs:sendGangMessage' as any;
const listAllPlayersWithGangStatusRef = 'ours/queries/gangs:listAllPlayersWithGangStatus' as any;
const inviteToGangRef = 'ours/mutations/gangs:inviteToGang' as any;
const getPendingInvitesRef = 'ours/queries/gangs:getPendingInvites' as any;
const acceptGangInviteRef = 'ours/mutations/gangs:acceptGangInvite' as any;
const rejectGangInviteRef = 'ours/mutations/gangs:rejectGangInvite' as any;
const kickGangMemberRef = 'ours/mutations/gangs:kickGangMember' as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// TEST MODE: Allow all users to test gang features
// In production, this should be removed and use actual playerId
const TEST_PLAYER_ID = 'test-user-' + Math.random().toString(36).slice(2, 8);

export default function GangPanel({
  worldId,
  playerId,
  onClose,
}: {
  worldId: Id<'worlds'>;
  playerId?: string;
  onClose?: () => void;
}) {
  // Use test player ID if no real playerId provided (test mode)
  const effectivePlayerId = playerId || TEST_PLAYER_ID;

  const gangs = useQuery(listGangsRef, { worldId }) as Gang[] | undefined;
  const myGangs = useQuery(getPlayerGangsRef, { playerId: effectivePlayerId }) as PlayerGangEntry[] | undefined;
  const allPlayers = useQuery(listAllPlayersWithGangStatusRef, { worldId }) as PlayerWithGangStatus[] | undefined;
  const pendingInvites = useQuery(getPendingInvitesRef, { playerId: effectivePlayerId }) as PendingInvite[] | undefined;

  const createGang = useMutation(createGangRef);
  const joinGang = useMutation(joinGangRef);
  const inviteToGang = useMutation(inviteToGangRef);
  const acceptInvite = useMutation(acceptGangInviteRef);
  const rejectInvite = useMutation(rejectGangInviteRef);
  const kickGangMember = useMutation(kickGangMemberRef);

  const [activeTab, setActiveTab] = useState<'all' | 'my' | 'members'>('all');
  const [expandedGangId, setExpandedGangId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGangName, setNewGangName] = useState('');
  const [newGangMotto, setNewGangMotto] = useState('');
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [selectedGangForInvite, setSelectedGangForInvite] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);

  // Flash effect when new invite arrives
  useEffect(() => {
    if (pendingInvites && pendingInvites.length > 0) {
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [pendingInvites?.length]);

  const handleCreateGang = async () => {
    if (!newGangName.trim() || !newGangMotto.trim()) return;
    try {
      await createGang({
        name: newGangName.trim(),
        motto: newGangMotto.trim(),
        worldId,
        founderId: effectivePlayerId,
      });
      setNewGangName('');
      setNewGangMotto('');
      setShowCreateForm(false);
    } catch (e) {
      console.error('Failed to create gang:', e);
      alert('创建帮派失败，可能是名称已存在');
    }
  };

  const handleJoinGang = async (gangId: string) => {
    try {
      await joinGang({ gangId, playerId: effectivePlayerId });
    } catch (e) {
      console.error('Failed to join gang:', e);
      alert('加入帮派失败');
    }
  };

  const handleInvitePlayer = async (inviteeId: string) => {
    if (!selectedGangForInvite) return;
    try {
      await inviteToGang({
        gangId: selectedGangForInvite,
        inviterId: effectivePlayerId,
        inviteeId,
      });
      alert('邀请已发送！');
    } catch (e) {
      console.error('Failed to invite:', e);
      alert('邀请失败');
    }
  };

  const handleAcceptInvite = async (inviteId: string) => {
    try {
      await acceptInvite({ inviteId, playerId: effectivePlayerId });
    } catch (e) {
      console.error('Failed to accept invite:', e);
      alert('接受邀请失败');
    }
  };

  const handleRejectInvite = async (inviteId: string) => {
    try {
      await rejectInvite({ inviteId, playerId: effectivePlayerId });
    } catch (e) {
      console.error('Failed to reject invite:', e);
      alert('拒绝邀请失败');
    }
  };

  const myGangIds = new Set(myGangs?.map(g => g.gang._id) ?? []);
  const displayedGangs = activeTab === 'my'
    ? myGangs?.map(g => g.gang)
    : gangs;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: COLORS.bg, color: COLORS.text, fontFamily: 'monospace' }}>
      {/* Header - Pixel Art Style with Flash Effect */}
      <div
        className="p-2 border-b-2 transition-all duration-200 flex items-center justify-between"
        style={{
          backgroundColor: isFlashing ? COLORS.flash : COLORS.bgDark,
          borderColor: COLORS.border,
          boxShadow: isFlashing ? '0 0 10px #ffff00' : 'none'
        }}
      >
        <h3
          className="text-sm tracking-wider transition-all duration-200 flex-1 text-center"
          style={{
            color: isFlashing ? '#000' : COLORS.accent,
            textShadow: isFlashing ? 'none' : '1px 1px 0 #000'
          }}
        >
          {isFlashing ? '⚠️ 新邀请!' : '☠️ 帮派'}
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              width: '24px',
              height: '24px',
              backgroundColor: COLORS.button,
              border: `2px solid ${COLORS.border}`,
              boxShadow: '2px 2px 0 #000',
              color: COLORS.text,
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: '8px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = COLORS.buttonHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = COLORS.button;
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'translate(1px, 1px)';
              e.currentTarget.style.boxShadow = '1px 1px 0 #000';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'translate(0, 0)';
              e.currentTarget.style.boxShadow = '2px 2px 0 #000';
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Pending Invites Panel */}
      {pendingInvites && pendingInvites.length > 0 && (
        <div className="p-2 border-b" style={{ backgroundColor: '#3d3010', borderColor: COLORS.border }}>
          <div className="text-[10px] mb-1" style={{ color: COLORS.flash }}>待处理邀请:</div>
          {pendingInvites.map((invite) => (
            <div key={invite._id} className="flex items-center justify-between mb-1 p-1" style={{ backgroundColor: COLORS.bgDark }}>
              <span className="text-[10px]">加入「{invite.gangName}」</span>
              <div className="flex gap-1">
                <button
                  className="px-1 py-0.5 text-[8px] border"
                  style={{ backgroundColor: '#2a4a2a', borderColor: '#4a7c4a', color: '#7cb87c' }}
                  onClick={() => handleAcceptInvite(invite._id)}
                >
                  同意
                </button>
                <button
                  className="px-1 py-0.5 text-[8px] border"
                  style={{ backgroundColor: '#5a2020', borderColor: '#8b4513', color: COLORS.text }}
                  onClick={() => handleRejectInvite(invite._id)}
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info Banner - Features */}
      <div className="px-2 py-1 border-b text-[9px] space-y-1" style={{ borderColor: COLORS.border, backgroundColor: COLORS.bgDark }}>
        <div className="flex items-center gap-1" style={{ color: COLORS.textMuted }}>
          <span>🔒</span>
          <span>群聊仅成员可见</span>
        </div>
        <div className="flex items-center gap-1" style={{ color: '#7cb87c' }}>
          <span>🤖</span>
          <span>AI 成员感知帮派动态</span>
        </div>
      </div>

      {/* Tabs - Pixel Art */}
      <div className="flex border-b" style={{ borderColor: COLORS.border }}>
        <button
          className="flex-1 py-1 text-xs"
          style={{
            backgroundColor: activeTab === 'all' ? COLORS.bgLight : COLORS.bg,
            color: activeTab === 'all' ? COLORS.accent : COLORS.textMuted,
            borderRight: `1px solid ${COLORS.border}`,
          }}
          onClick={() => setActiveTab('all')}
        >
          所有
        </button>
        <button
          className="flex-1 py-1 text-xs"
          style={{
            backgroundColor: activeTab === 'my' ? COLORS.bgLight : COLORS.bg,
            color: activeTab === 'my' ? COLORS.accent : COLORS.textMuted,
            borderRight: `1px solid ${COLORS.border}`,
          }}
          onClick={() => setActiveTab('my')}
        >
          我的{myGangs && myGangs.length > 0 ? `(${myGangs.length})` : ''}
        </button>
        <button
          className="flex-1 py-1 text-xs"
          style={{
            backgroundColor: activeTab === 'members' ? COLORS.bgLight : COLORS.bg,
            color: activeTab === 'members' ? COLORS.accent : COLORS.textMuted,
          }}
          onClick={() => setActiveTab('members')}
        >
          成员
        </button>
      </div>

      {/* Create Gang Button - Pixel Art */}
      <div className="p-2 border-b" style={{ borderColor: COLORS.border }}>
        <button
          className="w-full py-1 px-2 text-xs border shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
          style={{
            backgroundColor: showCreateForm ? COLORS.bgDark : COLORS.button,
            borderColor: COLORS.border,
            color: COLORS.text,
          }}
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? '❌ 取消' : '➕ 创建'}
        </button>
      </div>

      {/* Create Gang Form - Pixel Art */}
      {showCreateForm && (
        <div className="p-2 border-b space-y-1" style={{ backgroundColor: COLORS.bgLight, borderColor: COLORS.border }}>
          <input
            type="text"
            placeholder="帮派名"
            value={newGangName}
            onChange={(e) => setNewGangName(e.target.value)}
            className="w-full px-2 py-1 text-xs border"
            style={{
              backgroundColor: COLORS.bgDark,
              borderColor: COLORS.border,
              color: COLORS.text,
              outline: 'none',
            }}
          />
          <input
            type="text"
            placeholder="格言"
            value={newGangMotto}
            onChange={(e) => setNewGangMotto(e.target.value)}
            className="w-full px-2 py-1 text-xs border"
            style={{
              backgroundColor: COLORS.bgDark,
              borderColor: COLORS.border,
              color: COLORS.text,
              outline: 'none',
            }}
          />
          <button
            className="w-full py-1 text-xs border shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
            style={{ backgroundColor: COLORS.accent, borderColor: COLORS.borderLight, color: COLORS.bgDark }}
            onClick={handleCreateGang}
          >
            确认
          </button>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-1 space-y-1" style={{ scrollbarWidth: 'thin' }}>
        {activeTab === 'members' ? (
          /* Members List Tab */
          <MembersList
            players={allPlayers}
            myGangs={myGangs}
            playerId={effectivePlayerId}
            onInvite={(gangId) => {
              setSelectedGangForInvite(gangId);
              setShowInvitePanel(true);
            }}
          />
        ) : (
          /* Gangs List */
          <>
            {displayedGangs === undefined ? (
              <p className="text-center text-xs py-2" style={{ color: COLORS.textMuted }}>加载中...</p>
            ) : displayedGangs.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-lg mb-1">☠️</p>
                <p className="text-xs" style={{ color: COLORS.textMuted }}>
                  {activeTab === 'my' ? '无帮派' : '创建第一个!'}
                </p>
              </div>
            ) : (
              displayedGangs.map((gang) => (
                <GangItem
                  key={gang._id}
                  gang={gang}
                  playerId={effectivePlayerId}
                  isExpanded={expandedGangId === gang._id}
                  isMember={myGangIds.has(gang._id)}
                  onToggle={() => setExpandedGangId(expandedGangId === gang._id ? null : gang._id)}
                  onJoin={() => handleJoinGang(gang._id)}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* Invite Panel Modal */}
      {showInvitePanel && selectedGangForInvite && (
        <InvitePanel
          players={allPlayers}
          gangId={selectedGangForInvite}
          myGangs={myGangs}
          onInvite={handleInvitePlayer}
          onClose={() => setShowInvitePanel(false)}
        />
      )}
    </div>
  );
}

// Members List Component
function MembersList({
  players,
  myGangs,
  playerId,
  onInvite,
}: {
  players?: PlayerWithGangStatus[];
  myGangs?: PlayerGangEntry[];
  playerId?: string;
  onInvite: (gangId: string) => void;
}) {
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerWithGangStatus | null>(null);

  if (!players) {
    return <p className="text-center text-xs py-2" style={{ color: COLORS.textMuted }}>加载中...</p>;
  }

  const myFirstGang = myGangs?.[0];

  return (
    <div className="space-y-1">
      <div className="text-[10px] px-1" style={{ color: COLORS.accent }}>
        小镇成员 ({players.length}) - 点击查看选项
      </div>
      {players.map((player) => (
        <div
          key={player.id}
          className="flex items-center justify-between p-1 text-xs cursor-pointer hover:opacity-80"
          style={{ backgroundColor: COLORS.bgLight, border: `1px solid ${COLORS.border}` }}
          onClick={() => setSelectedPlayer(player)}
        >
          <div className="flex items-center gap-1">
            <span>{player.isAI ? '🤖' : '👤'}</span>
            <span>{player.name}</span>
          </div>
          <div className="flex items-center gap-1">
            {player.gangInfo ? (
              <span className="text-[9px] px-1" style={{ backgroundColor: '#1a3d1a', color: '#7cb87c' }}>
                {player.gangInfo.isFounder ? '👑' : '⚔'} {player.gangInfo.gangName}
              </span>
            ) : (
              <span className="text-[9px] px-1" style={{ backgroundColor: COLORS.bgDark, color: COLORS.textMuted }}>
                无帮派
              </span>
            )}
          </div>
        </div>
      ))}

      {/* Player Action Modal */}
      {selectedPlayer && (
        <PlayerActionModal
          player={selectedPlayer}
          myGangs={myGangs}
          playerId={effectivePlayerId}
          onClose={() => setSelectedPlayer(null)}
          onInvite={() => {
            if (myFirstGang) {
              onInvite(myFirstGang.gang._id);
            }
            setSelectedPlayer(null);
          }}
        />
      )}
    </div>
  );
}

// Player Action Modal
function PlayerActionModal({
  player,
  myGangs,
  playerId,
  onClose,
  onInvite,
}: {
  player: PlayerWithGangStatus;
  myGangs?: PlayerGangEntry[];
  playerId?: string;
  onClose: () => void;
  onInvite: () => void;
}) {
  const myFirstGang = myGangs?.[0];
  const isMyGang = player.gangInfo?.gangId === myFirstGang?.gang._id;
  const isMe = player.id === playerId;
  const isFounder = myFirstGang?.gang.founderId === playerId;
  const kickGangMember = useMutation(kickGangMemberRef);

  const handleKick = async () => {
    if (!myFirstGang || !playerId) return;
    try {
      await kickGangMember({
        gangId: myFirstGang.gang._id,
        founderId: playerId,
        memberId: player.id,
      });
      alert(`已将 ${player.name} 踢出帮派`);
      onClose();
    } catch (e) {
      console.error('Failed to kick:', e);
      alert('踢出失败');
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs p-3 border-2 shadow-[4px_4px_0_#000]"
        style={{ backgroundColor: COLORS.bg, borderColor: COLORS.border }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center mb-3 pb-2 border-b" style={{ borderColor: COLORS.border }}>
          <div className="text-2xl mb-1">{player.isAI ? '🤖' : '👤'}</div>
          <div className="text-sm font-bold" style={{ color: COLORS.accent }}>{player.name}</div>
          <div className="text-[10px]" style={{ color: COLORS.textMuted }}>
            {player.gangInfo ? (
              <span>当前: {player.gangInfo.isFounder ? '👑 帮主' : '⚔ 成员'} @ {player.gangInfo.gangName}</span>
            ) : (
              <span>无帮派</span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          {/* Invite Option - only if player has no gang and I have a gang */}
          {myFirstGang && !player.gangInfo && (
            <button
              className="w-full py-2 text-xs border shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
              style={{ backgroundColor: '#2a4a2a', borderColor: '#4a7c4a', color: '#7cb87c' }}
              onClick={onInvite}
            >
              📨 邀请加入「{myFirstGang.gang.name}」
            </button>
          )}

          {/* Kick Option - only if in my gang and I'm founder */}
          {isMyGang && isFounder && !isMe && (
            <button
              className="w-full py-2 text-xs border shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
              style={{ backgroundColor: '#5a2020', borderColor: '#8b4513', color: COLORS.text }}
              onClick={() => {
                if (confirm(`确定要将 ${player.name} 踢出帮派吗？`)) {
                  handleKick();
                }
              }}
            >
              👢 踢出帮派
            </button>
          )}

          {/* Close Button */}
          <button
            className="w-full py-2 text-xs border shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
            style={{ backgroundColor: COLORS.button, borderColor: COLORS.border, color: COLORS.text }}
            onClick={onClose}
          >
            ❌ 关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// Invite Panel Modal
function InvitePanel({
  players,
  gangId,
  myGangs,
  onInvite,
  onClose,
}: {
  players?: PlayerWithGangStatus[];
  gangId: string;
  myGangs?: PlayerGangEntry[];
  onInvite: (playerId: string) => void;
  onClose: () => void;
}) {
  const gangName = myGangs?.find(g => g.gang._id === gangId)?.gang.name || 'Unknown';

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs p-2 border-2 shadow-[4px_4px_0_#000]"
        style={{ backgroundColor: COLORS.bg, borderColor: COLORS.border }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2 pb-1 border-b" style={{ borderColor: COLORS.border }}>
          <span className="text-xs" style={{ color: COLORS.accent }}>邀请加入「{gangName}」</span>
          <button className="text-xs" onClick={onClose}>✕</button>
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {players?.filter(p => !p.gangInfo && p.isAI).map((player) => (
            <div
              key={player.id}
              className="flex items-center justify-between p-1 text-xs"
              style={{ backgroundColor: COLORS.bgLight }}
            >
              <span>🤖 {player.name}</span>
              <button
                className="px-2 py-0.5 text-[10px] border"
                style={{ backgroundColor: COLORS.accent, borderColor: COLORS.borderLight, color: COLORS.bgDark }}
                onClick={() => { onInvite(player.id); onClose(); }}
              >
                邀请
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GangItem({
  gang,
  playerId,
  isExpanded,
  isMember,
  onToggle,
  onJoin,
}: {
  gang: Gang;
  playerId?: string;
  isExpanded: boolean;
  isMember: boolean;
  onToggle: () => void;
  onJoin: () => void;
}) {
  const detail = useQuery(
    getGangDetailRef,
    isExpanded ? { gangId: gang._id } : 'skip'
  ) as GangDetail | null | undefined;

  const leaveGang = useMutation(leaveGangRef);
  const sendGangMessage = useMutation(sendGangMessageRef);
  const [newMessage, setNewMessage] = useState('');

  const handleLeave = async () => {
    if (!playerId) return;
    try {
      await leaveGang({ gangId: gang._id, playerId });
    } catch (e) {
      console.error('Failed to leave gang:', e);
      alert('离开帮派失败');
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !playerId) return;
    try {
      await sendGangMessage({
        gangId: gang._id,
        senderId: playerId,
        content: newMessage.trim(),
      });
      setNewMessage('');
    } catch (e) {
      console.error('Failed to send message:', e);
      alert('发送失败');
    }
  };

  return (
    <div style={{ backgroundColor: COLORS.bgLight, border: `1px solid ${COLORS.border}` }}>
      {/* Gang Header */}
      <div
        className="flex items-center justify-between px-2 py-1 cursor-pointer"
        style={{ backgroundColor: isExpanded ? COLORS.bgDark : COLORS.bgLight }}
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            {isMember && <span style={{ color: COLORS.accent }}>⚔</span>}
            <span className="text-xs truncate" style={{ color: COLORS.text }}>{gang.name}</span>
          </div>
          <span className="text-[10px] truncate block" style={{ color: COLORS.textMuted }}>{gang.motto}</span>
        </div>
        <div className="flex items-center gap-1 ml-1">
          {detail !== undefined && (
            <span className="text-[10px] px-1" style={{ backgroundColor: COLORS.bg, color: COLORS.textMuted }}>
              {detail?.members.length ?? 0}
            </span>
          )}
          <span className="text-xs" style={{ color: COLORS.textMuted }}>{isExpanded ? '▼' : '▶'}</span>
        </div>
      </div>

      {/* Gang Details */}
      {isExpanded && detail && (
        <div className="p-1 border-t" style={{ backgroundColor: COLORS.bg, borderColor: COLORS.border }}>
          {/* Members */}
          <div className="mb-1">
            <span className="text-[10px]" style={{ color: COLORS.accent }}>成员:</span>
            <div className="flex flex-wrap gap-0.5 mt-0.5">
              {detail.members.length === 0 ? (
                <span className="text-[10px]" style={{ color: COLORS.textMuted }}>无</span>
              ) : (
                detail.members.map((member) => {
                  const isAI = member.playerId.startsWith('a:');
                  return (
                    <span
                      key={member._id}
                      className="text-[10px] px-1 py-0.5 border flex items-center gap-0.5"
                      style={{
                        backgroundColor: member.playerId === playerId ? COLORS.accent : isAI ? '#1a3d1a' : COLORS.bgDark,
                        color: member.playerId === playerId ? COLORS.bgDark : isAI ? '#7cb87c' : COLORS.text,
                        borderColor: isAI ? '#4a7c4a' : COLORS.border,
                      }}
                      title={isAI ? 'AI 成员 - 可感知帮派动态' : '玩家成员'}
                    >
                      {member.playerId === gang.founderId ? '👑' : ''}
                      {isAI ? '🤖' : ''}
                      {member.playerId === playerId ? '我' : member.playerId.slice(0, 4)}
                    </span>
                  );
                })
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-1 mb-1">
            {!isMember ? (
              <button
                className="flex-1 py-0.5 text-[10px] border shadow-[1px_1px_0_#000] active:shadow-none active:translate-x-[1px] active:translate-y-[1px]"
                style={{ backgroundColor: COLORS.button, borderColor: COLORS.border, color: COLORS.text }}
                onClick={(e) => { e.stopPropagation(); onJoin(); }}
              >
                加入
              </button>
            ) : (
              <button
                className="flex-1 py-0.5 text-[10px] border shadow-[1px_1px_0_#000] active:shadow-none active:translate-x-[1px] active:translate-y-[1px]"
                style={{ backgroundColor: '#5a2020', borderColor: '#8b4513', color: COLORS.text }}
                onClick={(e) => { e.stopPropagation(); handleLeave(); }}
              >
                离开
              </button>
            )}
          </div>

          {/* Chat - Members Only */}
          {isMember && (
            <div className="border-t pt-1" style={{ borderColor: COLORS.border }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px]" style={{ color: COLORS.accent }}>聊天:</span>
                <div className="flex gap-1">
                  <span
                    className="text-[8px] px-1 py-0.5 border flex items-center gap-0.5"
                    style={{
                      backgroundColor: COLORS.bgDark,
                      borderColor: COLORS.border,
                      color: COLORS.textMuted
                    }}
                    title="只有帮派成员可以看到这些消息"
                  >
                    <span>🔒</span>
                    <span>成员专属</span>
                  </span>
                  <span
                    className="text-[8px] px-1 py-0.5 border flex items-center gap-0.5"
                    style={{
                      backgroundColor: '#1a3d1a',
                      borderColor: '#4a7c4a',
                      color: '#7cb87c'
                    }}
                    title="AI 成员能感知帮派动态并参与群聊"
                  >
                    <span>🤖</span>
                    <span>AI感知</span>
                  </span>
                </div>
              </div>

              {/* Messages */}
              <div
                className="mt-0.5 p-1 space-y-0.5 overflow-y-auto"
                style={{ backgroundColor: COLORS.bgDark, maxHeight: '80px' }}
              >
                {detail.messages.length === 0 ? (
                  <p className="text-[10px] text-center" style={{ color: COLORS.textMuted }}>无消息</p>
                ) : (
                  detail.messages.slice(-10).map((msg) => (
                    <div key={msg._id} className="text-[10px]">
                      <span style={{ color: msg.senderId === playerId ? COLORS.accent : COLORS.textMuted }}>
                        {msg.senderId === playerId ? '我' : msg.senderId.slice(0, 4)}:
                      </span>
                      <span style={{ color: COLORS.text }}> {msg.content}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Input */}
              <div className="flex gap-1 mt-1">
                <input
                  type="text"
                  placeholder="..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  className="flex-1 px-1 py-0.5 text-[10px] border"
                  style={{
                    backgroundColor: COLORS.bgDark,
                    borderColor: COLORS.border,
                    color: COLORS.text,
                    outline: 'none',
                  }}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                />
                <button
                  className="px-1 py-0.5 text-[10px] border shadow-[1px_1px_0_#000] active:shadow-none active:translate-x-[1px] active:translate-y-[1px]"
                  style={{ backgroundColor: COLORS.accent, borderColor: COLORS.borderLight, color: COLORS.bgDark }}
                  onClick={handleSendMessage}
                >
                  ›
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
