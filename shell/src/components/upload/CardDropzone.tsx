'use client';

import { useCallback, useState, type DragEvent, type ChangeEvent } from 'react';

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

// Minimal drag-and-drop surface. Accepts .zip only; rejects everything
// else at the boundary so the upload action never sees garbage.
export function CardDropzone({ onFile, disabled }: Props) {
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const name = file.name.toLowerCase();
      const ok = name.endsWith('.zip') || name.endsWith('.md');
      if (!ok) {
        setError(
          '只能上传 card.md（distill 生成的文件）或包含 card.md 的 .zip 包。',
        );
        return;
      }
      setError(null);
      onFile(file);
    },
    [onFile],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setHover(false);
      handle(e.dataTransfer.files[0]);
    },
    [handle],
  );

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      handle(e.target.files?.[0]);
    },
    [handle],
  );

  return (
    <div className="flex flex-col gap-2">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
        className={[
          'block cursor-pointer rounded-lg border-2 border-dashed px-8 py-12 text-center transition',
          hover
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
            : 'border-neutral-300 dark:border-neutral-700',
          disabled ? 'cursor-not-allowed opacity-50' : '',
        ].join(' ')}
      >
        <input
          type="file"
          accept=".zip,application/zip,.md,text/markdown"
          onChange={onChange}
          disabled={disabled}
          className="sr-only"
        />
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {hover
            ? '把文件放到这里'
            : '把数字分身拖到这里，或点击选择文件'}
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          可以是 <code>card.md</code>，也可以是装着{' '}
          <code>card.md</code> + <code>avatar.png</code> 的 <code>.zip</code>。
        </p>
      </label>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
