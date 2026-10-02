'use client';

import { useEffect, useRef, useState } from 'react';

export function DocumentFileActions({
  url,
  filename,
  sensitive = false,
}: {
  url: string;
  filename: string;
  sensitive?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (preview) dialog.current?.showModal();
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);
  async function view() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('The document could not be loaded.');
      const blob = await response.blob();
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(blob.type))
        throw new Error('This file cannot be previewed safely. Download the original instead.');
      setPreview(URL.createObjectURL(blob));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Preview is unavailable.');
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('The file could not be loaded. Try downloading again.');
      const file = new File([await response.blob()], filename, {
        type: response.headers.get('content-type') ?? 'application/pdf',
      });
      if (navigator.canShare?.({ files: [file] }))
        await navigator.share({ files: [file], title: filename });
      else {
        setMessage(
          'File sharing is not supported in this browser. Download the document and attach it to your message.',
        );
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError'))
        setMessage(error instanceof Error ? error.message : 'Sharing is unavailable.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="document-file-actions">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void view();
        }}
      >
        Preview
      </button>
      <a href={url} download={filename}>
        Download
      </a>
      {!sensitive ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void share();
          }}
        >
          {busy ? 'Preparing…' : 'Share file'}
        </button>
      ) : null}
      {message ? <span role="status">{message}</span> : null}
      <dialog ref={dialog} className="document-preview" onClose={() => setPreview(null)}>
        <div>
          <strong>{filename}</strong>
          <button type="button" onClick={() => dialog.current?.close()}>
            Close preview
          </button>
        </div>
        {preview ? <iframe src={preview} sandbox="" title={`Preview of ${filename}`} /> : null}
        <p>If your browser cannot display this file, download the original.</p>
      </dialog>
    </div>
  );
}
