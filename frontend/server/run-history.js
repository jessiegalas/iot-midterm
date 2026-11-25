import { cleanName } from './lobbies.js';
import { DURATION } from '../src/game.js';
import { HINT_COSTS, LEVEL_CARD_KINDS, RIDDLE_CARDS } from '../src/expert-manual.js';

const cardsById = new Map(RIDDLE_CARDS.map(card => [card.id, card]));
const simulationId = /^[a-f0-9-]{16,36}$/i;
const simulationPhases = new Set(['playing', 'ready', 'won', 'lost', 'aborted', 'interrupted']);
const failureTags = new Set(['TIME', 'WIRE', 'CODE']);
const activeHardware = new Set(['active', 'reconnecting']);
const STOPPED_SIMULATION_MS = 30000;
const PAGE_SIZE = 20;

export const runMigration = `
  CREATE TABLE simulation_runs (
    id TEXT PRIMARY KEY,
    defuser TEXT NOT NULL,
    expert TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    updated INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE run_hints (
    run_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    card INTEGER NOT NULL,
    tier INTEGER NOT NULL,
    PRIMARY KEY (run_id, level, card, tier)
  ) STRICT;
`;

const intIn = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

function validateSimulation(input) {
  if (!input || typeof input.id !== 'string' || !simulationId.test(input.id)) return null;
  const defuser = cleanName(input.defuser);
  const expert = cleanName(input.expert);
  const { id, phase, level, remaining, attempts, correct, decisions, revision, loss, cards } = input;
  if (!defuser || !expert || !simulationPhases.has(phase) || !intIn(level, 1, 3) ||
    !intIn(remaining, 0, DURATION) || !intIn(attempts, 0, 7) ||
    !intIn(correct, 0, 8) || !intIn(decisions, correct + attempts, correct + attempts + 1) ||
    !intIn(revision, 1, Number.MAX_SAFE_INTEGER) ||
    (phase === 'lost' ? !failureTags.has(loss) : loss !== '') ||
    (phase === 'won' && (level !== 3 || correct !== 8 || remaining === 0)) ||
    (loss === 'TIME' && remaining !== 0) || (loss === 'CODE' && attempts < 3)) return null;

  const kinds = LEVEL_CARD_KINDS[level - 1];
  if (!Array.isArray(cards) || cards.length !== kinds.length ||
    cards.some((id, index) => cardsById.get(id)?.kind !== kinds[index]) ||
    new Set(cards.map(id => cardsById.get(id).wireNumber)).size !== cards.length) return null;
  const maxCorrect = [2, 5, 8][level - 1];
  const minimumCorrect = [0, 2, 5][level - 1];
  if (correct < minimumCorrect || correct > maxCorrect ||
    ((phase === 'ready' || phase === 'won') && correct !== maxCorrect) ||
    (decisions - correct - attempts !== (loss === 'WIRE' ? 1 : 0))) return null;
  return { id, defuser, expert, phase, level, remaining, attempts, correct, decisions, revision, loss, cards };
}

export function pointsFor({ status, levelsCleared, remaining, attempts, firstHints, secondHints }) {
  return Math.max(0, 250 * levelsCleared - 10 * attempts - HINT_COSTS[0] * firstHints - HINT_COSTS[1] * secondHints +
    (status === 'won' ? 250 + Math.floor(remaining / 1000) : 0));
}

