import React, { useEffect, useRef, useState } from 'react';
import { Manual } from './manual';

const roles = [
  { id: 'defuser', title: 'Defuser', player: 'Player 1' },
  { id: 'expert', title: 'Expert', player: 'Player 2' },
];
const emptyNames = { defuser: '', expert: '' };
const jsonHeaders = { 'Content-Type': 'application/json' };
const expired = error => ['closed', 'expired'].includes(error.message);
const timeout = () => AbortSignal.timeout(5000);

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
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(true);
  const [networkMessage, setNetworkMessage] = useState('');
  const [streamMessage, setStreamMessage] = useState('');
  const [error, setError] = useState('');
  const [address, setAddress] = useState('');
  const [pending, setPending] = useState(false);
  const [qrVersion, setQrVersion] = useState(0);
  const [copy, setCopy] = useState(null);
  const mounted = useRef(false);
  const live = useRef({ id: null, events: null, revision: -1 });
  const complete = Boolean(names.defuser && names.expert);

  function applyPlayers(lobby) {
    if (lobby.revision < live.current.revision) return;
    live.current.revision = lobby.revision;
    setNames(lobby.players);
  }

  function applyNetworkInfo(lobby) {
    setSession(lobby);
    const preferred = lobby.networks.find(network => network.preferred !== false)?.address ?? '';
    setAddress(previous => lobby.networks.some(network => network.address === previous) ? previous : preferred);
    setNetworkMessage(!lobby.joinPort ? 'The phone listener could not start. Use manual entry.' :
      !lobby.networks.length ? 'No local network address is available. Use manual entry or reconnect to Wi-Fi.' :
        !preferred ? 'Select a network the phones can reach, or use manual entry.' : '');
    if (!preferred) setManual(true);
  }

  function closeLobby({ id, events }) {
    events?.close();
    if (id) void api('/api/lobbies/' + id, { method: 'DELETE', keepalive: true }).catch(() => {});
  }

  async function loadLobby(existing, retained = null) {
    setLoading(true);
    setNetworkMessage('');
    setCopy(null);
    try {
      let lobby;
      if (existing) {
        try {
          lobby = await api('/api/lobbies/' + existing, { signal: timeout() });
        } catch (error) {
          if (!expired(error)) throw error;
        }
      }
      if (!lobby) {
        lobby = await api('/api/lobbies', { method: 'POST', signal: timeout() });
        if (!mounted.current) {
          closeLobby(lobby);
          return;
        }
        closeLobby(live.current);
        const id = lobby.id;
        const events = new EventSource('/api/lobbies/' + id + '/events');
        live.current = { id, events, revision: -1 };
        events.onmessage = event => {
          if (live.current.id !== id) return;
          const next = JSON.parse(event.data);
          if (!next) {
            events.close();
            setSession(null);
            setAddress('');
            setNetworkMessage('The invitations expired. Retry QR for new codes or use manual entry.');
            setManual(true);
          } else {
            applyPlayers(next);
            setStreamMessage('');
          }
        };
        events.onerror = () => setStreamMessage('Live lobby updates are reconnecting.');
        const retainedNames = Object.fromEntries(Object.entries(retained ?? {}).filter(([, name]) => name));
        if (Object.keys(retainedNames).length) {
          const updated = await api('/api/lobbies/' + id + '/manual', {
            method: 'POST', headers: jsonHeaders, body: JSON.stringify(retainedNames), signal: timeout(),
          });
          lobby = { ...lobby, ...updated };
        }
      }
      if (!mounted.current) return;
      applyNetworkInfo(lobby);
      applyPlayers(lobby);
      setQrVersion(version => version + 1);
    } catch {
      if (mounted.current) {
        setNetworkMessage('The lobby could not be reached. Retry QR or enter names manually.');
        setManual(true);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void loadLobby(null);
    return () => {
      mounted.current = false;
      closeLobby(live.current);
      live.current = { id: null, events: null, revision: -1 };
    };
  }, []);

  async function saveNames(event) {
    event.preventDefault();
    const updates = Object.fromEntries(roles.map(({ id }) => [id, draft[id].trim()]).filter(([, name]) => name));
    if (!Object.keys(updates).length) {
      setError('Enter at least one name.');
      return;
    }
    setError('');
    setPending(true);
    try {
      if (session) {
        const lobby = await api('/api/lobbies/' + session.id + '/manual', {
          method: 'POST', headers: jsonHeaders, body: JSON.stringify(updates), signal: timeout(),
        });
        applyPlayers(lobby);
      } else {
        setNames(previous => ({ ...previous, ...Object.fromEntries(Object.entries(updates).filter(([id]) => !previous[id])) }));
      }
      setDraft(emptyNames);
    } catch (error) {
      setError(error.message === 'occupied' ? 'That role is already assigned. Open a new lobby to change players.' :
        expired(error) ? 'This lobby expired. Retry QR or reopen the lobby.' : 'Names could not be saved. Try again.');
    } finally {
      setPending(false);
    }
  }

  async function start() {
    if (!complete || pending || controlsBlocked) return;
    setPending(true);
    try {
      await onStart(names, session?.id);
    } finally {
      setPending(false);
    }
  }

  async function copyLink(role) {
    try {
      const data = await api('/api/lobbies/' + session.id + '/link/' + role + '?address=' + encodeURIComponent(address), { signal: timeout() });
      setCopy({ role, url: data.url, done: false });
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.url);
        setCopy({ role, url: data.url, done: true });
      }
    } catch {
      setNetworkMessage('Could not copy automatically. Select the link below if it is available, or retry QR.');
    }
  }

  return (
    <div className="player-lobby">
      {address && <p className="lobby-intro">Connect both phones to the same local network as the laptop, then scan one QR code per player.</p>}
      {(session?.networks.length > 1 || (!address && session?.networks.length > 0)) && (
        <label className="lobby-network">Network for QR codes
          <select value={address} onChange={event => { setAddress(event.target.value); setCopy(null); }}>
            <option value="" disabled>Select a network</option>
            {session.networks.map(network => <option key={network.address} value={network.address}>{network.name} ({network.address})</option>)}
          </select>
        </label>
      )}
      {address && <p className="lobby-hint">Phone network {address}:{session.joinPort}. Check Windows Firewall and use the same Wi-Fi. Guest networks may isolate devices.</p>}
      <div className="player-roles">
        {roles.map(({ id, title, player }) => (
          <section className="player-role" key={id} aria-labelledby={id + '-role'}>
            <span className="player-number">{player}</span>
            <h3 id={id + '-role'}>{title}</h3>
            <div className="player-slot" aria-live="polite">
              {names[id] ? (
                <div className="player-connected"><strong>{names[id]}</strong><span>Connected</span></div>
              ) : address && session ? (
                <img className="player-qr" alt={'Scan to join as ' + title} width={156} height={156}
                  src={'/api/lobbies/' + session.id + '/qr/' + id + '?address=' + encodeURIComponent(address) + '&retry=' + qrVersion}
                  onError={() => { setNetworkMessage('A QR image could not be loaded. Retry QR or use manual entry.'); setManual(true); }} />
              ) : <span className="player-waiting">{loading ? 'Preparing QR code…' : 'Waiting for a name'}</span>}
            </div>
            {!names[id] && address && session && <button type="button" className="button button-quiet" onClick={() => copyLink(id)}
              aria-label={'Copy Join Link for ' + title}>Copy Join Link</button>}
          </section>
        ))}
      </div>
      {copy && (copy.done ? <p role="status">Join link copied.</p> :
        <label className="lobby-network">Join link for {roles.find(role => role.id === copy.role)?.title}
          <input readOnly value={copy.url} onFocus={event => event.target.select()} />
        </label>)}
      {networkMessage && <p className="lobby-feedback" role="status">{networkMessage}</p>}
      {streamMessage && <p className="lobby-feedback" role="status">{streamMessage}</p>}
      <button type="button" className="button button-quiet" disabled={loading || pending} onClick={() => loadLobby(session?.id, names)}>Retry QR</button>
      <details className="lobby-manual" open={manual} onToggle={event => setManual(event.currentTarget.open)}>
        <summary>Manual entry</summary>
        <form onSubmit={saveNames}>
          <div className="lobby-name-fields">
            {roles.map(({ id, title }) => (
              <label key={id}>{title} name<input maxLength={24} autoComplete="off" value={names[id] || draft[id]} disabled={Boolean(names[id])}
                onChange={event => setDraft({ ...draft, [id]: event.target.value })} /></label>
            ))}
          </div>
          <button className="button button-quiet" type="submit" disabled={loading || pending || complete}>Save names</button>
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
      {commandError && <p className="lobby-feedback" role="alert">{commandError}</p>}
    </div>
  );
}

