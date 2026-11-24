import React, { useEffect, useState } from 'react';
import { STORAGE_KEY } from './game';

const MAX_BYTES = 256 * 1024;

function legacyBrowserData() {
  let value;
  try { value = localStorage.getItem(STORAGE_KEY); }
  catch { return { unavailable: true }; }
  if (value === null) return {};
  try {
    const rows = JSON.parse(value);
    if (Array.isArray(rows)) return { rows };
  } catch { /* Invalid browser data remains available in its original storage. */ }
  return { malformed: true };
}

async function importScores(scores, signal) {
  const response = await fetch('/api/scores/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scores }),
    signal,
  });
  if (!response.ok) throw new Error('import failed');
  return response.json();
}

export function LegacyScores() {
  const [legacy] = useState(legacyBrowserData);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!legacy.rows?.length) return;
    const controller = new AbortController();
    setBusy(true);
    importScores(legacy.rows, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]))
      .then(setResult)
      .catch(() => {
        if (!controller.signal.aborted) setError('Automatic import failed. You can export your existing scores or upload them again.');
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [legacy]);

  function exportFile() {
    const file = new Blob([JSON.stringify({ format: STORAGE_KEY, scores: legacy.rows }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'defuse-legacy-scores.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function importFile(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setResult(null);
    setError('');
    setBusy(true);
    try {
      if (file.size > MAX_BYTES) throw new Error('invalid file');
      let rows;
      try {
        const document = JSON.parse(await file.text());
        rows = Array.isArray(document) ? document : document?.scores;
        if (!Array.isArray(rows)) throw new Error();
      } catch { throw new Error('invalid file'); }
      setResult(await importScores(rows, AbortSignal.timeout(5000)));
    } catch (error) {
      setError(error.message === 'invalid file' ? 'Choose a DEFUSE score export or a JSON array under 256 KB.' :
        'Scores could not be imported. The file is still available to retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="session-details">
      <summary>Transfer browser scores</summary>
      {legacy.unavailable && <p>Browser storage is unavailable here. Import a JSON export from the original browser.</p>}
      {legacy.malformed && <p>The legacy browser score data could not be read.</p>}
      {!legacy.rows && !legacy.unavailable && !legacy.malformed && <p>No legacy scores were found at this address. Use the original browser and console address to export them.</p>}
      {legacy.rows?.length > 0 && <button className="button button-quiet" type="button" onClick={exportFile}>Export legacy JSON</button>}
      <p><label>Import legacy JSON <input type="file" accept="application/json,.json" disabled={busy} onChange={importFile} /></label></p>
      {busy && <p role="status">Checking legacy scores…</p>}
      {result && <p role="status">{result.imported} imported, {result.skipped} skipped, {result.invalid} invalid, {result.conflicts} conflicting.</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
