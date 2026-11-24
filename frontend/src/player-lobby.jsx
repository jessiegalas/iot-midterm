import React, { useEffect, useRef, useState } from 'react';

const roles = [
  { id: 'defuser', title: 'Defuser', player: 'Player 1' },
  { id: 'expert', title: 'Expert', player: 'Player 2' },
];
const emptyNames = { defuser: '', expert: '' };
const roleTitle = id => roles.find(role => role.id === id);
const jsonHeaders = { 'Content-Type': 'application/json' };

async function api(path, options) {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const value = await response.json();
  if (!response.ok) throw new Error(value.code);
  return value;
}

export function PlayerLobby({ device, controlsBlocked, onStart, commandError }) {
  const [session, setSession] = useState(null);
  const [names, setNames] = useState(emptyNames);
  const [draft, setDraft] = useState(emptyNames);
  const [manual, setManual] = useState(import.meta.env.DEV);
  const [loading, setLoading] = useState(!import.meta.env.DEV);
  const [streamError, setStreamError] = useState('');
  const [error, setError] = useState('');
  const [address, setAddress] = useState('');
  const [pending, setPending] = useState(false);
  const revision = useRef(-1);
  const complete = Boolean(names.defuser && names.expert);

  function applyPlayers(lobby) {
    if (lobby.revision < revision.current) return;
    revision.current = lobby.revision;
    setNames(lobby.players);
  }

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let ended = false;
    let events;
    let id;
    const closeLobby = () => { if (id) api('/api/lobbies/' + id, { method: 'DELETE', keepalive: true }).catch(() => {}); };
    api('/api/lobbies', { method: 'POST', signal: AbortSignal.timeout(5000) }).then(lobby => {
      id = lobby.id;
      if (ended) {
        closeLobby();
        return;
      }
      setSession(lobby);
      applyPlayers(lobby);
      setAddress(lobby.networks[0]?.address ?? '');
      if (!lobby.networks.length) setManual(true);
      events = new EventSource('/api/lobbies/' + id + '/events');
      events.onmessage = event => {
        const updated = JSON.parse(event.data);
        if (!updated) {
          events.close();
          setSession(null);
          setAddress('');
          setManual(true);
          setStreamError('The QR codes expired. Enter names manually or reopen the lobby for new codes.');
          return;
        }
        applyPlayers(updated);
        setStreamError('');
      };
      events.onerror = () => setStreamError('Live updates are reconnecting.');
    }).catch(() => {
      if (!ended) {
        setManual(true);
        setStreamError('QR connections are unavailable. Enter player names manually.');
      }
    }).finally(() => { if (!ended) setLoading(false); });
    return () => {
      ended = true;
      events?.close();
      closeLobby();
    };
  }, []);

  async function saveNames(event) {
    event.preventDefault();
    const updates = Object.fromEntries(roles.map(({ id }) => [id, draft[id].trim()]).filter(([, name]) => name));
    if (Object.keys(updates).length === 0) {
      setError('Enter at least one name.');
      return;
    }
    setError('');
    setPending(true);
    try {
      if (session) {
        const lobby = await api('/api/lobbies/' + session.id + '/manual', {
          method: 'POST', headers: jsonHeaders, body: JSON.stringify(updates), signal: AbortSignal.timeout(5000),
        });
        applyPlayers(lobby);
      } else {
        setNames(previous => ({ ...previous, ...updates }));
      }
      setDraft(emptyNames);
    } catch {
      setError('Names could not be saved. Try again.');
    } finally {
      setPending(false);
    }
  }

  async function start() {
    if (!complete || pending || controlsBlocked) return;
    setPending(true);
    try {
      await onStart(names);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="player-lobby">
      {address && <p className="lobby-intro">Connect both phones to the same local network as the laptop, then scan one QR code per player.</p>}
      {session?.networks.length > 1 && (
        <label className="lobby-network">Network for QR codes
          <select value={address} onChange={event => setAddress(event.target.value)}>
            {session.networks.map(network => <option key={network.address} value={network.address}>{network.name} ({network.address})</option>)}
          </select>
        </label>
      )}
      <div className="player-roles">
        {roles.map(({ id, title, player }) => (
          <section className="player-role" key={id} aria-labelledby={id + '-role'}>
            <span className="player-number">{player}</span>
            <h3 id={id + '-role'}>{title}</h3>
            <div className="player-slot" aria-live="polite">
              {names[id] ? (
                <div className="player-connected">
                  <strong>{names[id]}</strong>
                  <span>Connected</span>
                </div>
              ) : address && session ? (
                <img className="player-qr" alt={`Scan to join as ${title}`} width={156} height={156}
                  src={`/api/lobbies/${session.id}/qr/${id}?address=${encodeURIComponent(address)}`}
                  onError={() => { setStreamError('A QR code could not be loaded. Try manual entry.'); setManual(true); }} />
              ) : <span className="player-waiting">{loading ? 'Preparing QR code…' : 'Waiting for a name'}</span>}
            </div>
          </section>
        ))}
      </div>

      {streamError && <p className="lobby-feedback" role="status">{streamError}</p>}
      {session && !session.networks.length && <p className="lobby-hint">No local network address is available for QR joining. Use manual entry.</p>}
      <details className="lobby-manual" open={manual} onToggle={event => setManual(event.currentTarget.open)}>
        <summary>Manual entry</summary>
        <form onSubmit={saveNames}>
          <div className="lobby-name-fields">
            {roles.map(({ id, title }) => (
              <label key={id}>{title} name<input maxLength={24} autoComplete="off" value={draft[id]}
                placeholder={names[id] || undefined} onChange={event => setDraft({ ...draft, [id]: event.target.value })} /></label>
            ))}
          </div>
          <button className="button button-quiet" type="submit" disabled={loading || pending}>Save names</button>
          {error && <p className="lobby-feedback" role="alert">{error}</p>}
        </form>
      </details>
      <div className="lobby-start">
        <span role="status">{controlsBlocked ? 'Reconnect the ESP32 to start.' : complete ? 'Both players are ready.' : 'Waiting for both players.'}</span>
        <button className="button button-primary" type="button" disabled={!complete || pending || loading || controlsBlocked} onClick={start}>
          {pending ? 'Please wait…' : 'Start Game'}
        </button>
      </div>
      {device && <p className="lobby-hint">After starting, seat the wires and arm the level on the ESP32.</p>}
      {device && commandError && <p className="lobby-feedback" role="alert">{commandError}</p>}
    </div>
  );
}

