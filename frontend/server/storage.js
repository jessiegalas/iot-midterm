import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { cleanName } from './lobbies.js';
import { DURATION } from '../src/game.js';

const defaultPath = fileURLToPath(new URL('../.data/defuse.sqlite', import.meta.url));
const scoreId = /^[A-Za-z0-9:_-]{1,128}$/;
const hardwareId = /^esp32:[a-f0-9]{12}:[a-f0-9]{8}:\d{1,10}$/;
const legacyHardwareId = /^esp32:[a-f0-9]{8}:\d{1,10}$/;
const safeText = value => typeof value === 'string' && value.trim() && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
const sameScore = (a, b) => ['team', 'defuser', 'expert', 'remaining', 'attempts', 'date'].every(key => a[key] === b[key]);

const migrations = [`
  CREATE TABLE scores (
    id TEXT PRIMARY KEY,
    team TEXT NOT NULL,
    defuser TEXT NOT NULL,
    expert TEXT NOT NULL,
    remaining REAL NOT NULL CHECK(remaining > 0 AND remaining <= 240000),
    attempts INTEGER NOT NULL CHECK(attempts >= 0),
    date INTEGER NOT NULL CHECK(date >= 0),
    source TEXT NOT NULL CHECK(source IN ('simulation', 'hardware', 'legacy'))
  ) STRICT;
  CREATE INDEX ranked_scores ON scores(remaining DESC, attempts, date, id);
  CREATE TABLE hardware_runs (
    id TEXT PRIMARY KEY,
    device TEXT NOT NULL,
    boot TEXT NOT NULL,
    run INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'reconnecting', 'won', 'lost', 'abandoned', 'unconfirmed')),
    snapshot TEXT NOT NULL,
    updated INTEGER NOT NULL,
    UNIQUE(device, boot, run)
  ) STRICT;
  CREATE INDEX latest_hardware_run ON hardware_runs(updated DESC);
  CREATE TABLE hardware_rosters (
    run_id TEXT PRIMARY KEY REFERENCES hardware_runs(id),
    defuser TEXT NOT NULL,
    expert TEXT NOT NULL
  ) STRICT;
  CREATE TABLE pending_hardware_starts (
    command TEXT PRIMARY KEY,
    lobby TEXT,
    device TEXT NOT NULL,
    boot TEXT NOT NULL,
    run INTEGER NOT NULL,
    defuser TEXT NOT NULL,
    expert TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'unconfirmed', 'confirmed', 'abandoned')),
    updated INTEGER NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX one_pending_start_per_board ON pending_hardware_starts(device) WHERE status = 'pending';
`];

export function validateScore(row, source) {
  if (!row || typeof row !== 'object' || Array.isArray(row) ||
    typeof row.id !== 'string' || !scoreId.test(row.id) ||
    (source === 'simulation' && row.id.startsWith('esp32:')) ||
    (source === 'legacy' && row.id.startsWith('esp32:') && !legacyHardwareId.test(row.id)) ||
    (source === 'hardware' && !hardwareId.test(row.id))) return null;
  const { id, remaining, attempts, date } = row;
  const defuser = cleanName(row.defuser);
  const expert = cleanName(row.expert);
  if (!defuser || !expert || !Number.isFinite(remaining) || remaining <= 0 || remaining > DURATION ||
    !Number.isSafeInteger(attempts) || attempts < 0 || (source !== 'legacy' && attempts > 9) ||
    !Number.isSafeInteger(date) || date < 0 || date > 8.64e15) return null;
  const team = source === 'legacy' || source === 'hardware' ? row.team : defuser + ' + ' + expert;
  return safeText(team) ? { id, team, defuser, expert, remaining, attempts, date } : null;
}

function legacyScore(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.id !== undefined && input.id !== null && input.id !== '') return validateScore(input, 'legacy');
  const row = validateScore({ ...input, id: 'legacy' }, 'legacy');
  if (!row) return null;
  const values = [row.team, row.defuser, row.expert, row.remaining, row.attempts, row.date];
  return { ...row, id: 'legacy:' + createHash('sha256').update(JSON.stringify(values)).digest('hex') };
}

export class ScoreStore {
  constructor(file = defaultPath) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    try {
      this.db.exec('PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      this.transaction(() => {
        const version = this.db.prepare('PRAGMA user_version').get().user_version;
        if (version > migrations.length) throw new Error('The score database needs a newer version of DEFUSE.');
        for (let i = version; i < migrations.length; i++) {
          this.db.exec(migrations[i]);
          this.db.exec('PRAGMA user_version = ' + (i + 1));
        }
      });
      this.selectScores = this.db.prepare(`SELECT id, team, defuser, expert, remaining, attempts, date
        FROM scores WHERE id NOT IN (
          SELECT MIN(CASE WHEN roster.run_id IS NULL THEN board.id ELSE legacy.id END)
          FROM hardware_runs run
          JOIN scores board ON board.id = run.id AND board.source = 'hardware'
          JOIN scores legacy ON legacy.id = 'esp32:' || run.boot || ':' || run.run
            AND legacy.source = 'legacy' AND legacy.remaining = board.remaining AND legacy.attempts = board.attempts
          LEFT JOIN hardware_rosters roster ON roster.run_id = run.id
          GROUP BY legacy.id HAVING COUNT(*) = 1
        )
        ORDER BY remaining DESC, attempts, date, id LIMIT 100`);
      this.selectScore = this.db.prepare('SELECT * FROM scores WHERE id = ?');
      this.insertScore = this.db.prepare('INSERT INTO scores (id, team, defuser, expert, remaining, attempts, date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  list() {
    return this.selectScores.all();
  }

  set(row, source) {
    const stored = this.selectScore.get(row.id);
    if (stored) return sameScore(stored, row) ? 'duplicate' : 'conflict';
    this.insertScore.run(row.id, row.team, row.defuser, row.expert, row.remaining, row.attempts, row.date, source);
    return 'saved';
  }

  saveSimulation(input) {
    const row = validateScore(input, 'simulation');
    return row ? this.transaction(() => this.set(row, 'simulation')) : 'invalid';
  }

  importLegacy(rows) {
    return this.transaction(() => {
      const report = { imported: 0, skipped: 0, invalid: 0, conflicts: 0 };
      for (const input of rows) {
        const row = legacyScore(input);
        if (!row) report.invalid++;
        else {
          const result = this.set(row, 'legacy');
          if (result === 'saved') report.imported++;
          else if (result === 'duplicate') report.skipped++;
          else report.conflicts++;
        }
      }
      return report;
    });
  }
}
