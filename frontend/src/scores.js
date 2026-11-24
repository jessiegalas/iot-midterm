import { useEffect, useRef, useState } from 'react';

const PENDING = 'defuse.pending-score.';

async function request(path, signal, payload) {
  const response = await fetch(path, {
    signal,
    ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}),
  });
  if (!response.ok) throw Object.assign(new Error('Score service request failed'), { status: response.status });
  return response.json();
}

function readPending() {
  const scores = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PENDING)) continue;
      try {
        const row = JSON.parse(localStorage.getItem(key));
        if (row?.id && key === PENDING + row.id) scores.push(row);
      } catch { /* Ignore damaged browser data. */ }
    }
  } catch { /* The current tab can still save while it remains open. */ }
  return scores;
}

export function useServerScores(game) {
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState(false);
  const [states, setStates] = useState({});
  const queue = useRef(new Map());
  const finished = useRef(new Set());
  const refresh = useRef(null);

  useEffect(() => {
    let busy = false;
    const controller = new AbortController();
    const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
    async function sync() {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        for (const row of readPending()) {
          if (!finished.current.has(row.id) && !queue.current.has(row.id)) queue.current.set(row.id, { row, durable: true });
        }
        for (const [id, item] of queue.current) {
          if (item.invalid) continue;
          setStates(previous => ({ ...previous, [id]: 'saving' }));
          try {
            await request('/api/scores', signal(), item.row);
            finished.current.add(id);
            queue.current.delete(id);
            try { localStorage.removeItem(PENDING + id); } catch { /* A duplicate can be acknowledged on retry. */ }
            setStates(previous => ({ ...previous, [id]: 'saved' }));
          } catch (error) {
            if (controller.signal.aborted) return;
            item.invalid = error.status === 400 || error.status === 409;
            setStates(previous => ({ ...previous, [id]: item.invalid || !item.durable ? 'failed' : 'pending' }));
          }
        }
        try {
          const result = await request('/api/scores', signal());
          setScores(result.scores);
          setStorageError(false);
        } catch {
          if (!controller.signal.aborted) setStorageError(true);
        }
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    refresh.current = sync;
    const interval = setInterval(sync, 2500);
    window.addEventListener('storage', sync);
    window.addEventListener('online', sync);
    void sync();
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('storage', sync);
      window.removeEventListener('online', sync);
      refresh.current = null;
    };
  }, []);

  useEffect(() => {
    if (game.device || game.phase !== 'won' || !game.id || queue.current.has(game.id) || finished.current.has(game.id)) return;
    const { id, defuser, expert, remaining, attempts } = game;
    const row = { id, defuser, expert, remaining, attempts, date: Date.now() };
    let durable = false;
    try {
      localStorage.setItem(PENDING + id, JSON.stringify(row));
      durable = true;
    } catch { /* A live server can still save this run. */ }
    queue.current.set(id, { row, durable });
    setStates(previous => ({ ...previous, [id]: 'saving' }));
    void refresh.current?.();
  }, [game]);

  return { scores, loading, storageError, states };
}

export const saveMessages = {
  saving: 'Saving score…',
  saved: 'Score saved to the leaderboard.',
  pending: 'Score pending. It will be retried automatically.',
  failed: 'Score could not be saved.',
};
