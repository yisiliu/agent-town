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
      if (!file.name.toLowerCase().endsWith('.zip')) {
        setError('Twin upload must be a .zip containing card.md (and optional avatar.png).');
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
          accept=".zip,application/zip"
          onChange={onChange}
          disabled={disabled}
          className="sr-only"
        />
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {hover ? 'Drop the twin .zip here' : 'Drag a twin .zip here, or click to choose'}
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Contents: <code>card.md</code> + optional <code>avatar.png</code>
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
