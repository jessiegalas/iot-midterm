import assert from 'node:assert/strict';
import test from 'node:test';
import { ScoreStore } from './storage.js';

const snapshot = (number, changes = {}) => ({
  id: number.toString(16).padStart(32, '0'), defuser: 'Kai', expert: 'Ali',
  phase: 'playing', level: 1, cards: [2], remaining: 230000,
  attempts: 0, correct: 0, decisions: 0, revision: 1, loss: '', cleared: false, ...changes,
});

test('hint tiers charge once and a terminated run keeps progress and accuracy', t => {
  const store = new ScoreStore(':memory:');
  t.after(() => store.close());
  const initial = snapshot(1, { attempts: 1, decisions: 2, correct: 1 });
  const { id } = initial;
  assert.equal(store.history.saveSimulation(initial, 1000), 'saved');
  assert.equal(store.history.get(id, 1001).status, 'active');
  assert.equal(store.history.unlockHint(id, { level: 1, card: 2, tier: 2 }, 1002), null);
  assert.equal(store.history.unlockHint(id, { level: 1, card: 4, tier: 1 }, 1002), null);

  const first = { level: 1, card: 2, tier: 1 };
  const reveal = store.history.unlockHint(id, first, 1003);
  assert.equal(reveal.length, 1);
  assert.deepEqual(store.history.unlockHint(id, first, 1004), reveal);
  assert.equal(store.history.unlockHint(id, { ...first, tier: 2 }, 1005).length, 2);

  const aborted = { ...initial, phase: 'aborted', cleared: true, correct: 2, decisions: 3, revision: 2, remaining: 215400 };
  assert.equal(store.history.saveSimulation(aborted, 1006), 'saved');
  assert.equal(store.history.saveSimulation(aborted, 1007), 'duplicate');
  assert.equal(store.history.saveSimulation(initial, 1008), 'duplicate');
  assert.equal(store.history.saveSimulation({ ...aborted, revision: 3 }, 1008), 'conflict');
  const run = store.history.get(id, 2000);
  assert.equal(run.levelsCleared, 1);
  assert.equal(run.score, 225);
  assert.equal(run.accuracy, 2 / 3);
  assert.equal(run.remaining, 215400);
  assert.equal(run.hintsUsed, 2);
  assert.equal(store.history.list(1, 2000).runs.length, 1);
  assert.deepEqual(store.history.list(1, 2000).podium, []);
});

test('real wins, losses, interruptions and archived results are visible across pages', t => {
  const store = new ScoreStore(':memory:');
  t.after(() => store.close());
  const win = { phase: 'won', level: 3, cards: [1, 13], correct: 8, decisions: 8, remaining: 54000 };
  assert.equal(store.history.saveSimulation(snapshot(1, win), 1000), 'saved');
  assert.equal(store.history.saveSimulation(snapshot(2, { ...win, attempts: 1, decisions: 9, remaining: 63000 }), 2000), 'saved');
  assert.equal(store.history.saveSimulation(snapshot(3, { phase: 'lost', loss: 'TIME', remaining: 0 }), 3000), 'saved');
  assert.equal(store.history.saveSimulation(snapshot(4, { phase: 'lost', loss: 'WIRE', level: 2, cards: [2, 3],
    correct: 3, decisions: 4, remaining: 120000 }), 4000), 'saved');
  assert.equal(store.history.saveSimulation(snapshot(5, { phase: 'lost', loss: 'CODE', attempts: 3, decisions: 3 }), 5000), 'saved');
  for (let number = 6; number < 26; number++) assert.equal(store.history.saveSimulation(snapshot(number), 6000), 'saved');
  assert.equal(store.saveSimulation({ id: 'archive-1', defuser: 'Mia', expert: 'Bo', date: 950, attempts: 0, remaining: 65000 }), 'saved');

  const board = store.history.list(1, 40000);
  assert.deepEqual(board.podium.map(run => run.score), [1054, 1053]);
  assert.deepEqual(board.podium.map(run => run.accuracy), [1, 8 / 9]);
  assert.equal(board.pages, 2);
  const all = [...board.runs, ...store.history.list(2, 40000).runs];
  assert.equal(new Set(all.map(run => run.id)).size, 26);
  assert.equal(all.find(run => run.loss === 'TIME').accuracy, null);
  assert.equal(all.find(run => run.loss === 'WIRE').score, 250);
  assert.equal(all.find(run => run.loss === 'CODE').score, 0);
  assert.equal(all.find(run => run.id === snapshot(6).id).status, 'interrupted');
  assert.equal(all.find(run => run.id === 'archive-1').score, null);
});
