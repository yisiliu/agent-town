'use client';

import { useState } from 'react';
import { useAction, useQuery, useMutation } from 'convex/react';
import { CardDropzone } from '@/components/upload/CardDropzone';

// Convex function references — stubbed _generated/api has no typed
// surface, so we use string-form refs. They resolve at runtime against
// the deployment named by NEXT_PUBLIC_CONVEX_URL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const uploadTwinRef = 'ours/actions/uploadTwin:default' as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resultRef = 'ours/queries/uploadResultByToken:byToken' as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clearResultRef = 'ours/mutations/clearUploadResult:default' as any;

type UploadResult =
  | null
  | {
      state: 'pending' | 'active' | 'rejected';
      codes?: { spectate: string; control: string; edit: string };
      errors?: string[];
    };

export default function UploadPage() {
  const [token, setToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const uploadTwin = useAction(uploadTwinRef);
  const clearResult = useMutation(clearResultRef);
  const result = useQuery(
    resultRef,
    token ? { uploadSessionToken: token } : 'skip',
  ) as UploadResult;

  const submit = async (file: File) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const buf = await file.arrayBuffer();
      const fileBase64 = arrayBufferToBase64(buf);
      const { uploadSessionToken } = (await uploadTwin({ fileBase64 })) as {
        uploadSessionToken: string;
      };
      setToken(uploadSessionToken);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const acknowledge = async () => {
    if (!token) return;
    await clearResult({ uploadSessionToken: token });
    setConfirmed(true);
    setToken(null);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-2xl font-medium tracking-tight">上传你的数字分身</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          拖一份 <code>distill build</code> 出来的卡片进来。我们会检查格式、扫一遍隐私信息和注入，没问题就发你三个码。
        </p>
        <p className="mt-2 text-sm">
          <a
            href="/spec"
            className="text-indigo-600 underline hover:text-indigo-700"
          >
            看 card.md 格式说明 →
          </a>
        </p>
      </header>

      {!token && !confirmed && (
        <CardDropzone onFile={submit} disabled={submitting} />
      )}

      {submitting && (
        <p className="text-sm text-neutral-600">正在上传 + 扫描…</p>
      )}

      {submitError && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200">
          上传失败：{submitError}
        </p>
      )}

      {token && result?.state === 'pending' && (
        <p className="text-sm text-neutral-600">
          正在扫描，扫完页面会自动刷新。
        </p>
      )}

      {token && result?.state === 'rejected' && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm dark:border-red-700 dark:bg-red-950/30">
          <p className="font-medium text-red-700 dark:text-red-200">
            这份分身没过审。问题在这：
          </p>
          <ul className="mt-2 list-disc pl-5 text-red-700 dark:text-red-200">
            {result.errors?.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-red-600 dark:text-red-300">
            把标红的地方删掉再传一次，或者找老师手动放行。
          </p>
        </div>
      )}

      {token && result?.state === 'active' && result.codes && (
        <div className="rounded border border-green-400 bg-green-50 p-4 text-sm dark:border-green-700 dark:bg-green-950/30">
          <p className="font-medium text-green-800 dark:text-green-100">
            数字分身已创建。请保存以下三个访问码——它们只会显示一次。
          </p>
          <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-2 font-mono text-base">
            <dt className="text-neutral-500">
              控制码
              <div className="font-sans text-xs text-neutral-500">
                现在去 <a href="/chat" className="underline">/chat</a> 跟你的分身私聊
              </div>
            </dt>
            <dd>{result.codes.control}</dd>
            <dt className="text-neutral-500">
              观察码
              <div className="font-sans text-xs text-neutral-500">
                分享给同学让他们看你的分身怎么聊（未来 feature）
              </div>
            </dt>
            <dd>{result.codes.spectate}</dd>
            <dt className="text-neutral-500">
              编辑码
              <div className="font-sans text-xs text-neutral-500">
                日后改 card.md 时用（未来 feature）
              </div>
            </dt>
            <dd>{result.codes.edit}</dd>
          </dl>
          <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
            截图 / 写下来。关闭页面后再也看不到。控制码丢了就找不回你的分身了。
          </p>
          <button
            type="button"
            onClick={acknowledge}
            className="mt-4 rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800"
          >
            我已经记下这三个访问码
          </button>
        </div>
      )}

      {confirmed && (
        <p className="text-sm text-neutral-600">
          已确认。现在你可以去 <a href="/chat" className="underline">/chat</a> 跟自己的分身聊天，或打开 <a href="https://ai-town-fork.vercel.app" className="underline" target="_blank" rel="noreferrer">2D 小镇</a> 找到它。
        </p>
      )}
    </main>
  );
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}
