# DEFUSE / React + Vite prototype

A browser front end for the repository's ESP32 game. It works two ways: a standalone **browser simulation**, or a live mirror and keypad for the **real ESP32** over USB (see [Play on the ESP32](#play-on-the-esp32)).

## Run

Requires Node.js 20.19+ or 22.12+ (validated on Node 24).

```sh
cd /workspace/iot-midterm/frontend
npm ci --cache /workspace/.npm-cache
npm run dev
```

Vite listens on port 5173. The cache argument keeps npm's writes in the workspace in this cloud environment; it is optional on your own computer.

```sh
npm test       # game, leaderboard and device-protocol tests
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

## Play on the ESP32

The sketch (`bomb_defusal_final/bomb_defusal_final.ino`) now prints machine-readable `@` lines over USB serial and accepts a few commands; the game rules and the OLED/keypad/buzzer/servo behaviour are unchanged. The device stays in charge: the page shows the board's state live, and the on-screen keypad and Start button act as extra inputs.

1. Upload the updated sketch from the Arduino IDE (115200 baud). Then **close the Serial Monitor**, because only one program can hold the port.
2. Run the page on **http://localhost** (`npm run dev`, then open `http://localhost:5173`) in **Chrome or Edge on a desktop**. Web Serial does not work in Firefox or Safari, on phones, or on a plain `http://<lan-ip>` address. The page can still be opened that way for simulation mode.
3. Click **Connect device** and choose the ESP32's port (often "USB Serial", CP210x or CH340). The header changes to **ESP32 LINKED**.
4. **Start game** enters the team names and tells the board to arm (the same as pressing D on the keypad). Seat every wire, then press A on the keypad or **Start level** on the page. Typing the code on the keypad, the on-screen keypad and the number keys all reach the board.
5. The wire module mirrors the physical wires and is read-only in this mode: pull real wires. The timer and strikes come from the board. A win is scored from the board's remaining time and saved to the leaderboard.

Unplugging mid-game abandons that run. Finished results stay visible, and the page falls back to simulation mode. A page opened or refreshed mid-game catches up from the board (`SYNC`).

Protocol, one line each, ends with a newline. Device to page: `@HELLO,1`, `@IDLE`, `@READY,level,missingWireMask,secs`, `@LEVEL,level,code,reqWireMask,cards,secs`, `@ENTRY,digits`, `@CODE,OK|BAD,wrong`, `@WIRE,index,OK|BAD`, `@CLEAR,level`, `@TIME,secs`, `@PROGRESS,entry,solved,wrong,pulledMask`, `@WON,secs`, `@LOST,CODE|WIRE|TIME`. Page to device: `SYNC`, `START`, `RESET`, `ARM`, `KEY,x`. Anything not starting with `@` (the sketch's debug text) is ignored. Wire index 0/1/2 is RED/BLACK/BLUE.

Troubleshooting: "board did not answer" means the old sketch is still on the board, the Serial Monitor is open, or the wrong port was chosen. If the board reboots when connecting, that is normal (the page retries `SYNC` for about six seconds).

## Prototype limits

- Scores use localStorage under `defuse.scores.v1`, capped at the best 100 successful runs. There are no seeded scores. Failed games are not ranked. Storage failures leave scores available for the current session only.
- These are browser-specific, editable simulation scores, without authentication or server verification. A shared competition leaderboard needs a backend and authoritative game results.
- Hardware mode uses USB serial only (no Wi-Fi) and needs a Chromium desktop browser. The protocol was verified by compiling the unchanged sketch on a computer against Arduino stand-ins and driving it from the real page. It has not yet been run on a physical ESP32.
- Anyone with the page can send `START`/`RESET`/`KEY` to a connected board, which is intended for a classroom demo but offers no security.
- The six riddle texts are new sample content. Their card-to-color mappings match the sketch. The sketch's wiring notes now match the code: RED/BLACK/BLUE on GPIO 5/18/19, plus servo GPIO 23.

The frontend has no required environment variables or external services.
