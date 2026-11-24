import { useEffect, useRef, useState } from 'react';
import { DURATION } from './game.js';
import { clockElapsed, soundtrackSegments } from './soundtrack-clock.js';
import mainTrack from '../../music/songs/hot_roadway_bpm160_0.ogg?url';
import climaxTrack from '../../music/songs/hot_roadway_climax_bpm175_0.ogg?url';

const volume = 0.22;
const fade = 0.02;
const correctionSeconds = 0.07;

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

function schedule(player, runId, elapsed) {
  const { audio, buffers } = player;
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
    const node = { source, gain, end };
    player.nodes.add(node);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      player.nodes.delete(node);
    };
    source.start(start, (part.offset / 1000) % source.buffer.duration);
    source.stop(end);
  }
}

export function useSoundtrack({ active, runId, device, deadline, hardwareSeconds, clock, snapshotAt }) {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const player = useRef(null);
  const elapsedSample = clock?.elapsed;
  const sampledAt = clock?.sampledAt ?? snapshotAt;

  useEffect(() => () => {
    if (player.current) void player.current.audio.close();
  }, []);

  function toggle() {
    if (enabled) {
      stopPlayback(player.current);
      setEnabled(false);
      return;
    }
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) {
      setError('This browser cannot play the soundtrack.');
      return;
    }
    setError('');
    try {
      player.current ??= { audio: new Audio(), nodes: new Set(), origin: null };
      const current = player.current;
      current.loading ??= Promise.all([mainTrack, climaxTrack].map(url => decodeTrack(current.audio, url)));
      setEnabled(true);
      Promise.all([current.audio.resume(), current.loading]).then(([, buffers]) => {
        current.buffers = buffers;
        setLoaded(true);
      }).catch(() => {
        current.loading = null;
        setLoaded(false);
        setEnabled(false);
        setError('The soundtrack could not be loaded. Use Enable sound to retry.');
      });
    } catch {
      setError('The soundtrack could not be started.');
    }
  }

  useEffect(() => {
    const current = player.current;
    if (!active || !enabled || !loaded) {
      stopPlayback(current);
      return;
    }
    const elapsed = device
      ? clockElapsed(elapsedSample ?? DURATION - hardwareSeconds * 1000, sampledAt, Date.now())
      : DURATION - Math.max(0, deadline - performance.now());
    if (Number.isFinite(elapsed) && elapsed < DURATION) schedule(current, runId, elapsed);
    else stopPlayback(current);
  }, [active, enabled, loaded, runId, device, deadline, hardwareSeconds, elapsedSample, sampledAt]);

  return { enabled, toggle, error };
}
