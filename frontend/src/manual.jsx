import React, { useState } from 'react';
import { COLORS, MORSE, WIRES_PER_LEVEL } from './game';
import { cardNumber, HINT_COSTS, PRACTICE_CARD, RIDDLE_CARDS } from './expert-manual';

function WireKey() {
  return (
    <dl className="manual-wire-key" aria-label="Wire number to color">
      {COLORS.map((color, index) => (
        <div key={color}><dt>{index + 1}</dt><dd>{color}</dd></div>
      ))}
    </dl>
  );
}

function WireCandidates({ numbered }) {
  const [crossedOut, setCrossedOut] = useState([]);
  return (
    <fieldset className="wire-candidates">
      <legend>{numbered ? 'Wire numbers' : 'Possible wires'}</legend>
      {COLORS.map((color, index) => (
        <button key={color} type="button" aria-pressed={crossedOut.includes(color)}
          onClick={() => setCrossedOut(previous => previous.includes(color)
            ? previous.filter(item => item !== color) : [...previous, color])}>
          {numbered && <span>{index + 1}</span>}{color}
        </button>
      ))}
    </fieldset>
  );
}

function CardHints({ card, revealed, canReveal, onReveal }) {
  const [freeHints, setFreeHints] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const free = card.id === PRACTICE_CARD.id;
  const count = free ? freeHints : revealed.length;

  async function reveal() {
    if (free) {
      setFreeHints(count + 1);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onReveal(card.id, count + 1);
    } catch {
      setError('The hint could not open. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!canReveal && !free && !count) return null;

  return (
    <div className="card-hints">
      {(free ? card.hints.slice(0, count) : revealed.map(hint => hint.text)).map((text, index) => (
        <details key={index} open>
          <summary>Hint {index + 1}</summary>
          <p>{text}</p>
        </details>
      ))}
      {(free || canReveal) && count < card.hints.length && (
        <button className="button button-quiet" type="button" onClick={reveal} disabled={busy}>
          {busy ? 'Opening hint…' : 'Show hint ' + (count + 1) + (free ? ' · Free' : ' · −' + HINT_COSTS[count] + ' points')}
        </button>
      )}
      {error && <p role="status">{error}</p>}
    </div>
  );
}

export function Manual({ game, hints, onReveal }) {
  const cards = [...RIDDLE_CARDS, PRACTICE_CARD];
  const assigned = game.phase === 'playing' ? game.round.cards : [];
  return (
    <div className="manual">
      <section className="reference" aria-labelledby="roles-title">
        <h2 id="roles-title">During each level</h2>
        <ol className="help-steps">
          <li><strong>Code.</strong> The Defuser reads groups 1–4. Match each group in the chart, keep leading zeros, and read back all four digits.</li>
          <li><strong>Wires.</strong> The Defuser reads the card numbers. Solve one card at a time and tell the Defuser which color to pull.</li>
        </ol>
        <p>Do both tasks in either order. The Defuser sees the device. The Expert sees this manual.</p>
        <details className="session-details">
          <summary>Round and timer rules</summary>
          <ul className="help-steps">
            <li>Timed levels use {WIRES_PER_LEVEL.slice(0, -1).join(', ')}, then {WIRES_PER_LEVEL.at(-1)} cards. Reconnect every wire before starting the next level. The shared four-minute timer pauses while you reconnect.</li>
            <li>A wrong wire, a third incorrect code in one level, or timeout ends the game. An incomplete code uses no strike.</li>
            <li>On the ESP32, D opens setup, A starts a level once every wire is connected, # submits the code, and * clears the entry.</li>
          </ul>
        </details>
      </section>
      <section className="reference" aria-labelledby="morse-title">
        <h2 id="morse-title">Morse digits</h2>
        <p>Read groups 1–4 in order. On the OLED, read the top row (1, 2), then the bottom row (3, 4).</p>
        <dl className="morse-reference">
          {MORSE.map((morse, digit) => <div key={digit}><dt>{digit}</dt><dd><code aria-label={morse.split('').map(mark => mark === '.' ? 'dot' : 'dash').join(' ')}>{morse}</code></dd></div>)}
        </dl>
      </section>
      <section className="reference" aria-labelledby="riddles-title">
        <h2 id="riddles-title">Wire cards</h2>
        <nav className="card-index" aria-label="Find a wire card">
          {cards.map(card => {
            const number = cardNumber(card.id);
            const test = card.id === PRACTICE_CARD.id;
            return <a key={number} href={'#expert-card-' + number}
              aria-label={test ? 'Go to test card P' : 'Go to card ' + number}
              onClick={event => {
                const target = document.getElementById(event.currentTarget.hash.slice(1));
                if (target) target.open = true;
              }}>{test ? 'Test card P' : number}</a>;
          })}
        </nav>
        <div className="riddle-grid">
          {cards.map(card => {
            const number = cardNumber(card.id);
            return (
              <details key={number} id={'expert-card-' + number}>
                <summary>{number === 'P' ? 'Test card P' : 'Card ' + number}</summary>
                {card.clues ? <>
                  <p>All clues apply. Cross out colors until one is left. Tell the Defuser that color.</p>
                  <ul className="wire-clues">{card.clues.map(clue => <li key={clue}>{clue}</li>)}</ul>
                  <WireCandidates key={(game.id ?? 'practice') + ':' + game.level} numbered={card.kind === 'mixed'} />
                </> : <><p>{card.prompt}</p><WireKey /></>}
                <CardHints key={(game.id ?? 'practice') + ':' + game.level}
                  card={card} canReveal={assigned.includes(card.id)}
                  revealed={hints.filter(hint => hint.level === game.level && hint.card === card.id)}
                  onReveal={onReveal} />
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}
