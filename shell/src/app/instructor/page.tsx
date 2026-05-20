'use client';

import { useState, type FormEvent } from 'react';
import { useQuery, useMutation } from 'convex/react';

// String-form refs — see chat/page.tsx for rationale.
/* eslint-disable @typescript-eslint/no-explicit-any */
const twinListRef = 'ours/queries/instructorTwinList:default' as any;
const activeInteractionsRef = 'ours/queries/instructorActiveInteractions:default' as any;
const defaultWorldStatusRef = 'ours/queries/defaultWorldStatus:default' as any;
const worldStatusRef = 'ours/queries/worldStatus:default' as any;
const townEventRef = 'ours/queries/getTownEvent:default' as any;
const townAgentsRef = 'ours/queries/instructorTownAgents:default' as any;

const promoteRef = 'ours/mutations/promoteTwinToAgent:default' as any;
const startDungeonRef = 'ours/mutations/startDungeonGame:default' as any;
const setEventRef = 'ours/mutations/setTownEvent:default' as any;
const clearEventRef = 'ours/mutations/clearTownEvent:default' as any;
const freezeRef = 'ours/mutations/devForceFreezeWorld:default' as any;
const resumeRef = 'ours/mutations/devForceResumeWorld:default' as any;
const cancelInteractionRef = 'ours/mutations/cancelInteraction:default' as any;
// ai-town engine controls (testing.ts exports these as public mutations)
const aiTownResumeRef = 'testing:resume' as any;
const aiTownStopRef = 'testing:stop' as any;
const aiTownKickRef = 'testing:kick' as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

type TownAgent = {
  playerId: string;
  name: string;
  position: { x: number; y: number };
  inDungeon: boolean;
};

type Twin = {
  _id: string;
  pseudonym: string;
  state: string;
  hasCard: boolean;
  createdAt: number;
  isSynthetic: boolean;
};

type Interaction = {
  _id: string;
  type: string;
  status: string;
  phase: string;
  turnIndex: number;
  participantCount: number;
  originType: string;
  worldId?: string;
  startedAt: number;
  endedAt?: number;
  winner?: string;
};

export default function InstructorDashboard() {
  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="border-b pb-4 dark:border-neutral-700">
        <h1 className="text-2xl font-bold">教师控制台</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          能用就行，样式以后再说 · v1
        </p>
      </header>

      <WorldSection />
      <TownEventSection />
      <TwinsSection />
      <DungeonsSection />
    </main>
  );
}

