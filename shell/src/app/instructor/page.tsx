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
        <h1 className="text-2xl font-bold">Instructor Dashboard</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Ugly-but-functional. v1.
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFrozen = fullStatus?.state === 'frozen';

  const onFreeze = async () => {
    setPending(true); setError(null);
    try { await freeze({}); } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };
  const onResume = async () => {
    setPending(true); setError(null);
    try { await resume({}); } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };

  return (
    <section className="space-y-3 rounded border p-4 dark:border-neutral-700">
      <h2 className="text-lg font-semibold">Town State</h2>
      {defaultWorld === undefined && <p>Loading…</p>}
      {defaultWorld === null && (
        <p className="text-amber-600">No default world. Run ai-town init first.</p>
      )}
      {defaultWorld && (
        <>
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-neutral-500">worldId:</span>{' '}
              <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">
                {defaultWorld.worldId}
              </code>
            </div>
            <div>
              <span className="text-neutral-500">engine status:</span>{' '}
              <code>{defaultWorld.status}</code>
            </div>
            <div>
              <span className="text-neutral-500">town state:</span>{' '}
              <code className={isFrozen ? 'text-blue-600' : 'text-green-600'}>
                {fullStatus?.state ?? 'unknown'}
              </code>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onFreeze}
              disabled={pending || isFrozen}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Freeze
            </button>
            <button
              onClick={onResume}
              disabled={pending || !isFrozen}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Resume
            </button>
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
      <h2 className="text-lg font-semibold">Town Event (knob)</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Prepends a context line to every alive agent's identity. ~30s for the next conversation_reply to reflect it.
      </p>
      {event && (
        <div className="rounded bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <div className="font-semibold">Currently set:</div>
          <div className="italic">"{event.eventText}"</div>
          <div className="mt-1 text-neutral-500">
            Affecting {event.agentsAffected} agents · since {new Date(event.setAt).toLocaleTimeString()}
          </div>
        </div>
      )}
      <form onSubmit={onSet} className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g., 一场暴风雨刚刚袭击了小镇 / A stranger arrived in town"
          className="flex-1 rounded border px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="rounded bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Set
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={pending || !event}
          className="rounded border px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-600"
        >
          Clear
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

  return (
    <section className="space-y-3 rounded border p-4 dark:border-neutral-700">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Twins ({filtered.length}{twins ? ` of ${twins.length}` : ''})
        </h2>
        <div className="flex gap-2 text-sm">
          {(['all', 'student', 'synthetic'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-1 ${filter === f ? 'bg-neutral-200 dark:bg-neutral-700' : ''}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {twins === undefined && <p>Loading…</p>}
      {twins && twins.length === 0 && <p className="text-neutral-500">No twins yet.</p>}
      {filtered.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-1">Pseudonym</th>
              <th className="py-1">State</th>
              <th className="py-1">Source</th>
              <th className="py-1">Card</th>
              <th className="py-1">Action</th>
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
                  {t.isSynthetic ? 'synthetic' : 'student'}
                </td>
                <td className="py-2">{t.hasCard ? '✓' : '—'}</td>
                <td className="py-2">
                  <button
                    onClick={() => onPromote(t._id)}
                    disabled={pendingId === t._id || t.state !== 'active' || !t.hasCard}
                    className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    {pendingId === t._id ? '...' : 'Promote → town'}
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
      <h2 className="text-lg font-semibold">Dungeons</h2>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-neutral-500">Active / recent</h3>
        {interactions === undefined && <p>Loading…</p>}
        {interactions && interactions.length === 0 && (
          <p className="text-neutral-500">No dungeons yet.</p>
        )}
        {interactions && interactions.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-1">Type</th>
                <th className="py-1">Status</th>
                <th className="py-1">Phase</th>
                <th className="py-1">Turn</th>
                <th className="py-1">Players</th>
                <th className="py-1">Origin</th>
                <th className="py-1">Winner</th>
                <th className="py-1">Action</th>
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
                    }>{i.status}</span>
                  </td>
                  <td className="py-2">{i.phase}</td>
                  <td className="py-2">{i.turnIndex}</td>
                  <td className="py-2">{i.participantCount}</td>
                  <td className="py-2 text-xs">{i.originType}</td>
                  <td className="py-2">{i.winner ?? '—'}</td>
                  <td className="py-2 space-x-2">
                    <a
                      href={`/dungeons/${i._id}`}
                      className="text-indigo-600 text-xs underline"
                    >
                      watch
                    </a>
                    {i.status === 'in_progress' && (
                      <button
                        onClick={() => onCancel(i._id)}
                        disabled={pending}
                        className="text-red-600 text-xs underline"
                      >
                        cancel
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
          Start new dungeon — pick agents from the town
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
            placeholder="seed (optional)"
            className="rounded border px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            onClick={onStartDungeon}
            disabled={pending || selected.size < 2}
            className="rounded bg-purple-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {pending ? '…' : `Start ${gameType} (${selected.size})`}
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-neutral-500 underline"
            >
              clear
            </button>
          )}
        </div>
        {lastStarted && (
          <p className="text-sm text-green-600">
            ✓ Started! <a href={`/dungeons/${lastStarted}`} className="underline">Watch →</a>
          </p>
        )}
        <div className="space-y-1">
          <p className="text-xs text-neutral-500">
            Available agents in town ({availableAgents.length}). Click to toggle selection.
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
                No agents in town yet. Promote some twins to the town first.
              </p>
            )}
          </div>
          {inDungeonAgents.length > 0 && (
            <p className="text-xs text-neutral-500">
              Currently in a dungeon (teleported away):{' '}
              {inDungeonAgents.map((a) => a.name).join(', ')}
            </p>
          )}
        </div>
        {error && <p className="text-red-600 text-sm whitespace-pre-line">{error}</p>}
      </div>
    </section>
  );
}
