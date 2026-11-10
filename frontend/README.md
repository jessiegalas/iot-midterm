# Dont Stop Talking / React + Vite prototype

A browser simulation of the repository's ESP32 game. The Arduino sketch is unchanged.

## Run

Requires Node.js 20.19+ or 22.12+ (validated on Node 24).

```sh
cd /workspace/iot-midterm/frontend
npm ci --cache /workspace/.npm-cache
npm run dev
```

Vite listens on port 5173. The cache argument keeps npm's writes in the workspace in this cloud environment; it is optional on your own computer.

```sh
npm test       # eight game/leaderboard tests
npm run build # production assets in dist/
npm run preview
```

## Play

1. Select **Start simulation**, enter a team name and both player names, then arm the device. The timer starts immediately.
2. The Defuser reads the four Morse groups and riddle card IDs. The Expert consults **Expert manual** on another screen and communicates the answers. The manual is static and can be opened independently; live games do not sync across devices. Both roles share this local prototype interface, so role separation is by agreement.
3. Enter the four-digit code using the keypad or number keys. Submit with the arrow button, `#`, or Enter; clear with the reset button, `*`, or Backspace. Leading zeros count.
4. Pull only the wire colors matched by the riddle cards. Each level requires both the code and its wires, in either order. A wrong wire, three wrong codes within a level, or an expired timer ends the run.
5. Reconnect every pulled wire between levels and select **Start level**. The shared four-minute timer pauses between levels. Levels require one, two, and three correct wires respectively.
6. Clear all three levels to save a score. Rankings favor more time remaining, then fewer incorrect code submissions across the run. Filters cover all time, the past 7 days, or the past 24 hours.

Sound is optional and muted initially. Responsive layouts, keyboard controls, native modal focus handling, and reduced-motion preferences are supported. Fonts are bundled locally.

## Prototype limits

- Scores use localStorage under `defuse.scores.v1`, capped at the best 100 successful runs. There are no seeded scores. Failed games are not ranked. Storage failures leave scores available for the current session only.
- These are browser-specific, editable simulation scores, without authentication or server verification. A shared competition leaderboard needs a backend and authoritative game results.
- No ESP32 connection, serial upload, Wi-Fi transport, servo actuation, or physical hardware validation is included. The original firmware does not yet expose a frontend protocol.
- The six riddle texts are new sample content. Their card-to-color mappings match the sketch. The sketch's bottom wiring notes list six wires, but the actual code uses RED/BLACK/BLUE on GPIO 5/18/19, plus servo GPIO 23.

The frontend has no required environment variables or external services.
