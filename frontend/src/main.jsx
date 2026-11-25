import React, { useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CircleHelp, CircuitBoard, Crosshair, Play, Radio, ShieldCheck, Volume2, VolumeX, X } from 'lucide-react';
import { MORSE, COLORS, DURATION, initialGame, gameReducer, clock, makeId } from './game';
import { Manual } from './manual';
import { cardNumber } from './expert-manual';
import { saveMessages, useServerScores } from './scores';
import { LegacyScores } from './legacy-scores';
import { useSoundtrack } from './use-soundtrack';
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
const DEVICE_MODE = 'defuse.hardware-mode';
function restoreDeviceMode() {
  try { return sessionStorage.getItem(DEVICE_MODE) === '1'; } catch { return false; }
}
function rememberDeviceMode(value) {
  try { sessionStorage.setItem(DEVICE_MODE, value ? '1' : '0'); } catch { /* This tab can still change modes. */ }
}
const commandMessages = {
  dropped: 'The link changed before that input was sent. Please check the board and try again.',
  uncertain: 'The link changed before confirming that input. Check the device state before trying again.',
  offline: 'The game is continuing on the ESP32. Wait for the link or use the physical controls.',
  busy: 'Too many inputs are waiting. Try again in a moment.',
  unavailable: 'The hardware start could not be saved. Check the score database before retrying.',
};