function WorldSection() {
  const defaultWorld = useQuery(defaultWorldStatusRef, {}) as
    | { worldId: string; status: string }
    | null
    | undefined;
  const fullStatus = useQuery(worldStatusRef, {}) as
    | { state: string; nextChange?: number }
    | null
    | undefined;
  const freeze = useMutation(freezeRef);
  const resume = useMutation(resumeRef);
  const aiTownResume = useMutation(aiTownResumeRef);
  const aiTownStop = useMutation(aiTownStopRef);
  const aiTownKick = useMutation(aiTownKickRef);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFrozen = fullStatus?.state === 'frozen';
  const engineStopped =
    defaultWorld?.status === 'stoppedByDeveloper' ||
    defaultWorld?.status === 'inactive';
  const engineRunning = defaultWorld?.status === 'running';

  const wrap = async (fn: () => Promise<unknown>) => {
    setPending(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };

  return (
    <section className="space-y-3 rounded border p-4 dark:border-neutral-700">
      <h2 className="text-lg font-semibold">小镇状态</h2>
      {defaultWorld === undefined && <p>加载中…</p>}
      {defaultWorld === null && (
        <p className="text-amber-600">还没有默认世界，先初始化 ai-town。</p>
      )}
      {defaultWorld && (
        <>
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-neutral-500">世界 ID：</span>{' '}
              <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">
                {defaultWorld.worldId}
              </code>
            </div>
            <div>
              <span className="text-neutral-500">ai-town 引擎：</span>{' '}
              <code
                className={
                  engineRunning
                    ? 'text-green-600 font-semibold'
                    : engineStopped
                      ? 'text-red-600 font-semibold'
                      : 'text-amber-600'
                }
              >
                {defaultWorld.status}
              </code>
              {engineStopped && (
                <span className="ml-2 text-xs text-red-600">
                  ⚠ 引擎停止时 AI 角色不会移动，点「启动引擎」恢复
                </span>
              )}
            </div>
            <div>
              <span className="text-neutral-500">课时状态：</span>{' '}
              <code className={isFrozen ? 'text-blue-600' : 'text-green-600'}>
                {fullStatus?.state ?? 'unknown'}
              </code>
              <span className="ml-2 text-xs text-neutral-500">
                （上课/下课的时间表，与 ai-town 引擎不同）
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => wrap(() => aiTownResume({}))}
              disabled={pending || engineRunning}
              className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              启动引擎
            </button>
            <button
              onClick={() => wrap(() => aiTownStop({}))}
              disabled={pending || engineStopped}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              停止引擎
            </button>
            <button
              onClick={() => wrap(() => aiTownKick({}))}
              disabled={pending}
              className="rounded bg-yellow-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              title="强制推进一帧——当引擎在线但看起来卡住时有用"
            >
              踢一下
            </button>
            <div className="ml-4 border-l pl-4 dark:border-neutral-700">
              <button
                onClick={() => wrap(() => freeze({}))}
                disabled={pending || isFrozen}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                下课（冻结）
              </button>
              <button
                onClick={() => wrap(() => resume({}))}
                disabled={pending || !isFrozen}
                className="ml-2 rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                上课（恢复）
              </button>
            </div>
          </div>
          {error && <p className="text-red-600">{error}</p>}
        </>
      )}
    </section>
  );
}

function TownEventSection() {
  const defaultWorld = useQuery(defaultWorldStatusRef, {}) as
    | { worldId: string }
    | null
    | undefined;
  const event = useQuery(
    townEventRef,
    defaultWorld ? { worldId: defaultWorld.worldId } : 'skip',
  ) as
    | { eventText: string; setAt: number; agentsAffected: number }
    | null
    | undefined;
  const setEvent = useMutation(setEventRef);
  const clearEvent = useMutation(clearEventRef);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!defaultWorld) return null;

  const onSet = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setPending(true); setError(null);
    try {
      await setEvent({ worldId: defaultWorld.worldId, eventText: draft.trim() });
      setDraft('');
    } catch (err) { setError((err as Error).message); }
    finally { setPending(false); }
  };
  const onClear = async () => {
    setPending(true); setError(null);
    try { await clearEvent({ worldId: defaultWorld.worldId }); }
    catch (err) { setError((err as Error).message); }
    finally { setPending(false); }
  };

  return (
    <section className="space-y-3 rounded border p-4 dark:border-neutral-700">
      <h2 className="text-lg font-semibold">小镇事件（全局开关）</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        在所有 AI 的人设前面加一段背景。大概 30 秒后，下一轮对话就会带上。
      </p>
      {event && (
        <div className="rounded bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <div className="font-semibold">当前事件：</div>
          <div className="italic">"{event.eventText}"</div>
          <div className="mt-1 text-neutral-500">
            {new Date(event.setAt).toLocaleTimeString()} 设的 · 影响 {event.agentsAffected} 位 AI
          </div>
        </div>
      )}
      <form onSubmit={onSet} className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="例：下雨了 / 来了个陌生人 / 学校着火了"
          className="flex-1 rounded border px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="rounded bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          设置
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={pending || !event}
          className="rounded border px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-600"
        >
          清除
        </button>
      </form>
      {error && <p className="text-red-600">{error}</p>}
    </section>
  );
}

