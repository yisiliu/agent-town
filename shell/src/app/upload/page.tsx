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
          把 <code>distill build</code> 生成的卡片拖到下方。服务器会校验格式，扫描隐私信息（PII）和提示词注入，通过后给你三个访问码。
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
          扫描进行中，扫描完成后此页面会自动更新。
        </p>
      )}

      {token && result?.state === 'rejected' && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm dark:border-red-700 dark:bg-red-950/30">
          <p className="font-medium text-red-700 dark:text-red-200">
            这份数字分身暂时没通过审核。扫描发现以下问题：
          </p>
          <ul className="mt-2 list-disc pl-5 text-red-700 dark:text-red-200">
            {result.errors?.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-red-600 dark:text-red-300">
            修改卡片，删除被标记的内容后重新上传，或者联系老师人工审核。
          </p>
        </div>
      )}

      {token && result?.state === 'active' && result.codes && (
        <div className="rounded border border-green-400 bg-green-50 p-4 text-sm dark:border-green-700 dark:bg-green-950/30">
          <p className="font-medium text-green-800 dark:text-green-100">
            数字分身已创建。请保存以下三个访问码——它们只会显示一次。
          </p>
          <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-1 font-mono text-base">
            <dt className="text-neutral-500">观察</dt>
            <dd>{result.codes.spectate}</dd>
            <dt className="text-neutral-500">控制</dt>
            <dd>{result.codes.control}</dd>
            <dt className="text-neutral-500">编辑</dt>
            <dd>{result.codes.edit}</dd>
          </dl>
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
          已确认。你可以关闭此页面。
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
