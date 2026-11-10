import React, { useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDown, ArrowRight, AudioLines, BookOpen, Check, CheckCheck, ChevronRight, CircleHelp, CircuitBoard, Clock3, Cpu, Crosshair, ExternalLink, FileText, Gamepad2, Hash, Headphones, Layers3, LockKeyhole, Play, PlugZap, Radio, RotateCcw, Shield, ShieldCheck, Skull, Terminal, Trophy, Users, Volume2, VolumeX, X } from 'lucide-react';
import { MORSE, COLORS, DURATION, STORAGE_KEY, RIDDLES, initialGame, gameReducer, clock, loadScores, rankScores } from './game';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles.css';

function App() {
  const [tab, setTab] = useState('console');
  const [game, dispatch] = useReducer(gameReducer, undefined, initialGame);
  const [scores, setScores] = useState(() => loadScores(localStorage));
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [sound, setSound] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [players, setPlayers] = useState({ team: '', defuser: '', expert: '' });
  const audio = useRef(null);
  const prevSecond = useRef(null);
  const playing = game.phase === 'playing';
  const result = game.phase === 'won' || game.phase === 'lost';
  const active = playing || game.phase === 'ready';
  const ranked = rankScores(scores, filter);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => dispatch({ type: 'TICK', now: performance.now() }), 100);
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    function key(e) {
      if (tab !== 'console' || modal || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' && e.target.tagName === 'BUTTON' && !e.target.closest('.keypad')) return;
      const k = e.key === 'Enter' ? '#' : e.key === 'Backspace' || e.key === 'Escape' ? '*' : e.key;
      if (/^[0-9*#]$/.test(k) && playing) { e.preventDefault(); dispatch({ type: 'KEY', key: k }); }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [tab, modal, playing]);
  useEffect(() => {
    if (game.phase !== 'won') return;
    setScores(rows => {
      if (rows.some(r => r.id === game.id)) return rows;
      const next = rankScores([...rows, { id: game.id, team: game.team, defuser: game.defuser, expert: game.expert, remaining: game.remaining, attempts: game.attempts, date: Date.now() }]).slice(0,100);
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
  function start(e) { e.preventDefault(); dispatch({ type: 'START', players: Object.fromEntries(Object.entries(players).map(([k,v]) => [k,v.trim()])), now: performance.now(), id: crypto.randomUUID() }); setTab('console'); setModal(null); }
  function missionAction() {
    if (game.phase === 'idle') setModal('lobby');
    else if (game.phase === 'ready') dispatch({ type: 'NEXT', now: performance.now() });
    else if (result) { dispatch({type:'RESET'}); setModal('lobby'); }
    else setModal('reset');
  }
  const topTeams = rankScores(scores).slice(0,3);
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('console'); }} aria-label="Defuse mission control"><span className="brand-mark"><Crosshair size={24}/></span><span>DEFUSE<span className="brand-dot">.</span><small>COMMUNICATION IS SURVIVAL</small></span></a>
      <div className="nav-label">WORKSPACE <span>01</span></div>
      <nav aria-label="Main navigation">
        {[['console', CircuitBoard, 'Mission control'],['manual', BookOpen, 'Expert manual'],['leaderboard', Trophy, 'Leaderboard']].map(([id, Icon, label]) => <button key={id} className={`nav-item ${tab === id ? 'selected' : ''}`} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}><Icon size={19}/>{label}{tab === id && <span className="nav-dot"/>}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="simulation-note"><span className="tiny-icon"><Cpu size={19}/></span><strong>Hardware, meet browser.</strong><p>The ESP32 experience.<br/>No breadboard required.</p><span className="mini-tag">SIMULATION MODE</span></div><button className="help-link" onClick={() => setModal('help')}><CircleHelp size={17}/> How to play <ExternalLink size={13}/></button><div className="sidebar-footer"><span className="online-dot"/> SYSTEM OPERATIONAL <span>v0.1</span></div></div>
    </aside>
    <main className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={13}/><span>{tab === 'console' ? 'Mission control' : tab === 'manual' ? 'Expert manual' : 'Leaderboard'}</span></div><div className="topbar-right"><span className="local-label"><span className="online-dot"/> LOCAL SESSION</span><button className="icon-button" onClick={toggleSound} aria-label={sound ? 'Mute sound' : 'Enable sound'} title={sound ? 'Mute sound' : 'Enable sound'}>{sound ? <Volume2 size={18}/> : <VolumeX size={18}/>}</button><span className="avatar">OP</span></div></header>
      <div className="page-content">
        <section className="page-heading"><div><div className="eyebrow"><span/> {tab === 'console' ? 'TWO PLAYERS. ONE CHANCE.' : tab === 'manual' ? 'KNOWLEDGE IS YOUR TOOLKIT.' : 'THE BEST UNDER PRESSURE.'}</div><h1>{tab === 'console' ? 'Mission control' : tab === 'manual' ? 'Expert field manual' : 'The leaderboard'}<span className="heading-slash"> /</span></h1><p>{tab === 'console' ? 'Stay calm. Talk it through. Beat the clock.' : tab === 'manual' ? 'Listen to your Defuser. Find the answer. Keep them alive.' : 'Three levels. Four minutes. A place among the best.'}</p></div><div className="mode-badge"><span className="orange-dot"/><Gamepad2 size={15}/> Browser simulation</div></section>
        {active && tab !== 'console' && <button className="live-banner" onClick={() => setTab('console')}><Radio size={16}/> Mission {game.phase === 'ready' ? 'between levels' : 'in progress'} <strong>{clock(game.remaining)}</strong><span>Return to console <ArrowRight size={15}/></span></button>}
        {tab === 'console' && <>
          <div className="mission-bar"><div className="mission-id"><span className="mission-symbol"><Crosshair size={19}/></span><span><small>ACTIVE OPERATION</small><strong>THE DEFUSAL PROTOCOL</strong></span></div><div className="mission-meta"><span><Users size={15}/> {game.team || '2-player co-op'}</span><span><Layers3 size={15}/> 3 levels</span><span className="difficulty"><i/><i/><i/> STANDARD</span></div></div>
          <div className="dashboard-grid"><div className="console-main">
            <section className={`timer-card ${playing && game.remaining < 31000 ? 'critical' : ''} ${game.phase === 'won' ? 'won' : ''}`}>
              <div className="timer-top"><span><span className={`status-dot ${playing ? 'pulse' : ''}`}/>{playing ? 'DEVICE ARMED' : game.phase === 'ready' ? 'LEVEL CLEARED · TIMER PAUSED' : game.phase === 'won' ? 'DEVICE DEFUSED' : game.phase === 'lost' ? 'DEVICE DETONATED' : 'AWAITING ACTIVATION'}</span><span className="mono">SYS / 001</span></div>
              <div className="timer-display">{clock(game.remaining)}<span className="timer-decimal">.{String(Math.floor(game.remaining % 1000 / 10)).padStart(2,'0')}</span></div><div className="timer-subtitle"><Clock3 size={13}/> TIME REMAINING <span>04:00 TOTAL</span></div>
              <div className="timer-track"><span style={{ width: `${game.remaining / DURATION * 100}%` }}/></div>
              <div className="timer-bottom"><div className="level-pips">{[1,2,3].map(n => <div key={n} className={game.level > n || game.phase === 'won' || (game.phase === 'ready' && game.level === n) ? 'complete' : game.level === n ? 'current' : ''}><span>{game.level > n || game.phase === 'won' || (game.phase === 'ready' && game.level === n) ? <Check size={12}/> : `0${n}`}</span> LEVEL {n}</div>)}</div><span className="attempts">{[1,2,3].map(n => <i key={n} className={n <= (game.round?.wrong || 0) ? 'used' : ''}/>)}<span>{game.round?.wrong || 0}/3 STRIKES</span></span></div>
            </section>
            <div className={`action-strip ${game.phase === 'ready' ? 'ready-strip' : ''}`}><div><span className="action-status"><span className="online-dot"/>{game.phase === 'idle' ? 'READY WHEN YOU ARE' : game.phase === 'ready' ? 'LEVEL COMPLETE' : result ? 'MISSION FINISHED' : 'KEEP TALKING'}</span><p aria-live="polite">{game.message || (game.phase === 'idle' ? 'Your Expert has the manual. You have the device.' : 'Describe the clues. Your Expert has the answers.')}</p></div><button className={`button ${playing ? 'button-outline' : 'button-primary'}`} onClick={missionAction} disabled={game.phase === 'ready' && game.round.pulled.some(Boolean)}>{playing ? <RotateCcw size={15}/> : <Play size={15} fill="currentColor"/>}{playing ? 'Restart' : game.phase === 'ready' ? `Start level ${game.level + 1}` : result ? 'Play again' : 'Start simulation'}{!playing && <ArrowRight size={16}/>}</button></div>
            <div className="modules-grid">
              <section className="panel code-panel"><PanelTitle icon={Hash} title="Access code" number="01"/><div className="module-description">Relay the signal. Enter the four-digit code.</div><div className="morse-display">{[0,1,2,3].map(i => <div key={i}><span>{game.round ? MORSE[Number(game.round.code[i])] : '·· − ··'}</span><small>DIGIT 0{i+1}</small></div>)}</div><div className={`code-entry ${game.round?.solved ? 'accepted' : ''}`} aria-label="Entered code"><LockKeyhole size={14}/>{game.round?.solved ? <span className="verified"><CheckCheck size={16}/> CODE VERIFIED</span> : <div>{[0,1,2,3].map(i => <span key={i}>{game.round?.entry[i] || <i/>}</span>)}</div>}<span className="entry-tag">4 DIGITS</span></div><div className="keypad">{['1','2','3','4','5','6','7','8','9','*','0','#'].map(k => <button key={k} className={k === '#' ? 'submit-key' : ''} disabled={!playing || game.round?.solved} onClick={() => dispatch({type:'KEY',key:k})} aria-label={k === '*' ? 'Clear code' : k === '#' ? 'Submit code' : `Digit ${k}`}>{k === '*' ? <RotateCcw size={14}/> : k === '#' ? <ArrowRight size={19}/> : k}<small>{k === '*' ? 'CLEAR' : k === '#' ? 'ENTER' : ''}</small></button>)}</div><div className="module-footer"><Terminal size={12}/> Keyboard supported <span>* clear · # submit</span></div></section>
              <section className="panel wire-panel"><PanelTitle icon={PlugZap} title="Wire module" number="02"/><div className="module-description">Find the right wire. Leave the rest connected.</div><div className="riddle-label"><FileText size={12}/> RIDDLE CARDS <span>{game.round?.cards.length || 1} REQUIRED</span></div><div className="riddle-cards">{(game.round?.cards || ['?']).map(c => <div key={c}><span>FIELD NOTE</span><strong>{typeof c === 'number' ? String(c).padStart(2,'0') : '—'}</strong><span>CARD ID <ArrowDown size={10}/></span></div>)}<p>Ask your Expert<br/>to decode {game.round?.cards.length > 1 ? 'these cards.' : 'this card.'}</p></div><div className="wire-bank">{COLORS.map((c,i) => { const pulled = game.round?.pulled[i]; return <button key={c} className={`wire-row wire-${c.toLowerCase()} ${pulled ? 'disconnected' : ''}`} disabled={!(playing && !pulled || game.phase === 'ready' && pulled)} aria-label={`${game.phase === 'ready' && pulled ? 'Reconnect' : 'Pull'} ${c.toLowerCase()} wire`} onClick={() => dispatch({ type: game.phase === 'ready' ? 'RECONNECT' : 'WIRE', index: i })}><span className="wire-port"/><span className="wire-cable"><i/><b/></span><span className="wire-end"/><span className="wire-name">{c}<small>{pulled ? game.phase === 'ready' ? 'RECONNECT ↗' : 'PULLED' : 'CONNECTED'}</small></span></button>; })}</div><div className="wire-warning"><Shield size={14}/><span>One wrong wire ends the mission.</span></div><div className="module-footer"><Activity size={12}/>{game.phase === 'ready' ? 'Click pulled wires to reconnect' : 'Click a wire to disconnect it'}<span>{game.round?.pulled.filter(Boolean).length || 0}/3</span></div></section>
            </div>

          </div><aside className="console-aside">
            <section className="panel briefing-panel"><PanelTitle icon={Radio} title="Mission briefing"/><div className="briefing-art"><Crosshair size={72} strokeWidth={.7}/><span className="orbit orbit-one"/><span className="orbit orbit-two"/><span className="art-coordinate">35° 40′ N</span><span className="art-label">COMM LINK ESTABLISHED</span><i/></div><h3>Two roles.<br/>One shared objective.</h3><p>You can see the device. Your Expert can see the manual. Communication is your only tool.</p><div className="role-row"><span className="role-icon orange"><Gamepad2 size={17}/></span><div><strong>{game.defuser || 'The Defuser'}</strong><small>Operates the device</small></div><span className="role-pill">YOU</span></div><div className="role-row"><span className="role-icon teal"><Headphones size={17}/></span><div><strong>{game.expert || 'The Expert'}</strong><small>Deciphers the manual</small></div><BookOpen size={14}/></div><button className="text-button" onClick={() => setTab('manual')}>Open expert manual <ArrowRight size={15}/></button></section>
            <section className="panel activity-panel"><PanelTitle icon={Activity} title="Activity log"/><div className="log-list" aria-live="polite">{game.log.length ? game.log.slice(0,4).map((l,i) => <div className={`log-row ${l.tone}`} key={`${l.text}-${i}`}><span className="log-dot"/><p>{l.text}</p><time>{clock(l.at)}</time></div>) : <><div className="log-row success"><span className="log-dot"/><p>Simulation environment ready.</p><time>SYS</time></div><div className="log-row"><span className="log-dot"/><p>Waiting for team activation.</p><time>SYS</time></div></>}</div></section>
            <section className="leaderboard-teaser"><div><Trophy size={16}/><strong>Leave your mark.</strong></div><p>{topTeams.length ? `${topTeams[0].team} leads with ${clock(topTeams[0].remaining)} to spare. Can you beat it?` : 'The board is clear. Be the first team to beat all three levels.'}</p><button onClick={() => setTab('leaderboard')}>View leaderboard <ArrowRight size={14}/></button></section>
          </aside></div>
        </>}
        {tab === 'manual' && <Manual/>}
        {tab === 'leaderboard' && <><div className="stats-grid"><Stat icon={Users} label="SUCCESSFUL MISSIONS" value={String(scores.length).padStart(2,'0')}/><Stat icon={Clock3} label="BEST TIME REMAINING" value={scores.length ? clock(rankScores(scores)[0].remaining) : '—'}/><Stat icon={ShieldCheck} label="RANKED DIFFICULTY" value="Standard"/></div><section className="panel rankings"><div className="rankings-heading"><div><h2>Mission hall of fame <span className="mini-tag">SIMULATION</span></h2><p>Fastest defusals first. Fewer incorrect codes break a tie.</p></div><div className="filter-group" aria-label="Leaderboard time period">{[['all','All time'],['week','7 days'],['day','24 hours']].map(([v,l]) => <button key={v} className={filter === v ? 'active' : ''} onClick={() => setFilter(v)}>{l}</button>)}</div></div>{storageError && <p className="storage-warning">Browser storage is unavailable. This session’s results will disappear after reload.</p>}<div className="table-scroll"><table><thead><tr><th>RANK</th><th>TEAM / OPERATORS</th><th>TIME LEFT</th><th>ERRORS</th><th>COMPLETED</th></tr></thead><tbody>{ranked.map((s,i) => <tr key={s.id} className={s.id === game.id ? 'your-score' : ''}><td><span className={`rank rank-${i}`} >{i === 0 ? <Trophy size={17}/> : String(i + 1).padStart(2,'0')}</span></td><td><strong>{s.team} {s.id === game.id && <span className="mini-tag">YOU</span>}</strong><small>{s.defuser} + {s.expert}</small></td><td className="score-time">{clock(s.remaining)}</td><td>{s.attempts}</td><td>{new Date(s.date).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'})}</td></tr>)}</tbody></table></div>{!ranked.length && <div className="empty-state"><span><Trophy size={32} strokeWidth={1.2}/></span><h3>{scores.length ? 'A new window. A clean slate.' : 'Every legend starts at zero.'}</h3><p>{scores.length ? 'No completed missions in this period. Your next run could change that.' : 'Clear all three levels to earn your place on the board.'}</p><button className="button button-primary" onClick={() => { setTab('console'); if (!active) setModal('lobby'); }}>{active ? 'Return to mission' : 'Begin a mission'}<ArrowRight size={16}/></button></div>}<div className="rankings-footer"><LockKeyhole size={13}/> Saved on this browser · Top 100 completed runs · Prototype scores are unverified</div></section></>}
        <footer className="page-footer"><span><Crosshair size={12}/> DEFUSE PROTOCOL <span className="footer-divider">/</span> BUILT FOR TWO</span><span>ESP32 INSPIRED <span className="footer-divider">·</span> HUMAN POWERED</span></footer>
      </div>
    </main>
    {result && tab === 'console' && <div className="result-banner" role="status"><span className={game.phase === 'won' ? 'result-success' : 'result-danger'}>{game.phase === 'won' ? <ShieldCheck size={25}/> : <Skull size={25}/>}</span><div><strong>{game.phase === 'won' ? 'Mission accomplished.' : 'Signal lost. Mission failed.'}</strong><p>{game.phase === 'won' ? `${clock(game.remaining)} remaining · ${game.attempts} incorrect codes · ${storageError ? 'Score kept for this session' : 'Score saved to leaderboard'}` : game.message}</p></div><button className="text-button" onClick={() => game.phase === 'won' ? setTab('leaderboard') : missionAction()}>{game.phase === 'won' ? 'See ranking' : 'Try again'}<ArrowRight size={15}/></button></div>}
    {modal && <Dialog title={modal === 'lobby' ? 'Assemble your team.' : modal === 'reset' ? 'Restart the mission?' : 'The protocol is simple.'} onClose={() => setModal(null)}>
      {modal === 'lobby' ? <form onSubmit={start}><p className="dialog-intro">One device, two perspectives. Choose your call signs and brief your Expert before you begin.</p><label>TEAM NAME<input autoFocus required maxLength={32} value={players.team} onChange={e => setPlayers({...players,team:e.target.value})} placeholder="e.g. Circuit Breakers" pattern=".*\S.*"/></label><div className="form-grid"><label>DEFUSER<input required maxLength={24} value={players.defuser} onChange={e => setPlayers({...players,defuser:e.target.value})} placeholder="Your call sign" pattern=".*\S.*"/></label><label>EXPERT<input required maxLength={24} value={players.expert} onChange={e => setPlayers({...players,expert:e.target.value})} placeholder="Partner’s call sign" pattern=".*\S.*"/></label></div><div className="lobby-summary"><span><Clock3 size={16}/> 4 minutes</span><span><Layers3 size={16}/> 3 levels</span><span><Users size={16}/> 2 players</span></div><p className="dialog-note">Have your Expert open the manual on another screen. This local prototype does not sync between devices. The clock starts immediately.</p><button className="button button-primary full" type="submit">Arm simulation <ArrowRight size={17}/></button></form> : modal === 'reset' ? <><p className="dialog-intro">This run will be discarded. Completed leaderboard scores will stay saved.</p><div className="dialog-actions"><button className="button button-outline" onClick={() => setModal(null)}>Keep playing</button><button className="button button-primary" onClick={() => {dispatch({type:'RESET'}); setModal('lobby');}}>Restart <RotateCcw size={16}/></button></div></> : <><ol className="help-steps"><li><strong>Share the clues.</strong> The Defuser describes the four Morse groups and numbered riddle cards.</li><li><strong>Decode together.</strong> The Expert uses the manual to translate the code and identify the correct wires.</li><li><strong>Defuse the device.</strong> Enter four digits and submit. Pull only the wires matched by your cards.</li><li><strong>Make it through three levels.</strong> Reconnect wires between levels. The shared timer pauses during this step.</li></ol><div className="wire-warning"><Shield size={17}/> A wrong wire, three wrong codes in a level, or an empty timer ends the mission.</div><button className="button button-primary full" onClick={() => setModal(null)}>Understood <Check size={16}/></button></>}
    </Dialog>}
  </div>;
}
function PanelTitle({icon:Icon, title, number}) { return <div className="panel-title"><span><Icon size={16}/><h2>{title}</h2></span>{number ? <span className="panel-number">MODULE / {number}</span> : <span className="panel-ellipsis">···</span>}</div>; }
function Stat({icon:Icon,label,value}) {return <div className="panel stat"><span><Icon size={19}/></span><div><small>{label}</small><strong>{value}</strong></div></div>;}
function Manual() { return <div className="manual-layout"><div><section className="panel manual-intro"><div className="eyebrow">FIELD MANUAL / REV. 01</div><h2>Keep talking.<br/>That’s how you make it out.</h2><p>The Defuser should describe what they see without looking at this manual. Translate each signal, then tell them what to do.</p><div className="manual-pills"><span><Clock3 size={14}/> 4-minute shared timer</span><span><Layers3 size={14}/> 1 → 2 → 3 wires per level</span></div></section><section className="panel manual-section"><PanelTitle icon={AudioLines} title="01 / Morse decoder"/><p>Read each five-symbol group from left to right. Each group represents one digit. Preserve leading zeros.</p><div className="morse-table">{MORSE.map((m,i) => <div key={m}><strong>{i}</strong><span>{m}</span></div>)}</div><div className="manual-example"><span>EXAMPLE</span><code>.---- &nbsp; ..--- &nbsp; ...-- &nbsp; ....-</code><ArrowRight size={16}/><strong>1234</strong></div></section><section className="panel manual-section"><PanelTitle icon={FileText} title="02 / Wire riddles"/><p>Ask for the card IDs on the device. Read each matching riddle and tell the Defuser which color to pull. The order does not matter.</p><div className="riddle-grid">{RIDDLES.map(r => <article key={r.id}><span className="riddle-id">CARD {String(r.id).padStart(2,'0')}</span><p>“{r.text}”</p><span className={`answer answer-${r.color.toLowerCase()}`}><span/> {r.color} WIRE</span></article>)}</div><div className="manual-footnote">Prototype riddle text · Color mappings match the ESP32 sketch.</div></section></div><aside><section className="panel manual-rules"><span className="role-icon orange"><Shield size={22}/></span><h3>Rules of engagement</h3><p><strong>Level 1</strong><br/>Decode the code. Pull 1 correct wire.</p><p><strong>Level 2</strong><br/>Decode a new code. Pull 2 correct wires.</p><p><strong>Level 3</strong><br/>Decode the final code. Pull all 3 wires.</p><div className="rule-divider"/><p><strong>Three strikes per level.</strong><br/>Incorrect codes use a strike. The third ends the game. Incomplete entries use none.</p><p><strong>One wrong wire.</strong><br/>No second chances. Confirm the card before pulling.</p><p><strong>Between levels.</strong><br/>Reconnect every pulled wire, then start the next level. The clock is paused.</p><span className="mini-tag">EXPERT EYES ONLY</span></section></aside></div>; }
function Dialog({title,children,onClose}) {
  const ref = useRef(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => { const el=ref.current; el.showModal(); return () => el.close(); },[]);
  return <dialog ref={ref} className="dialog" onCancel={e => {e.preventDefault();close.current();}} onClick={e => {if(e.target === ref.current) close.current();}}><div className="dialog-content"><div className="dialog-heading"><span className="brand-mark"><Crosshair size={22}/></span><button className="icon-button" autoFocus onClick={onClose} aria-label="Close dialog"><X size={19}/></button></div><div className="eyebrow">DEFUSE / SIMULATION</div><h2>{title}</h2>{children}</div></dialog>;
}

createRoot(document.getElementById('root')).render(<App/>);