function TwinsSection() {
  const twins = useQuery(twinListRef, { limit: 50 }) as Twin[] | undefined;
  const promote = useMutation(promoteRef);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'student' | 'synthetic'>('all');

  const onPromote = async (twinId: string) => {
    setPendingId(twinId); setError(null);
    try {
      await promote({ twinId });
    } catch (e) { setError((e as Error).message); }
    finally { setPendingId(null); }
  };

  const filtered = (twins ?? []).filter((t) => {
    if (filter === 'student') return !t.isSynthetic && t.state === 'active';
    if (filter === 'synthetic') return t.isSynthetic;
    return true;
  });

  const FILTER_LABEL: Record<typeof filter, string> = {
    all: '全部',
    student: '学生',
    synthetic: 'AI 合成',
  };

  return (
    <section className="space-y-3 rounded border p-4 dark:border-neutral-700">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          数字分身（{filtered.length}{twins ? ` / 共 ${twins.length}` : ''}）
        </h2>
        <div className="flex gap-2 text-sm">
          {(['all', 'student', 'synthetic'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-1 ${filter === f ? 'bg-neutral-200 dark:bg-neutral-700' : ''}`}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </div>
      {twins === undefined && <p>加载中…</p>}
      {twins && twins.length === 0 && <p className="text-neutral-500">还没有数字分身。</p>}
      {filtered.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-1">化名</th>
              <th className="py-1">状态</th>
              <th className="py-1">来源</th>
              <th className="py-1">卡片</th>
              <th className="py-1">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t._id} className="border-t dark:border-neutral-800">
                <td className="py-2">{t.pseudonym}</td>
                <td className="py-2">
                  <span className={
                    t.state === 'active' ? 'text-green-600' :
                    t.state === 'rejected' ? 'text-red-600' :
                    'text-neutral-500'
                  }>{t.state}</span>
                </td>
                <td className="py-2 text-neutral-500">
                  {t.isSynthetic ? 'AI 合成' : '学生'}
                </td>
                <td className="py-2">{t.hasCard ? '✓' : '—'}</td>
                <td className="py-2">
                  <button
                    onClick={() => onPromote(t._id)}
                    disabled={pendingId === t._id || t.state !== 'active' || !t.hasCard}
                    className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    {pendingId === t._id ? '...' : '放进小镇'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </section>
  );
}

function DungeonsSection() {
  const interactions = useQuery(activeInteractionsRef, {}) as Interaction[] | undefined;
  const defaultWorld = useQuery(defaultWorldStatusRef, {}) as
    | { worldId: string }
    | null
    | undefined;
  const townAgents = useQuery(
    townAgentsRef,
    defaultWorld ? { worldId: defaultWorld.worldId } : 'skip',
  ) as TownAgent[] | undefined;
  const startDungeon = useMutation(startDungeonRef);
  const cancel = useMutation(cancelInteractionRef);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [seed, setSeed] = useState('');
  const [gameType, setGameType] = useState('werewolf');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastStarted, setLastStarted] = useState<string | null>(null);

  const toggle = (playerId: string) => {
    const next = new Set(selected);
    if (next.has(playerId)) next.delete(playerId);
    else next.add(playerId);
    setSelected(next);
  };

  const onStartDungeon = async () => {
    if (!defaultWorld) { setError('No default world'); return; }
    setPending(true); setError(null); setLastStarted(null);
    try {
      const args: Record<string, unknown> = {
        worldId: defaultWorld.worldId,
        type: gameType,
        playerIds: Array.from(selected),
      };
      const trimmedSeed = seed.trim();
      if (trimmedSeed) args.seed = parseInt(trimmedSeed, 10);
      const result = (await startDungeon(args)) as { interactionId: string };
      setLastStarted(result.interactionId);
      setSelected(new Set());
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };

  const onCancel = async (id: string) => {
    setPending(true); setError(null);
    try { await cancel({ interactionId: id, reason: 'dashboard cancel' }); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };

  const availableAgents = (townAgents ?? []).filter((a) => !a.inDungeon);
  const inDungeonAgents = (townAgents ?? []).filter((a) => a.inDungeon);

  return (
    <section className="space-y-3 rounded border p-4 dark:border-neutral-700">
      <h2 className="text-lg font-semibold">副本（小游戏）</h2>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-neutral-500">进行中 / 近期</h3>
        {interactions === undefined && <p>加载中…</p>}
        {interactions && interactions.length === 0 && (
          <p className="text-neutral-500">还没有副本。</p>
        )}
        {interactions && interactions.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-1">类型</th>
                <th className="py-1">状态</th>
                <th className="py-1">阶段</th>
                <th className="py-1">回合</th>
                <th className="py-1">人数</th>
                <th className="py-1">来源</th>
                <th className="py-1">胜者</th>
                <th className="py-1">操作</th>
              </tr>
            </thead>
            <tbody>
              {interactions.map((i) => (
                <tr key={i._id} className="border-t dark:border-neutral-800">
                  <td className="py-2">{i.type}</td>
                  <td className="py-2">
                    <span className={
                      i.status === 'in_progress' ? 'text-green-600' :
                      i.status === 'ended' ? 'text-neutral-500' :
                      'text-amber-600'
                    }>{
                      i.status === 'in_progress' ? '进行中' :
                      i.status === 'ended' ? '已结束' :
                      i.status
                    }</span>
                  </td>
                  <td className="py-2">{i.phase}</td>
                  <td className="py-2">{i.turnIndex}</td>
                  <td className="py-2">{i.participantCount}</td>
                  <td className="py-2 text-xs">{i.originType === 'dungeon' ? '副本' : '独立'}</td>
                  <td className="py-2">{i.winner ?? '—'}</td>
                  <td className="py-2 space-x-2">
                    <a
                      href={`/dungeons/${i._id}`}
                      className="text-indigo-600 text-xs underline"
                    >
                      围观
                    </a>
                    {i.status === 'in_progress' && (
                      <button
                        onClick={() => onCancel(i._id)}
                        disabled={pending}
                        className="text-red-600 text-xs underline"
                      >
                        取消
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="space-y-2 border-t pt-3 dark:border-neutral-800">
        <h3 className="text-sm font-semibold text-neutral-500">
          开新副本——从小镇里挑 AI 角色
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={gameType}
            onChange={(e) => setGameType(e.target.value)}
            placeholder="werewolf"
            className="rounded border px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            type="text"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="随机种子（可选）"
            className="rounded border px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            onClick={onStartDungeon}
            disabled={pending || selected.size < 2}
            className="rounded bg-purple-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {pending ? '…' : `开 ${gameType}（已选 ${selected.size} 人）`}
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-neutral-500 underline"
            >
              清空
            </button>
          )}
        </div>
        {lastStarted && (
          <p className="text-sm text-green-600">
            ✓ 已开始！<a href={`/dungeons/${lastStarted}`} className="underline">点击围观 →</a>
          </p>
        )}
        <div className="space-y-1">
          <p className="text-xs text-neutral-500">
            小镇里能选的 AI（{availableAgents.length} 位）。点一下加进来，再点取消。
          </p>
          <div className="flex flex-wrap gap-1">
            {availableAgents.map((a) => (
              <button
                key={a.playerId}
                onClick={() => toggle(a.playerId)}
                title={`${a.playerId} @ (${a.position.x},${a.position.y})`}
                className={`rounded px-2 py-0.5 text-xs ${
                  selected.has(a.playerId)
                    ? 'bg-purple-600 text-white'
                    : 'bg-neutral-100 dark:bg-neutral-800'
                }`}
              >
                {a.name}
              </button>
            ))}
            {availableAgents.length === 0 && (
              <p className="text-xs text-amber-600">
                小镇里还没有 AI 角色。先把数字分身「放进小镇」。
              </p>
            )}
          </div>
          {inDungeonAgents.length > 0 && (
            <p className="text-xs text-neutral-500">
              副本里的（暂时不在镇上）：{inDungeonAgents.map((a) => a.name).join('、')}
            </p>
          )}
        </div>
        {error && <p className="text-red-600 text-sm whitespace-pre-line">{error}</p>}
      </div>
    </section>
  );
}
