import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ScoreStore } from './storage.js';

const score = (id, fields) => ({ id, defuser: 'Nell', expert: 'Will', remaining: 120000, attempts: 1, date: 1234, ...fields });

test('scores are deduplicated transactionally across connections and survive reopening', t => {
  const directory = mkdtempSync(join(tmpdir(), 'defuse-scores-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'defuse.sqlite');
  const first = new ScoreStore(filename);
  const second = new ScoreStore(filename);
  try {
    assert.equal(first.saveSimulation(score('one')), 'saved');
    assert.equal(second.saveSimulation(score('one')), 'duplicate');
    assert.equal(second.saveSimulation(score('one', { attempts: 0 })), 'conflict');
    assert.equal(second.saveSimulation(score('two', { attempts: 0 })), 'saved');
    assert.equal(first.saveSimulation(score('esp32:board')), 'invalid');
    assert.equal(first.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(first.db.prepare('PRAGMA user_version').get().user_version, 2);
  } finally {
    second.close();
    first.close();
  }
  const reopened = new ScoreStore(filename);
  try { assert.deepEqual(reopened.list().map(row => row.id), ['two', 'one']); }
  finally { reopened.close(); }
});

test('ranking respects time, strikes, and finish time and displays up to 100', () => {
  const store = new ScoreStore(':memory:');
  try {
    for (let i = 0; i < 102; i++) store.saveSimulation(score('s' + i, { date: 5000 + i }));
    store.saveSimulation(score('later', { remaining: 130000, attempts: 0, date: 2 }));
    store.saveSimulation(score('earlier', { remaining: 130000, attempts: 0, date: 1 }));
    store.saveSimulation(score('strike', { remaining: 130000, attempts: 1, date: 0 }));
    assert.equal(store.list().length, 100);
    assert.deepEqual(store.list().slice(0, 4).map(row => row.id), ['earlier', 'later', 'strike', 's0']);
  } finally { store.close(); }
});

test('legacy records are validated and an existing score cannot be overwritten', () => {
  const store = new ScoreStore(':memory:');
  try {
    const old = score('legacy-id', { team: 'Nell + Will' });
    assert.deepEqual(store.importLegacy([old, null]), { imported: 1, skipped: 0, invalid: 1, conflicts: 0 });
    assert.deepEqual(store.importLegacy([old, { ...old, attempts: 0 }]), { imported: 0, skipped: 1, invalid: 0, conflicts: 1 });
    assert.equal(store.list()[0].attempts, 1);
  } finally { store.close(); }
});

test('legacy rows without IDs produce stable IDs across import and property ordering', () => {
  const store = new ScoreStore(':memory:');
  try {
    const { id, ...old } = score('ignored', { team: 'Nell + Will' });
    const reordered = Object.fromEntries(Object.entries(old).reverse());
    assert.deepEqual(store.importLegacy([old, reordered, { ...old, remaining: -1 }]),
      { imported: 1, skipped: 1, invalid: 1, conflicts: 0 });
    assert.match(store.list()[0].id, /^legacy:[0-9a-f]{64}$/);
  } finally { store.close(); }
});