function summarize(row, now) {
  if (row.source === 'archive') return {
    id: row.id, team: row.team, defuser: row.defuser, expert: row.expert, status: 'won', levelsCleared: 3,
    remaining: row.remaining, attempts: row.attempts, date: row.updated, score: null, accuracy: null, hintsUsed: null,
  };
  const state = JSON.parse(row.snapshot);
  const hardware = row.source === 'hardware';
  let status = state.phase;
  let levelsCleared = state.level - 1;
  if (hardware) {
    if (activeHardware.has(row.status)) status = 'active';
    else status = { abandoned: 'aborted', unconfirmed: 'interrupted' }[row.status] ?? row.status;
    if (state.phase === 'cleared') levelsCleared = state.level;
  } else if (status === 'playing' || status === 'ready') {
    status = now - row.updated >= STOPPED_SIMULATION_MS ? 'interrupted' : 'active';
    if (state.phase === 'ready') levelsCleared = state.level;
  } else if (state.cleared) {
    levelsCleared = state.level;
  }
  if (status === 'won') levelsCleared = 3;
  const remaining = hardware ? state.remainingMs ?? state.seconds * 1000 : state.remaining;
  const { attempts, correct, decisions } = state;
  const hasMetrics = Number.isInteger(correct) && Number.isInteger(decisions);
  const { firstHints, secondHints } = row;
  const metrics = { status, levelsCleared, remaining, attempts, firstHints, secondHints };
  return {
    ...metrics, id: row.id, team: row.team, defuser: row.defuser, expert: row.expert,
    date: state.finishedAt ?? row.updated, loss: state.loss || null,
    score: hasMetrics && status !== 'active' ? pointsFor(metrics) : null,
    accuracy: hasMetrics && decisions ? correct / decisions : null,
    correct: hasMetrics ? correct : null, decisions: hasMetrics ? decisions : null,
    hintsUsed: hasMetrics ? firstHints + secondHints : null,
  };
}

function rank(a, b) {
  return (b.score ?? -1) - (a.score ?? -1) || b.remaining - a.remaining ||
    (b.accuracy ?? -1) - (a.accuracy ?? -1) || (a.hintsUsed ?? 0) - (b.hintsUsed ?? 0) ||
    a.date - b.date || a.id.localeCompare(b.id);
}

export class RunHistory {
  constructor(db, archiveRows) {
    this.archiveRows = archiveRows;
    this.findSimulation = db.prepare('SELECT * FROM simulation_runs WHERE id = ?');
    this.findHardware = db.prepare('SELECT * FROM hardware_runs WHERE id = ?');
    this.writeSimulation = db.prepare(`INSERT INTO simulation_runs (id, defuser, expert, snapshot, updated)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot, updated = excluded.updated`);
    this.findHints = db.prepare('SELECT level, card, tier FROM run_hints WHERE run_id = ? ORDER BY level, card, tier');
    this.addHint = db.prepare('INSERT OR IGNORE INTO run_hints (run_id, level, card, tier) VALUES (?, ?, ?, ?)');
    this.findRuns = db.prepare(`WITH runs AS (
      SELECT id, defuser || ' + ' || expert AS team, defuser, expert, snapshot, updated, 'simulation' AS source, NULL AS status
        FROM simulation_runs
      UNION ALL
      SELECT r.id, COALESCE(p.defuser || ' + ' || p.expert, 'Hardware run'),
        COALESCE(p.defuser, 'Defuser'), COALESCE(p.expert, 'Expert'), r.snapshot, r.updated, 'hardware', r.status
        FROM hardware_runs r LEFT JOIN hardware_rosters p ON p.run_id = r.id
    ), hints AS (
      SELECT run_id, SUM(tier = 1) AS firstHints, SUM(tier = 2) AS secondHints FROM run_hints GROUP BY run_id
    )
    SELECT runs.*, COALESCE(firstHints, 0) AS firstHints, COALESCE(secondHints, 0) AS secondHints
      FROM runs LEFT JOIN hints ON hints.run_id = runs.id WHERE (? IS NULL OR runs.id = ?)`);
  }

