# DEFUSE

The ESP32 owns the hardware game and its countdown. A Node.js bridge serves the React console on the laptop and connects to the board over local Wi-Fi or USB. The separate browser simulation still uses one, two, and three wires across its three levels.

## Run the laptop console

From the `frontend` folder on Windows, with Node.js 24 installed:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd start
```

Open [the laptop console](http://localhost:5173) and choose **Connect Players**. Select **Use ESP32** in Mission Control first when playing with the board. The live console stays on the laptop. For simulation development, run `npm.cmd run dev` while the bridge is stopped and use manual player entry.

## Connect players

1. Open **Connect Players** on the laptop. Connect both phones to the same local network and scan the QR code for each role. If the laptop has multiple network adapters, use the lobby’s network selector to choose the one the phones can reach.
2. Each phone asks for a player name and confirms the assigned role. Each name replaces its QR code on the laptop as soon as the player joins. If scanning is unavailable, open **Manual entry** and save either or both names from the laptop.
3. Select **Start Game** after both names appear. The leaderboard uses the two names together as the team name.

Phone onboarding uses TCP port 5174 on the laptop’s local network. Allow that port on the private network if Windows Firewall blocks the join pages. Some guest networks block connections between devices. Manual entry works without phone connectivity.

## Pair the board and set up USB backup

1. Find the ESP32's COM port in Device Manager or Arduino IDE. Connect the cable before starting the bridge and close Arduino Serial Monitor so the bridge can keep the port open.
2. Copy `server/bridge.example.json` to `server/bridge.local.json`. Set `serialPort` to the COM port. For USB-only operation, remove the entire `wifi` object.
3. For Wi-Fi, generate a pairing key locally with `node -p "require('node:crypto').randomBytes(32).toString('hex')"`. Put it in `wifi.key`, and copy `bomb_defusal_final/bridge_local.example.h` to `bomb_defusal_final/bridge_local.h`. Enter the same key and identity in the header, plus the 2.4 GHz Wi-Fi credentials and the laptop's local IPv4 address. Both local configuration files are ignored by Git. Replace the previously embedded Wi-Fi password if it is still in use.
4. Put the laptop and ESP32 on the same LAN. Use a stable address for the laptop and allow inbound TCP 8443 for Node.js on your private network. The optional `wifi.bind` setting limits the listener to a specific local address. The board initiates the authenticated TLS connection. The browser uses loopback port 5173.
5. In Arduino IDE, open `bomb_defusal_final/bomb_defusal_final.ino`. Use **esp32 by Espressif Systems 4.0.0**, select **ESP32 Dev Module** for the standard ESP32 DevKit, and install the **Keypad**, **Adafruit GFX Library**, and **Adafruit SSD1306** libraries. Flash over USB while the bridge is stopped. Older firmware is incompatible with the current bridge.
6. Start the bridge and check for **USB READY** in the console before play. A healthy Wi-Fi connection is preferred before a run. A dead link switches to a ready cable after three missed heartbeats or a disconnect. A recovered Wi-Fi link waits for the current USB run to finish. A WAN outage with working local Wi-Fi leaves the active link in place.

The countdown continues on the ESP32 during connection loss. If both links drop, keep playing with the device controls. If a command was in flight, the bridge checks the recovered snapshot for confirmation and never replays the input. If the board lost power or rebooted, the previous run cannot be recovered.

## Play

Connect or enter both player names. In hardware mode, seat all five wires and arm with the on-screen button or physical **A** key. The Defuser relays Morse clues and card numbers, and the Expert uses the manual. The hardware picks one to five distinct wires each level. The countdown is shared across all three levels and pauses while the wires are reseated. A successful run is saved to the laptop browser's existing local leaderboard.

The Expert can open the console's **Expert manual** on the laptop or use the printable references below on another screen. The live bridge does not require internet access.

### Morse reference

Read one group per digit from left to right. Preserve leading zeros.

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

## Check failover on the actual setup

With the board powered and USB ready, start a run over Wi-Fi and enter part of a code. Cut WAN access while leaving the LAN up and confirm the Wi-Fi link stays active. Then disconnect the board's local Wi-Fi while leaving USB connected. Within four seconds, confirm the console shows USB, the same code entry, and the board's current time. Repeat at the ready and result screens, and confirm the leaderboard saves a win only once. Test startup with USB alone, loss of both links, and a board reboot separately.

The board sends protocol 2 frames over USB at 115200 baud and directly over TLS on Wi-Fi. The bridge uses `SYNC` and `PING` to check links, `TAKE` to select the command transport, and `CMD` with a per-command ID. The board replies with `@HELLO`, `@TAKEN`, `@ACK`, and revisioned `@STATE` snapshots. The console consumes `GET /api/events` and sends commands through `POST /api/commands`.
