'use client';

import { useEffect, useRef, use, type ReactNode } from 'react';
import { useQuery } from 'convex/react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const spectatorRef = 'ours/queries/spectatorInteraction:default' as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

type Turn = {
  _id: string;
  turnIndex: number;
  phase: string;
  kind: string;
  actorTwinId?: string;
  text: string;
  data?: Record<string, unknown>;
  visibility: 'public' | string[];
  timestamp: number;
};

type SpectatorData = {
  interaction: {
    _id: string;
    type: string;
    status: string;
    phase: string;
    turnIndex: number;
    startedAt: number;
    endedAt?: number;
    winner?: string;
    originType: string;
    worldId?: string;
    publicLog: string[];
    day?: number;
    sheriff?: string;
  };
  nameMap: Record<string, string>;
  turns: Turn[];
};

const PHASE_LABEL: Record<string, string> = {
  'night-werewolf': '🌙 夜·狼人',
  'night-seer': '🌙 夜·预言家',
  'night-witch': '🌙 夜·女巫',
  'night-resolve': '🌙 夜·结算',
  'sheriff-claim': '🏛️ 警长·竞选',
  'sheriff-vote': '🏛️ 警长·投票',
  'sheriff-pk-speech': '🏛️ 警长·PK发言',
  'sheriff-pk-vote': '🏛️ 警长·PK投票',
  'sheriff-pull-vote': '🏛️ 警长·归票',
  'day-speak': '☀️ 白天·发言',
  'day-vote': '☀️ 白天·投票',
  'day-resolve': '☀️ 白天·结算',
  'last-words': '⚰️ 遗言',
  'hunter-shoot': '🏹 猎人开枪',
  ended: '🏁 结束',
};

const KIND_BADGE: Record<string, string> = {
  speak: 'bg-blue-100 text-blue-800',
  vote: 'bg-amber-100 text-amber-800',
  'wolf-kill-bid': 'bg-red-100 text-red-800',
  peek: 'bg-purple-100 text-purple-800',
  'witch-act': 'bg-green-100 text-green-800',
  'last-words': 'bg-neutral-200 text-neutral-800',
  'hunter-shoot': 'bg-rose-100 text-rose-800',
  'sheriff-claim': 'bg-indigo-100 text-indigo-800',
  'sheriff-vote': 'bg-indigo-100 text-indigo-800',
  'sheriff-pk-speech': 'bg-indigo-100 text-indigo-800',
  'sheriff-pk-vote': 'bg-indigo-100 text-indigo-800',
  'sheriff-pull-vote': 'bg-indigo-100 text-indigo-800',
  'self-explode': 'bg-red-700 text-white',
  system: 'bg-neutral-100 text-neutral-600',
  abstain: 'bg-neutral-200 text-neutral-500',
};

export default function DungeonSpectatorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const data = useQuery(spectatorRef, { id }) as SpectatorData | null | undefined;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new turns arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data?.turns.length]);

  if (data === undefined) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-neutral-500">Loading…</p>
      </main>
    );
  }
  if (data === null) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-red-600">Interaction not found.</p>
        <a href="/instructor" className="text-indigo-600 underline">
          Back to dashboard
        </a>
      </main>
    );
  }

  const { interaction, nameMap, turns } = data;
  const nameOf = (id?: string | null) =>
    id ? nameMap[id] ?? id.slice(-6) : 'SYSTEM';

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header className="space-y-2 border-b pb-4 dark:border-neutral-700">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">
            {interaction.type} <span className="text-neutral-500">#{interaction._id.slice(-8)}</span>
          </h1>
          <a href="/instructor" className="text-sm text-indigo-600 underline">
            ← Dashboard
          </a>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Pill>
            Status:{' '}
            <span
              className={
                interaction.status === 'in_progress'
                  ? 'text-green-600 font-semibold'
                  : interaction.status === 'ended'
                    ? 'text-neutral-500'
                    : 'text-amber-600'
              }
            >
              {interaction.status}
            </span>
          </Pill>
          <Pill>Phase: {PHASE_LABEL[interaction.phase] ?? interaction.phase}</Pill>
          <Pill>Turn: {interaction.turnIndex}</Pill>
          {interaction.day !== undefined && <Pill>Day: {interaction.day}</Pill>}
          {interaction.sheriff && (
            <Pill>
              👮 Sheriff: <span className="font-semibold">{nameOf(interaction.sheriff)}</span>
            </Pill>
          )}
          {interaction.winner && (
            <Pill>
              🏆 Winner: <span className="font-semibold">{interaction.winner}</span>
            </Pill>
          )}
          <Pill>Origin: {interaction.originType}</Pill>
        </div>
      </header>

      {interaction.publicLog.length > 0 && (
        <section className="rounded border bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <h2 className="mb-1 text-sm font-semibold">Public log</h2>
          <ul className="space-y-0.5 text-sm">
            {interaction.publicLog.map((line, i) => {
              // Replace any twin IDs in the log with pseudonyms
              let rendered = line;
              for (const [tid, name] of Object.entries(nameMap)) {
                rendered = rendered.replaceAll(tid, name);
              }
              return <li key={i}>· {rendered}</li>;
            })}
          </ul>
        </section>
      )}

      <section
        ref={scrollRef}
        className="max-h-[60vh] space-y-2 overflow-y-auto rounded border p-3 dark:border-neutral-700"
      >
        <h2 className="mb-1 text-sm font-semibold sticky top-0 bg-white pb-2 dark:bg-neutral-950">
          Turns ({turns.length})
        </h2>
        {turns.length === 0 && (
          <p className="text-sm text-neutral-500">Waiting for the first turn…</p>
        )}
        {turns.map((t) => {
          const actor = nameOf(t.actorTwinId);
          const isPublic = t.visibility === 'public';
          const tgtId = (t.data as { target?: string })?.target;
          const tgtName = tgtId ? nameOf(tgtId) : null;
          const thinking = (t.data as { thinking?: string })?.thinking;
          return (
            <article
              key={t._id}
              className={`rounded border p-2 text-sm ${
                isPublic
                  ? 'border-neutral-200 dark:border-neutral-700'
                  : 'border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/20'
              }`}
            >
              <div className="mb-1 flex flex-wrap items-center gap-1 text-xs">
                <span className="text-neutral-400">t={t.turnIndex}</span>
                <span className="text-neutral-500">{PHASE_LABEL[t.phase] ?? t.phase}</span>
                <span
                  className={`rounded px-1.5 py-0.5 ${
                    KIND_BADGE[t.kind] ?? 'bg-neutral-100 text-neutral-700'
                  }`}
                >
                  {t.kind}
                </span>
                <span className="font-semibold">{actor}</span>
                {tgtName && (
                  <span className="text-neutral-500">
                    → <span className="font-semibold">{tgtName}</span>
                  </span>
                )}
                {!isPublic && (
                  <span className="rounded bg-purple-200 px-1 text-xs text-purple-900 dark:bg-purple-800 dark:text-purple-100">
                    private
                  </span>
                )}
              </div>
              {t.text && t.text !== '(no say)' && (
                <p className={t.text.startsWith('(no response') ? 'italic text-neutral-400' : ''}>
                  {t.text}
                </p>
              )}
              {thinking && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-neutral-500">
                    💭 internal thinking
                  </summary>
                  <p className="mt-1 rounded bg-neutral-50 p-2 text-xs italic text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                    {thinking}
                  </p>
                </details>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border px-2 py-0.5 text-xs dark:border-neutral-700">
      {children}
    </span>
  );
}
