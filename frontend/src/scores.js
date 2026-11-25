import { useCallback, useEffect, useRef, useState } from 'react';
import { gameReducer } from './game';

const PENDING = 'defuse.pending-score.';
const TERMINAL = new Set(['won', 'lost', 'aborted', 'interrupted']);

async function request(path, { signal, payload, keepalive = false } = {}) {
  const response = await fetch(path, {
    signal, keepalive,
    ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}),
  });
  if (!response.ok) throw Object.assign(new Error('Run service request failed'), { status: response.status });
  return response.json();
}

function readPending() {
  const rows = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PENDING)) continue;
      try {
        const row = JSON.parse(localStorage.getItem(key));
        if (row?.id && key === PENDING + row.id) rows.push(row);
      } catch { /* Ignore damaged browser data. */ }
    }
  } catch { /* The current tab can still save while it remains open. */ }
  return rows;
}

export function useRunRecorder(game) {
  const [states, setStates] = useState({});
  const [reveals, setReveals] = useState(null);
  const queue = useRef(new Map());
  const last = useRef(null);
  const current = useRef(game);

  const submit = useCallback((item, keepalive = false) => {
    if (item.invalid) return Promise.resolve(false);
    if (item.saving) return item.saving;
    const { row } = item;
    if (TERMINAL.has(row.phase)) setStates(prev => ({ ...prev, [row.id]: 'saving' }));
    item.saving = request(row.phase ? '/api/runs' : '/api/scores', {
      payload: row, keepalive, signal: keepalive ? undefined : AbortSignal.timeout(5000),
    }).then(() => {
      item.saved = true;
      if (queue.current.get(row.id) === item) {
        queue.current.delete(row.id);
        try {
          if (localStorage.getItem(PENDING + row.id) === JSON.stringify(row)) localStorage.removeItem(PENDING + row.id);
        } catch { /* The server recognizes duplicates. */ }
      }
      if (TERMINAL.has(row.phase)) setStates(prev => ({ ...prev, [row.id]: 'saved' }));
      return true;
    }).catch(err => {
      item.invalid = err.status === 400 || err.status === 409;
      if (TERMINAL.has(row.phase)) {
        setStates(prev => ({ ...prev, [row.id]: item.invalid || !item.durable ? 'failed' : 'pending' }));
      }
      return false;
    }).finally(() => { item.saving = null; });
    return item.saving;
  }, []);

  const checkpoint = useCallback((snapshot, keepalive = false) => {
    if (snapshot.device || snapshot.practice || !snapshot.id || !snapshot.round) return Promise.resolve(true);
    const { id, phase, defuser, expert, level, attempts, correct, decisions, loss, levelsCleared, round } = snapshot;
    const remaining = snapshot.remaining > 0 ? Math.max(1, Math.floor(snapshot.remaining)) : 0;
    const heartbeat = phase === 'ready' ? Math.floor(Date.now() / 10000) : 0;
    const signature = [id, phase, level, attempts, correct, decisions, Math.floor(remaining / 1000), heartbeat].join('/');
    if (last.current?.signature === signature) {
      const { item } = last.current;
      return item.saved ? Promise.resolve(true) : submit(item, keepalive);
    }
    const revision = last.current?.item.row.id === id ? last.current.item.row.revision + 1 : 1;
    const row = { id, phase, defuser, expert, level, attempts, correct, decisions, loss,
      remaining, revision, cleared: levelsCleared === level && level < 3, cards: round.cards,
      ...(TERMINAL.has(phase) && { finishedAt: Date.now() }) };
    const item = { row, durable: false };
    last.current = { signature, item };
    try {
      localStorage.setItem(PENDING + id, JSON.stringify(row));
      item.durable = true;
    } catch { /* Retry from memory while the tab stays open. */ }
    queue.current.set(id, item);
    return submit(item, keepalive);
  }, [submit]);

  useEffect(() => {
    current.current = game;
  }, [game]);
  const secondsLeft = Math.floor(game.remaining / 1000);
  useEffect(() => {
    void checkpoint(current.current);
  }, [checkpoint, game.id, game.phase, game.level, game.decisions, secondsLeft]);

  useEffect(() => {
    function retry() {
      if (current.current.phase === 'ready') void checkpoint(current.current);
      for (const row of readPending()) {
        if (!queue.current.has(row.id)) queue.current.set(row.id, { row, durable: true });
      }
      for (const item of queue.current.values()) if (!item.invalid) void submit(item);
    }
    function leaving(event) {
      if (event.persisted) return;
      const run = current.current;
      if (run.device || run.practice || !['playing', 'ready'].includes(run.phase)) return;
      void checkpoint(gameReducer(run, { type: 'ABORT', interrupted: true, now: performance.now() }), true);
    }
    retry();
    const interval = setInterval(retry, 2500);
    window.addEventListener('online', retry);
    window.addEventListener('pagehide', leaving);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', retry);
      window.removeEventListener('pagehide', leaving);
    };
  }, [checkpoint, submit]);

  const id = game.id;
  const hintPath = id ? '/api/runs/' + encodeURIComponent(id) + '/hints' : null;
  useEffect(() => {
    if (!hintPath) return;
    const controller = new AbortController();
    request(hintPath, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) }).then(result => {
      if (!controller.signal.aborted) setReveals(previous => previous?.id === id ? previous : { id, hints: result.hints });
    }).catch(() => { /* Revealing a hint also fetches earlier reveals. */ });
    return () => controller.abort();
  }, [id, hintPath]);

  async function reveal(card, tier) {
    const run = current.current;
    if (!hintPath || run.id !== id || run.phase !== 'playing' || !await checkpoint(run)) {
      throw new Error('Run unavailable');
    }
    const result = await request(hintPath, { payload: { level: run.level, card, tier }, signal: AbortSignal.timeout(5000) });
    if (current.current.id === id) setReveals({ id, hints: result.hints });
  }

  return { checkpoint, states, reveal, hints: reveals?.id === id ? reveals?.hints ?? [] : [] };
}

export function useLeaderboard(page) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function update() {
      if (busy) return;
      busy = true;
      try {
        const result = await request('/api/runs?page=' + page, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        });
        if (!controller.signal.aborted) {
          setData(result);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        busy = false;
      }
    }
    void update();
    const interval = setInterval(update, 2500);
    return () => { controller.abort(); clearInterval(interval); };
  }, [page]);
  return { data, error };
}

export function useRunSummary(id, saveState) {
  const [run, setRun] = useState(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const update = () => request('/api/runs/' + encodeURIComponent(id), {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    }).then(result => {
      if (!controller.signal.aborted && result.run.status !== 'active') setRun(result.run);
    }).catch(() => { /* The run may still be pending. */ });
    void update();
    const interval = setInterval(update, 2500);
    return () => { controller.abort(); clearInterval(interval); };
  }, [id, saveState]);
  return run?.id === id ? run : null;
}

export const saveMessages = {
  saving: 'Saving run…',
  saved: 'Run saved to the leaderboard.',
  pending: 'Run pending. It will be retried automatically.',
  failed: 'Run could not be saved.',
};
