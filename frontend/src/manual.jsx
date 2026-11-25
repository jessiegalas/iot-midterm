import React from 'react';
import { COLORS, MORSE, WIRES_PER_LEVEL } from './game';
import { cardNumber, PRACTICE_CARD, RIDDLE_CARDS, tagStatement } from './expert-manual';

function WireKey() {
  return (
    <dl className="manual-wire-key" aria-label="Wire number to colour">
      {COLORS.map((colour, index) => (
        <div key={colour}><dt>{index + 1}</dt><dd>{colour}</dd></div>
      ))}
    </dl>
  );
}

function TagPuzzle({ card }) {
  return (
    <>
      <p className="tag-target"><strong>Exactly {card.trueCount} {card.trueCount === 1 ? 'tag is' : 'tags are'} true.</strong></p>
      <dl className="tag-statements">
        {card.tags.map(tag => <div key={tag.wire}><dt>{tag.wire}</dt><dd>{tagStatement(tag)}</dd></div>)}
      </dl>
      <fieldset className="tag-tally">
        <legend>True tags for each candidate</legend>
        {COLORS.map(colour => (
          <label key={colour}>{colour}<input type="number" min="0" max="5" inputMode="numeric" /></label>
        ))}
      </fieldset>
    </>
  );
}

export function Manual() {
  const cards = [...RIDDLE_CARDS, PRACTICE_CARD];
  return (
    <div className="manual">
      <section className="reference" aria-labelledby="roles-title">
        <h2 id="roles-title">During each level</h2>
        <ol className="help-steps">
          <li><strong>Code.</strong> The Defuser reads groups 1–4. Match each group in the chart, keep leading zeros, and read back all four digits.</li>
          <li><strong>Wires.</strong> The Defuser reads the card numbers. Solve one card at a time and confirm its wire colour together before pulling.</li>
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
        <WireKey />
        <nav className="card-index" aria-label="Find a wire card">
          {cards.map(card => {
            const number = cardNumber(card.id);
            return <a key={number} href={'#expert-card-' + number}
              aria-label={number === 'P' ? 'Go to test card P' : 'Go to card ' + number}
              onClick={event => {
                const target = document.getElementById(event.currentTarget.hash.slice(1));
                if (target) target.open = true;
              }}>{number}</a>;
          })}
        </nav>
        <p>For tag cards, assume each colour is correct in turn. Count its true tags and use the colour that matches the card’s count.</p>
        <div className="riddle-grid">
          {cards.map(card => {
            const number = cardNumber(card.id);
            return (
              <details key={number} id={'expert-card-' + number}>
                <summary>{number === 'P' ? 'Card P · Test run' : 'Card ' + number}</summary>
                {card.tags ? <TagPuzzle card={card} /> : <>
                  <p>{card.prompt}</p>
                  {card.hint && <p><strong>Hint.</strong> {card.hint}</p>}
                  <WireKey />
                </>}
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}
