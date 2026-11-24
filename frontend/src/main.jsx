import React, { useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CircleHelp, CircuitBoard, Crosshair, Play, Radio, ShieldCheck, Volume2, VolumeX, X } from 'lucide-react';
import { MORSE, COLORS, DURATION, STORAGE_KEY, initialGame, gameReducer, clock, loadScores, rankScores, makeId, recordWin } from './game';
import { LOCKS, RIDDLE_CARDS } from './expert-manual';
import { JoinPlayer, PlayerLobby } from './player-lobby';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles.css';

const pages = [
  { id: 'console', label: 'Mission control' },
  { id: 'manual', label: 'Expert manual' },
  { id: 'leaderboard', label: 'Leaderboard' },
];

const offlineLink = { status: 'offline', transport: null, connection: null, usbReady: false, notice: '', state: null };
const commandMessages = {
  dropped: 'The link changed before that input was sent. Please check the board and try again.',
  uncertain: 'The link changed before confirming that input. Check the device state before trying again.',
  offline: 'The game is continuing on the ESP32. Wait for the link or use the physical controls.',
  busy: 'Too many inputs are waiting. Try again in a moment.',
};

function App() {
  const [tab, setTab] = useState('leaderboard');
  const [game, dispatch] = useReducer(gameReducer, undefined, initialGame);
  const [scores, setScores] = useState(() => loadScores(localStorage));
  const [modal, setModal] = useState(null);
  const [sound, setSound] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [link, setLink] = useState(offlineLink);
  const [commandError, setCommandError] = useState('');
  const connectionEpoch = useRef(0);
  const sendQueue = useRef(Promise.resolve());
  const device = game.device;
  const controlsBlocked = device && link.status !== 'connected';
  const audio = useRef(null);
  const prevSecond = useRef(null);
  const playing = game.phase === 'playing';
  const failed = game.phase === 'lost';
  const result = game.phase === 'won' || game.phase === 'lost';
  const active = playing || game.phase === 'ready' || game.phase === 'cleared';
  const ranked = tab === 'leaderboard' ? rankScores(scores) : [];

  useEffect(() => {
    if (failed) {
      setTab('console');
      setModal('failure');
    }
  }, [failed]);

  useEffect(() => {
    if (!playing || controlsBlocked) return;
    const timer = setInterval(() => dispatch({ type: 'TICK', now: performance.now() }), 100);
    return () => clearInterval(timer);
  }, [playing, controlsBlocked]);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const events = new EventSource('/api/events');
    let previousLink;
    const update = view => {
      const currentLink = view.connection;
      if (currentLink !== previousLink) {
        ++connectionEpoch.current;
        previousLink = currentLink;
      }
      setLink(view);
    };
    events.onmessage = event => update(JSON.parse(event.data));
    events.onerror = () => update(offlineLink);
    return () => events.close();
  }, []);

  useEffect(() => {
    if (device && link.status === 'connected' && link.state) {
      dispatch({ type: 'HW_SNAPSHOT', snapshot: link.state, now: performance.now() });
    }
  }, [device, link.status, link.state]);

  useEffect(() => {
    if (game.phase !== 'won') return;
    setScores(rows => {
      const next = recordWin(rows, game, Date.now());
      if (next === rows) return rows;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { setStorageError(true); }
      return next;
    });
  }, [game.phase, game.id, game.team, game.defuser, game.expert, game.remaining, game.attempts]);
  useEffect(() => {
    const second = Math.ceil(game.remaining / 1000);
    if (playing && sound && second !== prevSecond.current && audio.current) {
      const ctx = audio.current; const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = second <= 30 ? 880 : 440;
      gain.gain.setValueAtTime(0.025, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(); osc.stop(ctx.currentTime + 0.09);
    }
    prevSecond.current = second;
  }, [game.remaining, sound, playing]);
  function toggleSound() { if (!sound) { const Audio = window.AudioContext || window.webkitAudioContext; if (Audio) { audio.current ||= new Audio(); audio.current.resume(); } } setSound(!sound); }
  async function sendCmd(command) {
    const epoch = connectionEpoch.current;
    const connection = link.connection;
    const task = sendQueue.current.then(async () => {
      if (!connection) return { code: 'offline' };
      if (epoch !== connectionEpoch.current) return { code: 'dropped' };
      const response = await fetch('/api/commands', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, connection }), signal: AbortSignal.timeout(6500),
      });
      return response.json();
    }).catch(() => ({ code: 'uncertain' }));
    sendQueue.current = task;
    const outcome = await task;
    setCommandError(outcome.ok ? '' : (commandMessages[outcome.code] ?? 'The ESP32 refused that command.'));
    return Boolean(outcome.ok);
  }
  function press(key) {
    if (game.round?.solved || controlsBlocked) return;
    if (device) sendCmd('KEY,' + key);
    else dispatch({ type: 'KEY', key });
  }
  function toggleDevice() {
    if (device) dispatch({ type: 'HW_DETACH' });
    else dispatch({ type: 'HW_ATTACH' });
    setCommandError('');
  }
  async function restart() {
    if (device) {
      if (!await sendCmd('RESET')) return;
    } else {
      dispatch({ type: 'RESET' });
    }
    setModal('lobby');
  }
  async function start(players) {
    const names = { ...players, team: players.defuser + ' + ' + players.expert };
    if (device) {
      dispatch({ type: 'HW_BEGIN', players: names });
      if (!await sendCmd('START')) {
        dispatch({ type: 'HW_START_FAILED' });
        return;
      }
    } else {
      dispatch({ type: 'START', players: names, now: performance.now(), id: makeId() });
    }
    setTab('console');
    setModal(null);
  }
  function missionAction() {
    if (failed) {
      setModal('failure');
      return;
    }
    if (controlsBlocked || game.phase === 'cleared') return;
    if (game.phase === 'idle') setModal('lobby');
    else if (game.phase === 'ready') {
      if (device) sendCmd('ARM');
      else dispatch({ type: 'NEXT', now: performance.now() });
    } else if (result) {
      if (!device) dispatch({ type: 'RESET' });
      setModal('lobby');
    } else {
      setModal('reset');
    }
  }
  async function returnAfterFailure() {
    if (device && !await sendCmd('RESET')) return;
    if (!device) dispatch({ type: 'RESET' });
    setModal(null);
    openTab('leaderboard');
  }
  const title = pages.find(page => page.id === tab).label;
  const liveConsole = (playing || failed) && tab === 'console';
  const clueModal = modal === 'confirm-clues' || modal === 'clues';
  const modalTitle = {
    lobby: 'Connect players', reset: 'Restart mission?', help: 'How to play',
    failure: 'Mission failed',
    'confirm-clues': 'Reveal Defuser clues?', clues: 'Defuser clues',
  }[modal];
  const connection = link.status === 'connected'
    ? (link.transport === 'wifi' ? 'Wi-Fi connected' : 'USB connected')
    : link.status === 'switching' ? 'Switching connection' : 'ESP32 offline';
  const error = commandError || link.notice || (controlsBlocked
    ? (link.status === 'switching' ? 'Switching the device link.' : 'Device link lost. The game continues on the ESP32.')
    : '');
  function openTab(id) {
    setTab(id);
    window.scrollTo(0, 0);
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {!liveConsole && <header className="site-header">
        <div className="site-header-inner">
          <button className="wordmark" onClick={() => openTab('leaderboard')} aria-label="DEFUSE home">
            <Crosshair size={22} aria-hidden="true" /> DEFUSE
          </button>
          <nav className="navigation" aria-label="Main navigation">
            {pages.map(({ id, label }) => (
              <button key={id} onClick={() => openTab(id)} aria-current={tab === id ? 'page' : undefined}>{label}</button>
            ))}
          </nav>
          <div className="utilities">
            <button className="icon-button" onClick={() => setModal('help')} aria-label="How to play" title="How to play">
              <CircleHelp size={20} aria-hidden="true" />
            </button>
            <button className="icon-button" onClick={toggleSound} aria-label={sound ? 'Mute sound' : 'Enable sound'} title={sound ? 'Mute sound' : 'Enable sound'}>
              {sound ? <Volume2 size={20} aria-hidden="true" /> : <VolumeX size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>}

      <main id="main-content" className={'workspace' + (liveConsole ? ' live-workspace' : '')} tabIndex={-1}>
        {!liveConsole && <div className="page-heading">
          <h1>{title}</h1>
          {tab === 'console' && (
            <div className="device-controls">
              <span><strong>{device ? 'ESP32' : 'Simulation'}</strong><span className="device-connection">{connection}{link.status === 'connected' && link.transport === 'wifi' && (link.usbReady ? ' / USB ready' : ' / USB backup unavailable')}</span></span>
              {(device || link.status === 'connected') && (
                <button className="button button-quiet" onClick={toggleDevice} disabled={active}>{device ? 'Use simulation' : 'Use ESP32'}</button>
              )}
            </div>
          )}
        </div>}

        {error && <div className="notice"><p role="status">{error}</p>{commandError && <button className="icon-button" onClick={() => setCommandError('')} aria-label="Dismiss message"><X size={18} aria-hidden="true" /></button>}</div>}
        {active && tab !== 'console' && (
          <button className="return-console" onClick={() => openTab('console')}>
            {playing ? 'Return to active mission' : 'Return to paused mission'} <strong>{formatRemaining(game.remaining)}</strong>
          </button>
        )}
        {tab === 'console' && (
          <>
            <div className="console-board" data-playing={(playing || failed) || undefined}>
              <CodeModule round={game.phase === 'ready' ? null : game.round}
                disabled={!playing || controlsBlocked || !!game.round?.solved} onPress={press} />
              {playing || failed ? (
                <LiveCountdown remaining={game.remaining} message={game.message} failed={failed} />
              ) : (
                <MissionSummary game={game} controlsBlocked={controlsBlocked} storageError={storageError}
                  onAction={missionAction} onAbort={() => setModal('reset')} onRanking={() => openTab('leaderboard')} />
              )}
              <WireModule round={game.round} device={device} phase={game.phase} level={game.level}
                controlsBlocked={controlsBlocked} onRestart={missionAction} onManual={() => openTab('manual')}
                onClues={() => setModal('confirm-clues')} onWire={index => {
                  dispatch({ type: game.phase === 'ready' ? 'RECONNECT' : 'WIRE', index });
                }} />
            </div>
            {!playing && !failed && <SessionDetails game={game} />}
          </>
        )}
        {tab === 'manual' && <Manual />}
        {tab === 'leaderboard' && (
          <Leaderboard ranked={ranked} currentId={game.id}
            storageError={storageError} active={active} onPlay={() => setModal('lobby')} />
        )}
      </main>

      {modal && (modal !== 'failure' || failed) && (!clueModal || (playing && !device)) && (
        <Dialog key={clueModal ? modal : 'game'} title={modalTitle}
          className={modal === 'failure' ? 'failure-dialog' : modal === 'lobby' ? 'player-connection-dialog' : undefined} onClose={() => setModal(null)}>
          {modal === 'failure' && (
            <>
              <p>{game.message}</p>
              {controlsBlocked && <p>Reconnect the ESP32 before returning to the leaderboard.</p>}
              {commandError && <p role="status">{commandError}</p>}
              <div className="dialog-actions">
                <button className="button button-quiet" onClick={() => setModal(null)}>Review result</button>
                <button className="button button-primary" onClick={returnAfterFailure} disabled={controlsBlocked}>Return to leaderboard</button>
              </div>
            </>
          )}
          {modal === 'confirm-clues' && (
            <>
              <p>Make sure only the Defuser can see this screen before revealing the clues.</p>
              <div className="dialog-actions">
                <button className="button button-quiet" onClick={() => setModal(null)}>Cancel</button>
                <button className="button button-primary" onClick={() => setModal('clues')}>Reveal clues</button>
              </div>
            </>
          )}
          {modal === 'clues' && <DefuserClues round={game.round} />}
          {modal === 'lobby' && (
            <PlayerLobby device={device} controlsBlocked={controlsBlocked} onStart={start} commandError={commandError} />
          )}
          {modal === 'reset' && (
            <>
              <p>This run will be discarded. Completed scores stay on the leaderboard.</p>
              <div className="dialog-actions">
                <button className="button button-quiet" onClick={() => setModal(null)}>Keep playing</button>
                <button className="button button-primary" onClick={restart} disabled={controlsBlocked}>Restart</button>
              </div>
            </>
          )}
          {modal === 'help' && (
            <>
              <ol className="help-steps">
                <li>The Defuser reads the four Morse groups and card numbers to the Expert.</li>
                <li>The Expert uses the manual to identify the code and the correct wires.</li>
                <li>Enter the code and pull the correct wires. A wrong wire, three wrong codes in a level, or running out of time ends the mission.</li>
                <li>Reconnect the wires between levels. The shared timer pauses until the next level starts.</li>
              </ol>
              <button className="button button-primary" onClick={() => setModal(null)}>Done</button>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

function MissionSummary({ game, controlsBlocked, storageError, onAction, onAbort, onRanking }) {
  const { phase, level, remaining, round, device } = game;
  const wrong = phase === 'ready' ? 0 : round?.wrong || 0;
  const displayLevel = phase === 'ready' ? level + 1 : level;
  const label = phase === 'idle' ? (device ? 'Start game' : 'Start simulation')
    : phase === 'ready' ? `Start level ${displayLevel}`
    : phase === 'cleared' ? 'Level complete' : 'Play again';
  const strongAction = phase !== 'cleared';
  const phaseLabel = {
    idle: 'Ready to start', ready: level === 0 ? 'Waiting to start' : 'Timer paused', cleared: 'Level complete',
    won: 'Mission complete', lost: 'Mission failed',
  }[phase];
  const message = phase === 'won'
    ? `${game.attempts} incorrect codes. ${storageError ? 'Score kept for this session.' : 'Score saved to the leaderboard.'}`
    : game.message || (phase === 'idle' ? 'Decode the clues with your Expert and clear three levels on one clock.' : '');
  const disabled = controlsBlocked || phase === 'cleared' || (phase === 'ready' && round.pulled.some(Boolean));

  return (
    <section className="mission-summary" aria-label="Mission status" data-phase={phase}>
      <ClockReadout remaining={remaining} roundUp={phase === 'ready' || phase === 'cleared'} />
      <div className="mission-readout">
        <p className="run-state" aria-live="polite"><span className="status-dot" aria-hidden="true" />{phaseLabel}</p>
        <MissionFacts level={displayLevel} strikes={wrong} />
      </div>
      <div className="mission-next">
        <div className="actions">
          <button className={'button ' + (strongAction ? 'button-primary' : 'button-quiet')} onClick={onAction} disabled={disabled}>
            {strongAction && <Play size={16} aria-hidden="true" />}{label}
          </button>
          {device && phase === 'ready' && <button className="button button-quiet" onClick={onAbort} disabled={controlsBlocked}>Abort</button>}
          {phase === 'won' && <button className="button button-quiet" onClick={onRanking}>See ranking</button>}
        </div>
        {message && <p className="mission-message" role="status">{message}</p>}
      </div>
      <TimeTrack remaining={remaining} />
    </section>
  );
}

function LiveCountdown({ remaining, message, failed }) {
  const urgent = failed || remaining < 31000;
  return (
    <section className="live-countdown" aria-label="Mission countdown" data-urgent={urgent || undefined}>
      <div className="live-countdown-header">
        <p className="run-state" aria-live="polite"><span className="status-dot" aria-hidden="true" />{failed ? 'Mission failed' : urgent ? 'Time running low' : 'Device armed'}</p>
        <span className="timer-system" aria-hidden="true">SYS / 001</span>
      </div>
      <div className="countdown-ring" style={{ '--remaining': timePercentage(remaining) }}>
        <ClockReadout remaining={remaining} showFractions />
        {!failed && remaining > 0 && <span className="countdown-tail" style={{ '--tail-angle': `${timeRatio(remaining) * 360}deg` }} aria-hidden="true"><span /></span>}
      </div>
      <p className="mission-message" role="status">{message}</p>
    </section>
  );
}

function ClockReadout({ remaining, showFractions, roundUp }) {
  const fraction = String(Math.floor(remaining % 1000 / 10)).padStart(2, '0');
  return (
    <div className="mission-clock">
      <span id="clock-label">Time remaining</span>
      <span className="clock-value" role="timer" aria-labelledby="clock-label">
        {roundUp ? formatRemaining(remaining) : clock(remaining)}{showFractions && <span className="clock-fraction" aria-hidden="true">.{fraction}</span>}
      </span>
    </div>
  );
}

function TimeTrack({ remaining }) {
  return <div className="time-track" aria-hidden="true"><span style={{ width: timePercentage(remaining) }} /></div>;
}

function timePercentage(remaining) {
  return `${timeRatio(remaining) * 100}%`;
}

function timeRatio(remaining) {
  return Math.min(1, Math.max(0, remaining / DURATION));
}

function MissionFacts({ level, strikes }) {
  return (
    <dl className="mission-facts">
      <div><dt>Level</dt><dd>{level} <span>/ 3</span></dd></div>
      <div><dt>Strikes</dt><dd data-has-strikes={strikes > 0 || undefined}>{strikes} <span>/ 3</span></dd></div>
    </dl>
  );
}

function formatRemaining(ms) {
  return clock(Math.ceil(ms / 1000) * 1000);
}

function CodeModule({ round, disabled, onPress }) {
  function handleKey(event) {
    if (disabled || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Enter' && event.target !== event.currentTarget) return;
    const key = event.key === 'Enter' ? '#' : event.key === 'Backspace' ? '*' : event.key;
    if (!/^[0-9*#]$/.test(key)) return;
    event.preventDefault();
    onPress(key);
  }
  return (
    <section className="puzzle code-module" aria-labelledby="code-title">
      <h2 id="code-title" className="sr-only">Keypad</h2>
      <div className="code-entry">
        <span>{round?.solved ? 'Code verified' : 'Entered code'}</span>
        <output aria-label="Entered code">{round?.entry || '—'}</output>
      </div>
      <div className="keypad" role="group" aria-label="Code keypad" aria-describedby="keypad-help" tabIndex={disabled ? undefined : 0} onKeyDown={handleKey}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(key => (
          <button key={key} onClick={() => onPress(key)} disabled={disabled}
            className={key === '#' ? 'submit-key' : undefined}>
            {key === '#' ? 'Submit' : key === '*' ? 'Clear' : key}
          </button>
        ))}
      </div>
      <p id="keypad-help" className="input-help">Focus the keypad for <kbd>0–9</kbd>, <kbd>Enter</kbd> to submit, or <kbd>Backspace</kbd> to clear.</p>
    </section>
  );
}

function WireModule({ round, device, phase, level, onWire, controlsBlocked, onRestart, onManual, onClues }) {
  const canPull = phase === 'playing';
  const reconnect = phase === 'ready';
  const disconnected = round?.pulled.filter(Boolean).length || 0;
  return (
    <section className="puzzle wire-module" aria-labelledby="wire-title">
      {canPull || phase === 'lost' ? <>
        <MissionFacts level={level} strikes={round?.wrong || 0} />
        <h2 id="wire-title" className="live-wires-title">Wires</h2>
      </> : <h2 id="wire-title">Wires</h2>}
      {reconnect && <p className="module-hint">Reconnect every wire before starting the next level.</p>}
      {canPull && !device && round.cards.length > 0 && (
        <button className="button button-quiet private-clue-button" onClick={onClues}>Show Defuser clues</button>
      )}
      <div className="wire-summary"><span>Wire bank</span><span>{disconnected} / {COLORS.length} disconnected</span></div>
      <ul className="wire-bank">
        {COLORS.map((color, index) => {
          const name = color.toLowerCase();
          const pulled = Boolean(round?.pulled[index]);
          const action = reconnect ? 'Reconnect' : 'Pull';
          const status = pulled ? 'Disconnected' : 'Connected';
          const enabled = (canPull && !pulled) || (reconnect && pulled);
          const wireClass = `wire-row wire-${name}`;
          const contents = <>
            <span className="wire-label">{name}</span>
            <span className="wire-cable" aria-hidden="true" />
            <span className="wire-terminal" aria-hidden="true" />
          </>;
          return (
            <li key={color}>
              {device ? <div className={wireClass} data-pulled={pulled}>{contents}<span className="sr-only">{status}</span></div> : (
                <button className={wireClass} data-pulled={pulled} onClick={() => onWire(index)} disabled={!enabled}
                  aria-label={`${name} wire, ${status.toLowerCase()}${enabled ? ', ' + action.toLowerCase() : ''}`}>{contents}</button>
              )}
            </li>
          );
        })}
      </ul>
      {device && <p className="input-help">Wire status comes from the physical ESP32.</p>}
      {canPull && <div className="wire-actions">
        <button className="button button-quiet" onClick={onManual}>Expert manual</button>
        <button className="button button-quiet" onClick={onRestart} disabled={controlsBlocked}>Restart</button>
      </div>}
      {phase === 'lost' && <div className="wire-actions">
        <button className="button button-quiet" onClick={onRestart}>Return to leaderboard</button>
      </div>}
    </section>
  );
}

function DefuserClues({ round }) {
  return <>
    <ol className="morse-groups" aria-label="Morse clues">
      {[...round.code].map((digit, index) => {
        const group = MORSE[Number(digit)];
        return <li key={index}>
          <span className="sr-only">{[...group].map(mark => mark === '.' ? 'dot' : 'dash').join(' ')}</span>
          <code aria-hidden="true">{group}</code>
        </li>;
      })}
    </ol>
    <p className="wire-clue-numbers">Wire clue numbers <strong>{round.cards.map(card => String(card).padStart(2, '0')).join(', ')}</strong></p>
  </>;
}

function SessionDetails({ game }) {
  if (!game.team && game.log.length === 0) return null;
  return (
    <details className="session-details">
      <summary>Session details</summary>
      {game.team && <p><strong>{game.team}</strong> · Defuser: {game.defuser} · Expert: {game.expert}</p>}
      {game.log.length > 0 && (
        <ol className="activity-list" aria-label="Recent activity">
          {game.log.slice(0, 4).map((entry, index) => (
            <li key={`${entry.at}-${index}`}><span>{entry.text}</span><time>{clock(entry.at)}</time></li>
          ))}
        </ol>
      )}
    </details>
  );
}

function Manual() {
  return (
    <div className="manual">
      <section className="reference" aria-labelledby="roles-title">
        <h2 id="roles-title">How to play</h2>
        <p>The Defuser operates the device and reads out the Morse groups and wire clue numbers. The Expert uses this manual and tells the Defuser which digits to enter and which wires to pull. Keep each player’s screen private.</p>
      </section>
      <section className="reference" aria-labelledby="morse-title">
        <h2 id="morse-title">Morse decoder</h2>
        <p>Match each five-symbol group to one digit. Keep leading zeros.</p>
        <dl className="morse-reference">
          {MORSE.map((morse, digit) => <div key={digit}><dt>{digit}</dt><dd><code aria-label={morse.split('').map(mark => mark === '.' ? 'dot' : 'dash').join(' ')}>{morse}</code></dd></div>)}
        </dl>
      </section>
      <section className="reference" aria-labelledby="codebook-title">
        <h2 id="codebook-title">Codebook</h2>
        <p>Use A = 0 through Z = 25 for the letter locks.</p>
        <dl className="morse-reference alphabet-reference">
          {Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (letter, index) => <div key={letter}><dt>{letter}</dt><dd>{index}</dd></div>)}
        </dl>
        <ul className="help-steps lock-rules">{LOCKS.map(lock => <li key={lock}>{lock}</li>)}</ul>
      </section>
      <section className="reference" aria-labelledby="riddles-title">
        <h2 id="riddles-title">Wire riddles</h2>
        <p>Find the card number and tell the Defuser which wire to pull. The order does not matter.</p>
        <div className="riddle-grid">
          {RIDDLE_CARDS.map(card => (
            <details key={card.id}>
              <summary>Card {String(card.id).padStart(2, '0')}</summary>
              {card.lines.map((line, index) => <p key={index}>{/^[A-Z]{3,}( [A-Z]{1,})+$/.test(line) ? <code>{line}</code> : line}</p>)}
            </details>
          ))}
        </div>
      </section>
      <details className="session-details">
        <summary>Rules by mode</summary>
        <ul className="help-steps">
          <li>Both modes have five wires. Simulation requires one, two, then three correct wires. ESP32 levels require one to five.</li>
          <li>Three wrong codes in one level, a wrong wire, or an expired timer ends the mission. Incomplete codes do not use a strike.</li>
          <li>Reconnect wires between levels. The four-minute timer pauses until the next level begins.</li>
        </ul>
      </details>
    </div>
  );
}

function Leaderboard({ ranked, currentId, storageError, active, onPlay }) {
  return (
    <section className="leaderboard" aria-label="Saved scores">
      <div className="leaderboard-heading">
        <p>Most time remaining ranks first. Fewer incorrect codes break ties.</p>
        {!active && <button className="button button-primary" onClick={onPlay}>Connect Players</button>}
      </div>
      {storageError && <p className="notice" role="status">Browser storage is unavailable. This session’s results will disappear after reload.</p>}
      <div className="rankings-layout">
        <section className="podium-panel" aria-labelledby="podium-title">
          <h2 id="podium-title">Top finishers</h2>
          {ranked.length === 0 && <p className="rankings-note" role="status">Clear all three levels to earn a podium spot.</p>}
          <ol className="podium" aria-label="Top three ranks" role="list">
            {[ShieldCheck, CircuitBoard, Radio].map((Icon, index) => {
              const score = ranked[index];
              const rank = index + 1;
              return <li key={rank} className="podium-place" data-rank={rank}>
                <span className="sr-only">Rank {rank}</span>
                <span className="podium-icon"><Icon aria-hidden="true" size={30} strokeWidth={1.6} /></span>
                <div className="podium-details">
                  <strong>{score ? score.team : 'Open spot'}</strong>
                  {score && <>
                    <p>{score.defuser} + {score.expert}</p>
                    <p><span className="score-time">{clock(score.remaining)}</span> left</p>
                    <p>{score.attempts} {score.attempts === 1 ? 'error' : 'errors'} · {new Date(score.date).toLocaleDateString()}</p>
                    {score.id === currentId && <span className="current-score">Your run</span>}
                  </>}
                </div>
                <div className="podium-step" aria-hidden="true">{rank}</div>
              </li>;
            })}
          </ol>
        </section>
        <section className="runners-panel" aria-labelledby="runners-title">
          <h2 id="runners-title">Runners-up</h2>
          {ranked.length > 3 ? (
            <ol className="runner-list" start={4} aria-label="Ranks four and lower" role="list" tabIndex={0}>
              {ranked.slice(3).map((score, index) => <li key={score.id}>
                <span className="runner-rank">{index + 4}</span>
                <div className="runner-team">
                  <strong>{score.team}</strong>
                  <span>{score.defuser} + {score.expert}</span>
                  <span>{new Date(score.date).toLocaleDateString()}</span>
                  {score.id === currentId && <span className="current-score">Your run</span>}
                </div>
                <div className="runner-score">
                  <span className="score-time">{clock(score.remaining)}<span className="sr-only"> left</span></span>
                  <span>{score.attempts} {score.attempts === 1 ? 'error' : 'errors'}</span>
                </div>
              </li>)}
            </ol>
          ) : <p className="rankings-note">Ranks 4 and below appear here.</p>}
        </section>
      </div>
      <p className="local-note">Scores are saved in this browser.</p>
    </section>
  );
}

function Dialog({ title, children, onClose, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog.showModal();
    dialog.querySelector('input')?.focus();
    return () => {
      dialog.close();
      if (trigger?.isConnected && !trigger.disabled) trigger.focus();
      else document.getElementById('main-content')?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={className} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
      <div className="dialog-content">
        <div className="dialog-title">
          <h2 id="dialog-title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

const joinInvite = window.location.pathname.match(/^\/join\/([a-f0-9]{36})$/)?.[1];
createRoot(document.getElementById('root')).render(joinInvite ? <JoinPlayer invite={joinInvite} /> : <App />);
