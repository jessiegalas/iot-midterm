import React from 'react';
import { MORSE } from './game';
import { LOCKS, RIDDLE_CARDS } from './expert-manual';

export function Manual() {
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
