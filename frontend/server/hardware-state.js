import { validateScore } from './storage.js';

const runId = (device, frame) => 'esp32:' + device + ':' + frame.boot + ':' + frame.run;
const current = status => ['active', 'reconnecting', 'unconfirmed'].includes(status);
const terminal = status => status === 'won' || status === 'lost';
const reconnectTimeout = 8000;

export class HardwareState {
  constructor(store, { onStarted = () => {}, onAbandoned = () => {}, date = Date.now } = {}) {
    this.store = store;
    this.onStarted = onStarted;
    this.onAbandoned = onAbandoned;
    this.date = date;
    this.jobs = [];
    this.failed = false;
    this.nextRetry = 0;
    this.disconnected = null;
    const db = store.db;
    const runView = `SELECT r.*, p.defuser, p.expert, s.id AS score
      FROM hardware_runs r LEFT JOIN hardware_rosters p ON p.run_id = r.id
      LEFT JOIN scores s ON s.id = r.id `;
    this.findRun = db.prepare(runView + 'WHERE r.id = ?');
    this.findLatest = db.prepare(runView + 'ORDER BY r.updated DESC, r.rowid DESC LIMIT 1');
    this.saveRun = db.prepare(`INSERT INTO hardware_runs (id, device, boot, run, status, snapshot, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      status = excluded.status, snapshot = excluded.snapshot, updated = excluded.updated`);
    this.saveRoster = db.prepare('INSERT OR IGNORE INTO hardware_rosters (run_id, defuser, expert) VALUES (?, ?, ?)');
    this.stageStart = db.prepare(`INSERT INTO pending_hardware_starts (command, lobby, device, boot, run, defuser, expert, status, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`);
    this.findStarts = db.prepare(`SELECT * FROM pending_hardware_starts WHERE device = ? AND status IN ('pending', 'unconfirmed')`);
    this.setStart = db.prepare(`UPDATE pending_hardware_starts SET status = ?, updated = ?
      WHERE command = ? AND status IN ('pending', 'unconfirmed')`);
    this.setRunStatus = db.prepare(`UPDATE hardware_runs SET status = ?, updated = ?
      WHERE id = ? AND status IN ('active', 'reconnecting', 'unconfirmed')`);
    this.markOtherRuns = db.prepare(`UPDATE hardware_runs SET status = 'unconfirmed'
      WHERE device = ? AND id <> ? AND status IN ('active', 'reconnecting')`);

    const latest = this.findLatest.get();
    if (latest) this.readRun(latest);
    else this.view = { snapshot: null, runStatus: null, scoreStatus: null };
  }

  readRun(row) {
    const players = row.defuser ? { defuser: row.defuser, expert: row.expert, team: row.defuser + ' + ' + row.expert } : null;
    this.view = { snapshot: { ...JSON.parse(row.snapshot), id: row.id, deviceId: row.device, players }, runStatus: row.status,
      scoreStatus: terminal(row.status) ? row.status === 'lost' || row.score ? 'saved' : 'failed' : null };
  }

  stage(command, device, start, { lobbyId = null, players }) {
    if (this.failed) return 'unavailable';
    try {
      this.store.transaction(() => this.stageStart.run(command, lobbyId, device, start.boot, start.run,
        players.defuser, players.expert, this.date()));
      return null;
    } catch (error) {
      return error.errmsg?.includes('UNIQUE') || /UNIQUE constraint/.test(error.message) ? 'busy' : 'unavailable';
    }
  }

  settle(command, status) {
    this.enqueue(() => this.setStart.run(status, this.date(), command));
  }

  enqueue(work) {
    const item = { work, done: false };
    this.jobs.push(item);
    if (this.jobs.length === 1) this.flush();
    return item.done;
  }

  flush() {
    while (this.jobs.length) {
      const item = this.jobs[0];
      try {
        item.work();
      } catch {
        this.failed = true;
        return;
      }
      item.done = true;
      this.jobs.shift();
    }
    this.failed = false;
  }