  saveSimulation(input, now) {
    const row = validateSimulation(input);
    if (!row || typeof input.cleared !== 'boolean' ||
      (input.cleared && (row.level === 3 || row.correct !== [2, 5][row.level - 1] ||
        !['aborted', 'interrupted', 'ready'].includes(row.phase))) ||
      (row.phase === 'ready' && !input.cleared)) return 'invalid';
    row.cleared = input.cleared;
    if (input.finishedAt !== undefined) {
      if (!intIn(input.finishedAt, 0, now + 5000) || ['playing', 'ready'].includes(row.phase)) return 'invalid';
      row.finishedAt = input.finishedAt;
    }
    const stored = this.findSimulation.get(row.id);
    const data = JSON.stringify(row);
    if (stored) {
      if (stored.defuser !== row.defuser || stored.expert !== row.expert) return 'conflict';
      const previous = JSON.parse(stored.snapshot);
      if (previous.revision > row.revision || stored.snapshot === data) return 'duplicate';
      if (!['playing', 'ready'].includes(previous.phase) || previous.revision === row.revision ||
        row.level < previous.level || row.correct < previous.correct || row.decisions < previous.decisions ||
        row.attempts < previous.attempts || row.remaining > previous.remaining ||
        (row.level === previous.level && row.cards.some((id, index) => id !== previous.cards[index]))) return 'conflict';
    }
    this.writeSimulation.run(row.id, row.defuser, row.expert, data, now);
    return 'saved';
  }

  list(page, now) {
    const stored = this.findRuns.all(null, null);
    const combined = new Map(this.archiveRows.all().map(row => [
      row.id, summarize({ ...row, updated: row.date, source: 'archive' }, now),
    ]));
    const hardwareRunCounts = new Map();
    for (const row of stored) {
      combined.set(row.id, summarize(row, now));
      if (row.source === 'hardware' && row.status === 'won') {
        const legacyId = 'esp32:' + row.id.split(':').slice(2).join(':');
        hardwareRunCounts.set(legacyId, (hardwareRunCounts.get(legacyId) ?? 0) + 1);
      }
    }
    // The archive's de-duplication can prefer an older browser score with names over
    // a hardware snapshot without a confirmed roster. Keep those names on its run.
    for (const row of stored) {
      if (row.source !== 'hardware' || row.team !== 'Hardware run' || row.status !== 'won') continue;
      const legacyId = 'esp32:' + row.id.split(':').slice(2).join(':');
      const legacy = combined.get(legacyId);
      const match = combined.get(row.id);
      if (legacy && legacy.attempts === match.attempts &&
        legacy.remaining === JSON.parse(row.snapshot).seconds * 1000 &&
        hardwareRunCounts.get(legacyId) === 1) {
        combined.set(row.id, { ...match, team: legacy.team, defuser: legacy.defuser, expert: legacy.expert });
        combined.delete(legacyId);
      }
    }
    const all = [...combined.values()];
    const winners = all.filter(row => row.status === 'won').sort(rank);
    const podium = winners.filter(row => row.score !== null).slice(0, 3);
    const ranked = new Map(winners.filter(row => row.score !== null).map((row, index) => [row.id, index + 1]));
    all.sort((a, b) => b.date - a.date || a.id.localeCompare(b.id));
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const current = Math.min(Math.max(page, 1), pages);
    return { podium, runs: all.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
      .map(row => ({ ...row, rank: ranked.get(row.id) ?? null })), page: current, pages };
  }

  get(id, now) {
    const row = this.findRuns.get(id, id);
    return row ? summarize(row, now) : null;
  }

  listHints(id) {
    return this.findHints.all(id).map(({ level, card, tier }) => ({
      level, card, tier, text: cardsById.get(card).hints[tier - 1],
    }));
  }

  unlockHint(id, input, now) {
    const { level, card, tier } = input;
    if (!intIn(level, 1, 3) || !cardsById.has(card) || !intIn(tier, 1, 2)) return null;
    const revealed = this.listHints(id);
    if (revealed.some(hint => hint.level === level && hint.card === card && hint.tier === tier)) return revealed;
    const hardware = id.startsWith('esp32:');
    const row = hardware ? this.findHardware.get(id) : this.findSimulation.get(id);
    if (!row || (hardware ? row.status !== 'active' : now - row.updated >= STOPPED_SIMULATION_MS)) return null;
    const state = JSON.parse(row.snapshot);
    if (state.phase !== 'playing' || state.level !== level || !state.cards.includes(card) ||
      (tier === 2 && !revealed.some(hint => hint.level === level && hint.card === card && hint.tier === 1))) return null;
    this.addHint.run(id, level, card, tier);
    return this.listHints(id);
  }
}
