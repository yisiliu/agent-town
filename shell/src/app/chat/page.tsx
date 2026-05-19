'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useAction } from 'convex/react';

// String-form function refs — see shell/src/app/upload/page.tsx for the
// rationale. Once `convex codegen` runs against the live deployment
// these can become typed via `api.ours...`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const verifyRef = 'ours/actions/verifyChatAccess:default' as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chatRef = 'ours/actions/chatWithTwin:default' as any;

type AuthState =
  | { state: 'pending' }
  | { state: 'verifying' }
  | { state: 'authed'; pseudonym: string; controlCode: string }
  | { state: 'rejected'; reason: string };

type Turn = { role: 'user' | 'assistant'; content: string };

export default function ChatPage() {
  const [pseudonymInput, setPseudonymInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [auth, setAuth] = useState<AuthState>({ state: 'pending' });
  const [history, setHistory] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const verify = useAction(verifyRef);
  const chat = useAction(chatRef);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [history]);

  const submitAuth = async (e: FormEvent) => {
    e.preventDefault();
    const p = pseudonymInput.trim();
    const c = codeInput.trim();
    if (!p || !/^\d{6}$/.test(c)) return;
    setAuth({ state: 'verifying' });
    try {
      const result = (await verify({ pseudonym: p, controlCode: c })) as
        | { ok: true }
        | { ok: false; reason: string };
      if (result.ok) {
        setAuth({ state: 'authed', pseudonym: p, controlCode: c });
      } else {
        setAuth({ state: 'rejected', reason: result.reason });
      }
    } catch (err) {
      setAuth({ state: 'rejected', reason: (err as Error).message });
    }
  };

  const submitMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (auth.state !== 'authed') return;
    const msg = draft.trim();
    if (!msg) return;
    setSending(true);
    setSendError(null);
    const turnsBeforeSend = history;
    setHistory((prev) => [...prev, { role: 'user', content: msg }]);
    setDraft('');
    try {
      const result = (await chat({
        pseudonym: auth.pseudonym,
        controlCode: auth.controlCode,
        message: msg,
        history: turnsBeforeSend,
      })) as { ok: true; reply: string } | { ok: false; reason: string };
      if (!result.ok) {
        setSendError(`Auth lost: ${result.reason}`);
        setAuth({ state: 'rejected', reason: result.reason });
      } else {
        setHistory((prev) => [
          ...prev,
          { role: 'assistant', content: result.reply },
        ]);
      }
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col gap-4 px-6 py-8">
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Chat with twin</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Private 1-on-1 conversation with your twin. Uses your card.md as the
          persona; history lives in this tab only.
        </p>
      </header>

      {auth.state !== 'authed' && (
        <form onSubmit={submitAuth} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Pseudonym
            <input
              type="text"
              value={pseudonymInput}
              onChange={(e) => setPseudonymInput(e.target.value)}
              placeholder="灯火"
              className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Control code (6 digits)
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="rounded border border-neutral-300 px-3 py-2 font-mono dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <button
            type="submit"
            disabled={
              auth.state === 'verifying' ||
              !pseudonymInput.trim() ||
              !/^\d{6}$/.test(codeInput)
            }
            className="self-start rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {auth.state === 'verifying' ? 'Verifying…' : 'Start chat'}
          </button>
          {auth.state === 'rejected' && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {auth.reason === 'unknown_pseudonym'
                ? 'No twin with that pseudonym.'
                : auth.reason === 'bad_code'
                  ? 'That control code is incorrect.'
                  : auth.reason === 'twin_not_active'
                    ? 'Twin exists but is not in the active state.'
                    : `Authentication failed: ${auth.reason}`}
            </p>
          )}
        </form>
      )}

      {auth.state === 'authed' && (
        <>
          <div
            ref={scrollRef}
            className="flex flex-1 flex-col gap-3 overflow-y-auto rounded border border-neutral-200 p-4 dark:border-neutral-800"
          >
            {history.length === 0 && (
              <p className="text-sm text-neutral-500">
                Say something to {auth.pseudonym}.
              </p>
            )}
            {history.map((turn, i) => (
              <div
                key={i}
                className={[
                  'whitespace-pre-wrap rounded px-3 py-2 text-sm',
                  turn.role === 'user'
                    ? 'self-end bg-blue-100 dark:bg-blue-900/40'
                    : 'self-start bg-neutral-100 dark:bg-neutral-800',
                ].join(' ')}
                style={{ maxWidth: '85%' }}
              >
                <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
                  {turn.role === 'user' ? 'you' : auth.pseudonym}
                </p>
                {turn.content}
              </div>
            ))}
            {sending && (
              <div className="self-start rounded bg-neutral-100 px-3 py-2 text-sm text-neutral-500 dark:bg-neutral-800">
                {auth.pseudonym} is thinking…
              </div>
            )}
          </div>

          <form onSubmit={submitMessage} className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message…"
              disabled={sending}
              className="flex-1 rounded border border-neutral-300 px-3 py-2 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
              autoFocus
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              Send
            </button>
          </form>

          {sendError && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {sendError}
            </p>
          )}
        </>
      )}
    </main>
  );
}