  observe(device, frame, reconciling) {
    this.disconnected = null;
    const id = runId(device, frame);
    const savedAt = this.date();
    const written = this.enqueue(() => {
      const started = [];
      const abandoned = [];
      const row = this.store.transaction(() => {
        const existing = this.findRun.get(id);
        if (existing && JSON.parse(existing.snapshot).revision > frame.revision) return existing;

        this.markOtherRuns.run(device, id);
        const starts = this.findStarts.all(device);
        let confirmed;
        for (const start of starts) {
          const sameBoot = start.boot === frame.boot;
          const previousRun = (start.run - 1) >>> 0;
          if (sameBoot && start.run === frame.run && frame.lastCommand === start.command && frame.phase !== 'idle') {
            confirmed = start;
            this.setStart.run('confirmed', savedAt, start.command);
            if (start.lobby) started.push(start.lobby);
          } else if (sameBoot && frame.run === previousRun && reconciling) {
            this.setStart.run('abandoned', savedAt, start.command);
            if (start.lobby) abandoned.push(start.lobby);
          } else if (!sameBoot || (frame.run !== previousRun && (frame.run !== start.run || reconciling))) {
            this.setStart.run('abandoned', savedAt, start.command);
            if (start.lobby) abandoned.push(start.lobby);
          }
        }

        if (frame.phase === 'idle') {
          if (existing && current(existing.status)) this.setRunStatus.run('abandoned', savedAt, id);
          return null;
        }
        if (existing && terminal(existing.status)) return existing;
        const status = terminal(frame.phase) ? frame.phase : 'active';
        this.saveRun.run(id, device, frame.boot, frame.run, status, JSON.stringify(frame), savedAt);
        if (confirmed) this.saveRoster.run(id, confirmed.defuser, confirmed.expert);

        const stored = this.findRun.get(id);
        if (status === 'won') {
          const defuser = stored.defuser ?? 'Defuser';
          const expert = stored.expert ?? 'Expert';
          const team = stored.defuser ? defuser + ' + ' + expert : 'Hardware run';
          const row = validateScore({ id, defuser, expert, team, remaining: frame.seconds * 1000,
            attempts: frame.attempts, date: savedAt }, 'hardware');
          if (row) this.store.set(row, 'hardware');
          return this.findRun.get(id);
        }
        return stored;
      });
      if (row) this.readRun(row);
      else this.view = { snapshot: { ...frame, deviceId: device }, runStatus: null, scoreStatus: null };
      for (const lobbyId of started) this.onStarted(lobbyId, id);
      for (const lobbyId of abandoned) this.onAbandoned(lobbyId);
    });
    if (!written) {
      const known = this.view.snapshot?.id === id ? this.view.snapshot.players : null;
      this.view = { snapshot: { ...frame, id, deviceId: device, players: known },
        runStatus: terminal(frame.phase) ? frame.phase : frame.phase === 'idle' ? null : 'active',
        scoreStatus: terminal(frame.phase) ? 'pending' : null };
    }
    return written;
  }

  connectionLost(now) {
    const id = this.view.snapshot?.id;
    if (!id || !current(this.view.runStatus)) return;
    this.disconnected = { id, deadline: now + reconnectTimeout };
    this.changeStatus(id, 'reconnecting');
  }

  changeStatus(id, status) {
    this.view = { ...this.view, runStatus: status };
    this.enqueue(() => this.setRunStatus.run(status, this.date(), id));
  }

  tick(now) {
    if (this.disconnected && now >= this.disconnected.deadline) {
      this.changeStatus(this.disconnected.id, 'unconfirmed');
      this.disconnected = null;
    }
    if (this.jobs.length && now >= this.nextRetry) {
      this.nextRetry = now + 1000;
      this.flush();
    }
  }
}