function App() {
  const [tab, setTab] = useState(() => restoreDeviceMode() ? 'console' : 'leaderboard');
  const [mission, dispatchMission] = useReducer(gameReducer, undefined, () => ({ ...initialGame(), device: restoreDeviceMode() }));
  const [testRun, dispatchTest] = useReducer(gameReducer, undefined, initialGame);
  const [testLobby, setTestLobby] = useState(null);
  const [startingRealGame, setStartingRealGame] = useState(false);
  const { scores, loading: scoresLoading, storageError, states: scoreStates } = useServerScores(mission);
  const [modal, setModal] = useState(null);
  const [link, setLink] = useState(offlineLink);
  const [commandError, setCommandError] = useState('');
  const [leavingFailure, setLeavingFailure] = useState(false);
  const connectionEpoch = useRef(0);
  const sendQueue = useRef(Promise.resolve());
  const practice = Boolean(testLobby);
  const game = practice ? testRun : mission;
  const dispatch = practice ? dispatchTest : dispatchMission;
  const device = game.device;
  const controlsBlocked = device && link.status !== 'connected';
  const realGameBlocked = mission.device && link.status !== 'connected';
  const playing = game.phase === 'playing';
  const failed = game.phase === 'lost';
  const result = game.phase === 'won' || game.phase === 'lost';
  const active = practice || playing || game.phase === 'ready' || game.phase === 'cleared';
  const ranked = tab === 'leaderboard' ? scores : [];
  const soundtrack = useSoundtrack({
    active: playing && (!device || (link.status === 'connected' && link.state?.phase === 'playing')),
    practice,
    runId: game.id,
    device,
    deadline: game.deadline,
    hardwareSeconds: link.state?.seconds,
    clock: link.musicClock,
    snapshotAt: link.receivedAt,
  });

  useEffect(() => {
    if (failed) {
      setTab('console');
      setModal('failure');
    }
  }, [failed]);

  useEffect(() => {
    if (!playing || practice || controlsBlocked) return;
    const timer = setInterval(() => dispatch({ type: 'TICK', now: performance.now() }), 100);
    return () => clearInterval(timer);
  }, [playing, practice, controlsBlocked, dispatch]);
  useEffect(() => {
    const events = new EventSource('/api/events');
    let previousLink;
    const update = view => {
      const currentLink = view.connection;
      if (currentLink !== previousLink) {
        ++connectionEpoch.current;
        previousLink = currentLink;
      }
      setLink({ ...view, receivedAt: Date.now() });
    };
    events.onmessage = event => update(JSON.parse(event.data));
    events.onerror = () => update(offlineLink);
    return () => events.close();
  }, []);

  useEffect(() => {
    if (mission.device && link.state) {
      dispatchMission({ type: 'HW_SNAPSHOT', snapshot: link.state, now: performance.now() });
    }
  }, [mission.device, link.state]);

  async function sendCmd(command, { players, immediate = false } = {}) {
    const epoch = connectionEpoch.current;
    const connection = link.connection;
    const send = async () => {
      if (!connection) return { code: 'offline' };
      if (epoch !== connectionEpoch.current) return { code: 'dropped' };
      const response = await fetch('/api/commands', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, connection, players }), signal: AbortSignal.timeout(6500),
      });
      return response.json();
    };
    const task = (immediate ? send() : sendQueue.current.then(send)).catch(() => ({ code: 'uncertain' }));
    if (!immediate) sendQueue.current = task;
    const outcome = await task;
    setCommandError(outcome.ok ? '' : (commandMessages[outcome.code] ?? 'The ESP32 refused that command.'));
    return Boolean(outcome.ok);
  }
  function press(key) {
    if (game.round?.solved || controlsBlocked) return;
    if (device) sendCmd('KEY,' + key);
    else dispatch({ type: 'KEY', key, now: performance.now() });
  }
  function toggleDevice() {
    rememberDeviceMode(!device);
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
  async function start(players, lobbyId) {
    let outcome;
    if (lobbyId) {
      try {
        const response = await fetch('/api/lobbies/' + lobbyId + '/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: mission.device ? 'hardware' : 'simulation', connection: link.connection }),
          signal: AbortSignal.timeout(8000),
        });
        outcome = await response.json();
      } catch {
        outcome = { code: 'uncertain' };
      }
      if (!outcome.ok) {
        setCommandError(commandMessages[outcome.code] ?? 'The lobby could not start. Check both names and try again.');
        return outcome.code ?? 'unavailable';
      }
    } else if (mission.device && !await sendCmd('START', { players })) return 'unavailable';
    const names = outcome?.players ?? players;
    if (!mission.device) dispatchMission({ type: 'START', players: { ...names, team: names.defuser + ' + ' + names.expert },
      now: performance.now(), id: outcome?.runId ?? makeId() });
    setCommandError('');
    setTab('console');
    setModal(null);
    return null;
  }
  function startTestRun(players, lobbyId) {
    soundtrack.enableForTest();
    setCommandError('');
    setTestLobby({ players, id: lobbyId });
    dispatchTest({ type: 'START_PRACTICE' });
    setModal(null);
    openTab('console');
  }
  async function startRealAfterTest() {
    if (startingRealGame || realGameBlocked) return;
    setStartingRealGame(true);
    try {
      const error = await start(testLobby.players, testLobby.id);
      if (error && !['closed', 'expired'].includes(error)) return;
      dispatchTest({ type: 'RESET' });
      setTestLobby(null);
      if (error) {
        setCommandError('The lobby expired. Reconnect both players to start the real game.');
        setModal('lobby');
      }
    } finally {
      setStartingRealGame(false);
    }
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
    if (leavingFailure) return;
    setLeavingFailure(true);
    if (device && (controlsBlocked || !await sendCmd('RESET', { immediate: true }))) {
      rememberDeviceMode(false);
      dispatch({ type: 'HW_DETACH' });
      setCommandError('');
    }
    if (!device) dispatch({ type: 'RESET' });
    setLeavingFailure(false);
    setModal(null);
    openTab('leaderboard');
  }
  const title = pages.find(page => page.id === tab).label;
  const liveConsole = (playing || failed || practice) && tab === 'console';
  const clueModal = modal === 'confirm-clues' || modal === 'clues';
  const modalTitle = {
    lobby: 'Connect players', reset: 'Restart mission?', help: 'How to play',
    failure: 'Mission failed',
    'confirm-clues': 'Reveal Defuser clues?', clues: 'Defuser clues',
  }[modal];
  const connection = link.status === 'connected'
    ? (link.transport === 'wifi' ? 'Wi-Fi connected' : 'USB connected')
    : link.status === 'switching' ? 'Switching connection' : 'ESP32 offline';
  const error = commandError || soundtrack.error || link.notice || (controlsBlocked
    ? (link.status === 'switching' ? 'Switching the device link.' : active ? 'Device link lost. The game continues on the ESP32.' : 'ESP32 link unavailable.')
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
            <SoundToggle soundtrack={soundtrack} />
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
            {practice ? 'Return to test run' : playing ? 'Return to active mission' : 'Return to paused mission'}
            {!practice && <strong>{formatRemaining(game.remaining)}</strong>}
          </button>
        )}
        {tab === 'console' && (
          <>
            <div className="console-board" data-playing={(playing || failed || practice) || undefined}>
              {playing || failed || practice ? (
                <LiveCountdown remaining={game.remaining} message={game.message} failed={failed} soundtrack={soundtrack}
                  practice={practice} practiceDone={practice && result} onStartReal={startRealAfterTest}
                  startingReal={startingRealGame} realGameBlocked={realGameBlocked}
                  onClues={playing && !device && game.round.cards.length ? () => setModal('confirm-clues') : undefined} />
              ) : (
                <MissionSummary game={game} controlsBlocked={controlsBlocked} saveState={device ? link.scoreStatus ?? 'pending' : scoreStates[game.id]}
                  onAction={missionAction} onAbort={() => setModal('reset')} onRanking={() => openTab('leaderboard')} />
              )}
              <CodeModule round={game.phase === 'ready' ? null : game.round}
                disabled={!playing || controlsBlocked || !!game.round?.solved} onPress={press} />
              <WireModule round={game.round} device={device} phase={game.phase} level={game.level} practice={practice}
                controlsBlocked={controlsBlocked} onRestart={missionAction} onManual={() => openTab('manual')}
                onWire={index => {
                  dispatch({ type: game.phase === 'ready' ? 'RECONNECT' : 'WIRE', index, now: performance.now() });
                }} />
            </div>
            {!practice && !playing && !failed && <SessionDetails game={game} />}
          </>
        )}
        {tab === 'manual' && <Manual />}
        {tab === 'leaderboard' && (
          <Leaderboard ranked={ranked} currentId={game.id}
            storageError={storageError} loading={scoresLoading} active={active} onPlay={() => setModal('lobby')} />
        )}
      </main>

      {modal && (modal !== 'failure' || failed) && (!clueModal || (playing && !device)) && (
        <Dialog key={clueModal ? modal : 'game'} title={modalTitle}
          className={modal === 'failure' ? 'failure-dialog' : modal === 'lobby' ? 'player-connection-dialog' : undefined} onClose={() => setModal(null)}>
          {modal === 'failure' && (
            <>
              <p>{game.message}</p>
              {controlsBlocked && <p>The console will detach from the offline ESP32 when you leave.</p>}
              {commandError && <p role="status">{commandError}</p>}
              <div className="dialog-actions">
                <button className="button button-quiet" onClick={() => setModal(null)}>Review result</button>
                <button className="button button-primary" onClick={returnAfterFailure} disabled={leavingFailure}>
                  {leavingFailure ? 'Resetting the ESP32…' : 'Return to leaderboard'}
                </button>
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
            <PlayerLobby device={device} controlsBlocked={controlsBlocked} onStart={start} onTestRun={startTestRun} commandError={commandError} />
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

function MissionSummary({ game, controlsBlocked, saveState, onAction, onAbort, onRanking }) {
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
    ? `${game.attempts} incorrect codes. ${saveMessages[saveState ?? 'saving']}`
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

function SoundToggle({ soundtrack }) {
  const label = soundtrack.enabled ? 'Mute sound' : 'Enable sound';
  return (
    <button type="button" className="icon-button" aria-label={label} title={label} onClick={soundtrack.toggle}>
      {soundtrack.enabled ? <Volume2 size={20} aria-hidden="true" /> : <VolumeX size={20} aria-hidden="true" />}
    </button>
  );
}

function LiveCountdown({ remaining, message, failed, soundtrack, practice, practiceDone, onStartReal, startingReal, realGameBlocked, onClues }) {
  const urgent = !practice && (failed || remaining < 31000);
  const status = practice ? (practiceDone ? 'Test run complete' : 'Test run')
    : failed ? 'Mission failed' : urgent ? 'Time running low' : 'Device armed';
  return (
    <section className="live-countdown" aria-label="Mission countdown" data-urgent={urgent || undefined} data-practice={practice || undefined}>
      <div className="live-countdown-header">
        <p className="run-state" aria-live="polite"><span className="status-dot" aria-hidden="true" />{status}</p>
        <SoundToggle soundtrack={soundtrack} />
      </div>
      <div className="countdown-ring" style={{ '--remaining': practice ? '100%' : timePercentage(remaining) }}>
        <ClockReadout remaining={practice ? 0 : remaining} showFractions={!practice} label={practice ? 'Timer off' : undefined} />
        {!practice && !failed && remaining > 0 && <span className="countdown-tail" style={{ '--tail-angle': `${timeRatio(remaining) * 360}deg` }} aria-hidden="true"><span /></span>}
      </div>
      <div className="countdown-footer">
        {practiceDone ? <>
          <p className="mission-message">{realGameBlocked ? 'Reconnect the ESP32 to continue.' : 'Next is the four-minute mission.'}</p>
          <button type="button" className="button button-primary" onClick={onStartReal} disabled={startingReal || realGameBlocked}>
            <Play size={16} aria-hidden="true" />{startingReal ? 'Starting…' : 'Start real game'}
          </button>
        </> : <>
          <p className="mission-message" role="status">{message}</p>
          {onClues && <button className="button button-quiet" onClick={onClues}>Show Defuser clues</button>}
        </>}
      </div>
    </section>
  );
}

function ClockReadout({ remaining, showFractions, roundUp, label = 'Time remaining' }) {
  const fraction = String(Math.floor(remaining % 1000 / 10)).padStart(2, '0');
  return (
    <div className="mission-clock">
      <span id="clock-label">{label}</span>
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
      <h2 id="code-title" className="module-title">Keypad</h2>
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

function WireModule({ round, device, phase, level, practice, onWire, controlsBlocked, onRestart, onManual }) {
  const canPull = phase === 'playing';
  const reconnect = phase === 'ready';
  const disconnected = round?.pulled.filter(Boolean).length || 0;
  return (
    <section className="puzzle wire-module" aria-labelledby="wire-title">
      <div className="wire-heading">
        <h2 id="wire-title" className="module-title">Wires</h2>
        {!practice && (canPull || phase === 'lost') && <MissionFacts level={level} strikes={round?.wrong || 0} />}
      </div>
      {reconnect && <p className="module-hint">Reconnect every wire before starting the next level.</p>}
      <div className="wire-summary">{disconnected} / {COLORS.length} disconnected</div>
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
        {!practice && <button className="button button-quiet" onClick={onRestart} disabled={controlsBlocked}>Restart</button>}
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
          <span className="morse-position" aria-hidden="true">{index + 1}</span>
          <span className="sr-only">Group {index + 1}. {[...group].map(mark => mark === '.' ? 'dot' : 'dash').join(' ')}</span>
          <code aria-hidden="true">{group}</code>
        </li>;
      })}
    </ol>
    <p className="wire-clue-numbers">Wire cards <strong>{round.cards.map(cardNumber).join(', ')}</strong></p>
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

function Leaderboard({ ranked, currentId, storageError, loading, active, onPlay }) {
  return (
    <section className="leaderboard" aria-label="Saved scores">
      <div className="leaderboard-heading">
        <p>Most time remaining ranks first. Fewer incorrect codes break ties.</p>
        {!active && <button className="button button-primary" onClick={onPlay}>Connect Players</button>}
      </div>
      {storageError && <p className="notice" role="status">The score database could not be reached. Showing the last available scores.</p>}
      <div className="rankings-layout">
        <section className="podium-panel" aria-labelledby="podium-title">
          <h2 id="podium-title">Top finishers</h2>
          {ranked.length === 0 && !storageError && <p className="rankings-note" role="status">{loading ? 'Loading scores…' : 'Clear all three levels to earn a podium spot.'}</p>}
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
      <p className="local-note">Scores are saved on the host laptop.</p>
      <LegacyScores />
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
