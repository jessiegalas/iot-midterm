# DEFUSE

The ESP32 owns the hardware game and its countdown. A Node.js bridge serves the React console on the laptop and connects to the board over local Wi-Fi or USB. The hardware game and browser simulation both use one, two, and two wires across the three timed levels.

For a fresh PC and an existing ESP32, use the [Windows setup guide](../SETUP.md).

## Run the laptop console

From the `frontend` folder on Windows, with Node.js 24 installed:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the console URL printed in the terminal and choose **Connect Players**. Select **Use ESP32** in Mission Control to play with the board. The console stays on the laptop. Development mode builds the phone pages at startup. For a production run, use `npm.cmd run build` followed by `npm.cmd start`. Stop the server with Ctrl+C.

The console prefers port 5173 and the phone listener prefers 5174. If a port is occupied, the server prints the fallback address. Set `DEFUSE_CONSOLE_PORT` or `DEFUSE_JOIN_PORT` to require a specific port.

## Connect players

1. Open **Connect Players** on the laptop. Connect both phones to the same local network and scan the QR code for each role. If the laptop has multiple network adapters, use the lobby’s network selector to choose the one the phones can reach.
2. Each phone asks for a player name and confirms the assigned role. Each name replaces its QR code on the laptop. Use **Retry QR**, **Copy Join Link**, or **Manual entry** if scanning is unavailable.
3. After both names appear, choose **Start test run** or **Start real game**. The same pair continues after the test, and the leaderboard uses both names as the team name.

Allow the phone port shown in the terminal through Windows Firewall on the private network if needed. Both phones need to be on the laptop’s local network. Some guest networks isolate devices. Manual entry works without phone connectivity.

## Pair the board and set up USB backup

1. Find the ESP32's COM port in Device Manager or Arduino IDE. Connect the cable before starting the bridge and close Arduino Serial Monitor so the bridge can keep the port open.
2. Copy `server/bridge.example.json` to `server/bridge.local.json`. Set `serialPort` to the COM port. For USB-only operation, remove the entire `wifi` object.
3. For Wi-Fi, generate a pairing key locally with `node -p "require('node:crypto').randomBytes(32).toString('hex')"`. Put it in `wifi.key`, and copy `bomb_defusal_final/bridge_local.example.h` to `bomb_defusal_final/bridge_local.h`. Enter the same key and identity in the header, plus the 2.4 GHz Wi-Fi credentials and the laptop's local IPv4 address. Both local configuration files are ignored by Git. Replace the previously embedded Wi-Fi password if it is still in use.
4. Put the laptop and ESP32 on the same LAN. Use a stable address for the laptop and allow inbound TCP 8443 for Node.js on your private network. The optional `wifi.bind` setting limits the listener to a specific local address. The board initiates the authenticated TLS connection. The console stays on the printed loopback address.
5. In Arduino IDE, open `bomb_defusal_final/bomb_defusal_final.ino`. Use **esp32 by Espressif Systems 4.0.0**, select **ESP32 Dev Module** for the standard ESP32 DevKit, and install the **Keypad**, **Adafruit GFX Library**, and **Adafruit SSD1306** libraries. Flash over USB while the bridge is stopped. Older firmware is incompatible with the current bridge.
6. Start the bridge and check for **USB READY** in the console before play. A healthy Wi-Fi connection is preferred before a run. A dead link switches to a ready cable after three missed heartbeats or a disconnect. A recovered Wi-Fi link waits for the current USB run to finish. A WAN outage with working local Wi-Fi leaves the active link in place.

The countdown continues on the ESP32 during connection loss. If both links drop, keep playing with the device controls. If a command was in flight, the bridge checks the recovered snapshot for confirmation and never replays the input. If the board lost power or rebooted, the previous run cannot be recovered.

## Play

Connect or enter both player names. In hardware mode, seat all five wires and arm with the on-screen button or physical **A** key. The Defuser relays Morse clues and card numbers. The Expert decodes the four digits and solves one card per required wire. The tasks can be completed in either order. The countdown is shared across all three levels and pauses while the wires are reseated. Scores and confirmed hardware rosters are saved in `frontend/.data/defuse.sqlite`.

The leaderboard imports existing scores when opened at their old browser address. If the address changed, open **Transfer browser scores** at the original address to export JSON, then import it on the new console. If the original address still serves an older console without an export button, copy the result of `localStorage.getItem('defuse.scores.v1')` from that page's developer console into a JSON file and import the file.

The Expert can open the manual on the laptop or use the [printable Expert manual](../player%20manual/Player2_Manual_Expert_5wires.docx). Once both players join, choose **Start test run** for one untimed browser round or **Start real game** to go straight into the mission. A completed test takes the same pair into the real game and saves no score. The live bridge does not require internet access.

Starting a test run plays its own loop on the laptop. Use the speaker button to mute or re-enable it. Hot Roadway plays in the timed mission when sound is enabled, switches from 160 BPM to 175 BPM at 30 seconds remaining, and pauses between levels. The updated ESP32 firmware keeps the buzzer silent.

### Morse reference

Read groups 1 and 2 across the top OLED row, then groups 3 and 4 across the bottom row. Preserve leading zeros.

| Digit | Morse | Digit | Morse |
| --- | --- | --- | --- |
| 0 | `-----` | 5 | `.....` |
| 1 | `.----` | 6 | `-....` |
| 2 | `..---` | 7 | `--...` |
| 3 | `...--` | 8 | `---..` |
| 4 | `....-` | 9 | `----.` |

### ESP32 card reference

| Cards | Wire |
| --- | --- |
| 1, 2 | Red |
| 3, 4 | Black |
| 5, 6 | Blue |
| 7, 8 | White |
| 9, 10 | Purple |

## Verify physical hardware

Use the [physical verification checklist](../HARDWARE_VERIFICATION.md) with the ESP32 and two phones.

The board sends protocol 2 frames over USB at 115200 baud and directly over TLS on Wi-Fi. The bridge uses `SYNC` and `PING` to check links, `TAKE` to select the command transport, and `CMD` with a per-command ID. The board replies with `@HELLO`, `@TAKEN`, `@ACK`, and revisioned `@STATE` snapshots. The console consumes `GET /api/events` and sends commands through `POST /api/commands`.

Updated firmware also sends an optional `@MUSIC` timing frame before each playing snapshot. The bridge accepts it only when the boot, run, revision, and elapsed seconds match the active snapshot.