const joinErrors = {
  closed: 'This invitation has expired. Ask the host for a fresh QR code.',
  occupied: 'This role is already taken. Ask the host to check the lobby.',
  invalid: 'Enter a name of up to 24 characters.',
};

export function JoinPlayer({ invite }) {
  const [role, setRole] = useState(null);
  const [name, setName] = useState('');
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const endpoint = '/api/join/' + invite;

  useEffect(() => {
    const controller = new AbortController();
    api(endpoint, { signal: controller.signal }).then(result => {
      setRole(roleTitle(result.role));
      if (result.occupied) setError(joinErrors.occupied);
    }).catch(error => {
      if (!controller.signal.aborted) setError(joinErrors[error.message] || 'The lobby could not be reached. Check the local network and reload.');
    });
    return () => controller.abort();
  }, [endpoint]);

  async function join(event) {
    event.preventDefault();
    const value = name.trim();
    if (!value) return setError(joinErrors.invalid);
    setPending(true);
    setError('');
    try {
      await api(endpoint, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: value }), signal: AbortSignal.timeout(5000) });
      setConnected(true);
    } catch (error) {
      setError(joinErrors[error.message] || 'Connection failed. Check the local network and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="workspace phone-join">
      <span className="player-number">DEFUSE{role && ` / ${role.player}`}</span>
      <h1>{connected ? 'You’re connected' : role ? `Join as ${role.title}` : 'Connect to DEFUSE'}</h1>
      {connected ? <p role="status">{name.trim()}, you’re the {role.title}. Wait for the host to start.</p> :
        role && error !== joinErrors.occupied ? (
          <form onSubmit={join}>
            <label>Name<input required maxLength={24} name="name" autoComplete="given-name" value={name} onChange={event => setName(event.target.value)} /></label>
            <button className="button button-primary" disabled={pending}>{pending ? 'Connecting…' : 'Connect'}</button>
          </form>
        ) : !error && <p role="status">Checking your invitation…</p>}
      {error && <p className="lobby-feedback" role="alert">{error}</p>}
    </main>
  );
}
