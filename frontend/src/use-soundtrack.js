import { useEffect, useRef, useState } from 'react';
import { DURATION } from './game.js';
import { clockElapsed, soundtrackSegments } from './soundtrack-clock.js';
import mainTrack from '../../music/songs/hot_roadway_bpm160_0.ogg?url';
import climaxTrack from '../../music/songs/hot_roadway_climax_bpm175_0.ogg?url';
import testTrack from '../../music/songs/test-run.ogg?url';

const volume = 0.22;
const fade = 0.02;
const correctionSeconds = 0.07;
const tracks = { test: [testTrack], mission: [mainTrack, climaxTrack] };

async function decodeTrack(context, url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Audio file could not be loaded');
  return context.decodeAudioData(await response.arrayBuffer());
}

function stopPlayback(player) {
  if (!player) return;
  const now = player.audio.currentTime;
  for (const { source, gain, end } of player.nodes) {
    if (end <= now) continue;
    const stopAt = Math.min(end, now + fade);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, stopAt);
    source.stop(stopAt);
  }
  player.nodes.clear();
  player.origin = null;
}

function trackPlayback(player, source, gain, end) {
  const node = { source, gain, end };
  player.nodes.add(node);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    player.nodes.delete(node);
  };
}

function scheduleTestRun(player, buffer) {
  if (player.runId === 'test-run' && player.nodes.size) return;
  stopPlayback(player);
  player.runId = 'test-run';
  const { audio } = player;
  const source = audio.createBufferSource();
  const gain = audio.createGain();
  const now = audio.currentTime;
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain);
  gain.connect(audio.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + fade);
  trackPlayback(player, source, gain, Infinity);
  source.start(now);
}

function schedule(player, runId, elapsed, buffers) {
  const { audio } = player;
  const now = audio.currentTime;
  const latency = (audio.baseLatency || 0) + (audio.outputLatency || 0);
  const origin = now - elapsed / 1000 - latency;
  if (player.runId === runId && player.origin !== null && Math.abs(origin - player.origin) < correctionSeconds) return;
  stopPlayback(player);
  player.runId = runId;
  player.origin = origin;
  const firstFrame = Math.max(0, (now + fade - origin) * 1000);
  for (const part of soundtrackSegments(firstFrame)) {
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    const start = origin + part.start / 1000;
    const end = origin + part.end / 1000;
    const ramp = Math.min(fade, (end - start) / 2);
    source.buffer = buffers[part.track];
    source.loop = true;
    source.connect(gain);
    gain.connect(audio.destination);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + ramp);
    gain.gain.setValueAtTime(volume, end - ramp);
    gain.gain.linearRampToValueAtTime(0, end);
    trackPlayback(player, source, gain, end);
    source.start(start, (part.offset / 1000) % source.buffer.duration);
    source.stop(end);
  }
}

export function useSoundtrack({ active, practice, runId, device, deadline, hardwareSeconds, clock, snapshotAt }) {
  const [enabled, setEnabled] = useState(false);
  const [buffers, setBuffers] = useState({});
  const [error, setError] = useState('');
  const player = useRef(null);
  const mutedByUser = useRef(false);
  const mode = practice ? 'test' : 'mission';
  const activeBuffers = buffers[mode];
  const elapsedSample = clock?.elapsed;
  const sampledAt = clock?.sampledAt ?? snapshotAt;

  useEffect(() => () => {
    if (player.current) void player.current.audio.close();
  }, []);

  function enable() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) {
      setError('This browser cannot play the soundtrack.');
      return;
    }
    setError('');
    try {
      player.current ??= { audio: new Audio(), nodes: new Set(), origin: null, loading: {} };
      const resume = player.current.audio.resume();
      setEnabled(true);
      resume.catch(() => {
        setEnabled(false);
        setError('The soundtrack could not be started. Use Enable sound to retry.');
      });
    } catch {
      setError('The soundtrack could not be started.');
    }
  }

  function toggle() {
    mutedByUser.current = enabled;
    if (enabled) {
      stopPlayback(player.current);
      setEnabled(false);
    } else {
      enable();
    }
  }

  function enableForTest() {
    if (!enabled && !mutedByUser.current) enable();
  }

  useEffect(() => {
    if (!active || !enabled || activeBuffers) return;
    const current = player.current;
    let cancelled = false;
    current.loading[mode] ??= Promise.all(tracks[mode].map(url => decodeTrack(current.audio, url))).catch(cause => {
      delete current.loading[mode];
      throw cause;
    });
    current.loading[mode].then(loaded => {
      if (!cancelled) setBuffers(previous => ({ ...previous, [mode]: loaded }));
    }).catch(() => {
      if (!cancelled) {
        setEnabled(false);
        setError('The soundtrack could not be loaded. Use Enable sound to retry.');
      }
    });
    return () => { cancelled = true; };
  }, [active, enabled, mode, activeBuffers]);

  useEffect(() => {
    const current = player.current;
    if (!active || !enabled || !activeBuffers) {
      stopPlayback(current);
      return;
    }
    if (practice) {
      scheduleTestRun(current, activeBuffers[0]);
      return;
    }
    const elapsed = device
      ? clockElapsed(elapsedSample ?? DURATION - hardwareSeconds * 1000, sampledAt, Date.now())
      : DURATION - Math.max(0, deadline - performance.now());
    if (Number.isFinite(elapsed) && elapsed < DURATION) schedule(current, runId, elapsed, activeBuffers);
    else stopPlayback(current);
  }, [active, enabled, activeBuffers, practice, runId, device, deadline, hardwareSeconds, elapsedSample, sampledAt]);

  return { enabled, toggle, enableForTest, error };
}
