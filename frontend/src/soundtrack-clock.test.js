import assert from 'node:assert/strict';
import test from 'node:test';
import { clockElapsed, soundtrackSegments } from './soundtrack-clock.js';

test('soundtrack schedules the faster loop at the 30-second downbeat', () => {
  assert.deepEqual(soundtrackSegments(209950), [
    { track: 0, start: 209950, end: 210000, offset: 209950 },
    { track: 1, start: 210000, end: 240000, offset: 0 },
  ]);
  assert.deepEqual(soundtrackSegments(211200), [
    { track: 1, start: 211200, end: 240000, offset: 1200 },
  ]);
  assert.deepEqual(soundtrackSegments(240000), []);
});

test('a recent timing frame can be aged without extrapolating indefinitely', () => {
  assert.equal(clockElapsed(10000, 8000, 8045), 10045);
  assert.equal(clockElapsed(10000, 8000, 7000), 10000);
  assert.equal(clockElapsed(10000, 8000, 30000), 11000);
});
