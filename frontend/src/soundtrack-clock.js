import { DURATION } from './game.js';

export const CLIMAX_START_MS = DURATION - 30000;
const segments = [
  { track: 0, from: 0, until: CLIMAX_START_MS },
  { track: 1, from: CLIMAX_START_MS, until: DURATION },
];

export function soundtrackSegments(elapsed) {
  return segments.filter(segment => elapsed < segment.until).map(segment => {
    const start = Math.max(elapsed, segment.from);
    return { track: segment.track, start, end: segment.until, offset: start - segment.from };
  });
}

export function clockElapsed(elapsed, sampledAt, now) {
  // Late observers can start partway through a loop. Limit extrapolation across a stalled bridge.
  return elapsed + Math.min(1000, Math.max(0, now - sampledAt));
}