const joinErrors = {
  closed: 'This invitation has expired or closed. Ask the host for a fresh QR code.',
  occupied: 'This role is already taken. Ask the host to check the lobby.',
  invalid: 'Enter a name of up to 24 characters.',
};
export function JoinPlayer({ invite }) {
  const [role, setRole] = useState(null);
  const [name, setName] = useState('');
  const [confirmed, setConfirmed] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(false);
  const endpoint = '/api/join/' + invite;

  useEffect(() => {
    let next;
    const controller = new AbortController();
    async function refresh() {
      try {
        const data = await api(endpoint, { signal: AbortSignal.any([controller.signal, timeout()]) });
        setRole(roles.find(role => role.id === data.role));
        setStatus(data.status);
        if (data.name) {
          setConfirmed(data.name);
          setError('');
        } else if (data.occupied) {
          setError(joinErrors.occupied);
        }
        if (data.status === 'started') return;
      } catch (error) {
        if (controller.signal.aborted) return;
        setError(joinErrors[error.message] || 'Reconnecting to the lobby. Check the local network.');
        if (expired(error)) return;
      }
      if (!controller.signal.aborted) next = setTimeout(refresh, 1500);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(next); };
  }, [endpoint]);

  async function join(event) {
    event.preventDefault();
    const value = name.trim();
    if (!value) return setError(joinErrors.invalid);
    setPending(true);
    setError('');
    try {
      const data = await api(endpoint, { method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ name: value }), signal: timeout() });
      setConfirmed(data.name);
      setStatus(data.status);
    } catch (error) {
      setError(joinErrors[error.message] || 'Connection failed. Check the local network and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="workspace phone-join">
      <span className="player-number">DEFUSE{role && ' / ' + role.player}</span>
      <h1>{confirmed ? status === 'started' ? 'Game started' : 'You’re connected' : role ? 'Join as ' + role.title : 'Connect to DEFUSE'}</h1>
      {confirmed && role ? (
        <>
          <p role="status">{confirmed}, you’re the {role.title}. {status === 'started' ? 'The host has started the game.' :
            status === 'starting' ? 'The host is starting the game.' : 'Wait for the host to start.'}</p>
          {role.id === 'expert' && <>
            <button type="button" className="button button-primary" aria-expanded={manual} aria-controls="phone-manual"
              onClick={() => setManual(previous => !previous)}>{manual ? 'Hide Expert manual' : 'Open Expert manual'}</button>
            {manual && <section id="phone-manual" aria-label="Expert manual"><Manual /></section>}
          </>}
        </>
      ) : role && error !== joinErrors.occupied && error !== joinErrors.closed ? (
        <form onSubmit={join}>
          <label>Name<input required maxLength={24} name="name" autoComplete="given-name" value={name} onChange={event => setName(event.target.value)} /></label>
          <button className="button button-primary" disabled={pending}>{pending ? 'Connecting…' : 'Connect'}</button>
        </form>
      ) : !error && <p role="status">Checking your invitation…</p>}
      {error && <p className="lobby-feedback" role="alert">{error}</p>}
    </main>
  );
}
