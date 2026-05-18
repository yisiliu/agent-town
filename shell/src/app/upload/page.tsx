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
      const zipBase64 = arrayBufferToBase64(buf);
      const { uploadSessionToken } = (await uploadTwin({ zipBase64 })) as {
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
        <h1 className="text-2xl font-medium tracking-tight">Upload twin</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Drop the bundle <code>distill build</code> produced. Server validates
          the schema, scans for PII and prompt injection, and issues access
          codes.
        </p>
      </header>

      {!token && !confirmed && (
        <CardDropzone onFile={submit} disabled={submitting} />
      )}

      {submitting && (
        <p className="text-sm text-neutral-600">Uploading + scanning…</p>
      )}

      {submitError && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200">
          Upload failed: {submitError}
        </p>
      )}

      {token && result?.state === 'pending' && (
        <p className="text-sm text-neutral-600">
          Scans running. This page updates when they finish.
        </p>
      )}

      {token && result?.state === 'rejected' && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm dark:border-red-700 dark:bg-red-950/30">
          <p className="font-medium text-red-700 dark:text-red-200">
            Twin rejected. The scans flagged:
          </p>
          <ul className="mt-2 list-disc pl-5 text-red-700 dark:text-red-200">
            {result.errors?.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-red-600 dark:text-red-300">
            Edit the card to remove the flagged content and re-upload, or ask the
            instructor to review.
          </p>
        </div>
      )}

      {token && result?.state === 'active' && result.codes && (
        <div className="rounded border border-green-400 bg-green-50 p-4 text-sm dark:border-green-700 dark:bg-green-950/30">
          <p className="font-medium text-green-800 dark:text-green-100">
            Twin created. Save these three codes — they appear only once.
          </p>
          <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-1 font-mono text-base">
            <dt className="text-neutral-500">spectate</dt>
            <dd>{result.codes.spectate}</dd>
            <dt className="text-neutral-500">control</dt>
            <dd>{result.codes.control}</dd>
            <dt className="text-neutral-500">edit</dt>
            <dd>{result.codes.edit}</dd>
          </dl>
          <button
            type="button"
            onClick={acknowledge}
            className="mt-4 rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800"
          >
            I&apos;ve saved these securely
          </button>
        </div>
      )}

      {confirmed && (
        <p className="text-sm text-neutral-600">
          Codes acknowledged. You can close this tab.
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
