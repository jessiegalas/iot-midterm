# Decidefer verification

## Decidefer v1 verification

| Check | Result |
|---|---|
| Unchanged baseline | 43 JavaScript tests passed before changes. |
| Final software | 46 JavaScript tests passed with localhost access. The cases cover score math, hint retries, pagination, archived scores, ESP32 recovery, and the 15-card deck. The production frontend build passed. |
| Browser | Completed the rehearsal and two three-level runs. Verified scoring with both hint tiers and one wrong code. A wrong-wire loss, a three-code loss, a live timeout, an abort, and a reload each appeared on the leaderboard. Reviewed the cards, result panel, and leaderboard at laptop widths. |
| Firmware | The host harness verified the fixed deck, eight correct decisions in a clean run, buzzer cues and reset, and the Decidefer title and tagline on the simulated 128×64 OLED. The ESP32 Dev Module compiled for USB and for Wi-Fi with placeholder settings. The Wi-Fi build used 84% of flash and 16% of global RAM. |

Physical audio, OLED, and wire behavior still require a board. First-time student timing remains a playtest target.

## Classroom build at 7a9c0a8

| Check | Baseline at 66bb7d0 | Final result |
|---|---|---|
| Automated JavaScript tests | 41 passed with localhost access. | 43 passed, including the new rehearsal and card-answer checks. HTTP, TLS, simulated failover, and scoring tests still passed. |
| Production browser build and gameplay | Build, three-level win, timer pause, score persistence, and all loss paths passed. Timed levels used 1, 2, then 3 cards. | Build and browser play passed. Tested both puzzle orders, 1–2–2 pacing, numbered Morse groups, reseating, timer pause, all loss paths, and reload after a saved win. |
| Test run and registration | Both phone role joins and refresh passed. The original Expert phone page also showed a manual. | The phones collect and confirm names. On the laptop, the prompt appears after both players join. The untimed test accepts retries, saves no score, and carries the same pair into the real game. |
| Firmware host run | Reproduced input accepted at timeout, submissions after a solved code, and countdown drift after a late loop. Verified the existing reseating interlock and loss paths. | All 31 checks passed, including deadline handling, reseating, all result screens, and silent buzzer output. |
| ESP32 target build | ESP32 Dev Module compiled with Espressif core 4.0.0. Used 424,606 bytes of flash and 32,928 bytes of global RAM. | Compiled for the same target and core. Uses 414,696 bytes of flash (31%) and 32,716 bytes of global RAM (9%). Both checks were compile-only. |
| 128×64 OLED simulation | The active screen drew one pixel beyond the panel, the transition title wrapped, and the ready screen hid wire names when all were missing. | All rendered states fit. Checked every missing-wire combination and a five-card stress frame. Verified the 150 ms active redraw limit and level-clear animation without advancing the countdown. [Before and after OLED frames](verification/oled-comparison.png) |
| Printable manual | The attached v3 review copy had six pages, including a separate wire-key page. | Three pages in Microsoft Word. Both card pages include the wire key and the tag puzzles include spaces to tally their answers. |

## Prioritized findings

| Priority | Finding | Resolution |
|---|---|---|
| Critical | The earlier digital Card 10 had a contradiction and no valid answer. | The laptop and printable manuals use the v3 puzzles. Checked all ten against the firmware answer bank. |
| Critical | Firmware could accept a final input after expiry and continue accepting submissions after verifying the code. | Check the clock before processing inputs and lock the code after verification. The host tests cover both paths. |
| Moderate | Different card counts, dense instructions, and an implicit Morse reading order made first-time play harder. | Both timed modes use 1–2–2 pacing. Added one unscored rehearsal, a shorter round guide, indexed cards, and numbered Morse groups. |
| Minor | Long OLED text wrapped and some ready-screen wire names disappeared. | Added fixed rows, individual wire names, and consistent win, loss, and transition screens. |

The OLED comparison uses the host harness with the Adafruit bitmap font. It represents the sketch’s layout and update logic. Physical readability, input responsiveness, and the first-time student playtest are pending.

## Repeat the host checks

Run from the repository root with PowerShell 7, a Windows C++17 compiler, and the Adafruit GFX Library directory that contains `glcdfont.c`.

```powershell
./tests/firmware/run.ps1 -Compiler 'C:/path/to/g++.exe' -FontDirectory 'C:/path/to/Adafruit_GFX_Library' -OutputDirectory "$env:TEMP/defuse-host-test"
npm.cmd test --prefix frontend
npm.cmd run build --prefix frontend
```

## Physical hardware checklist

These checks require the physical ESP32 and two phones on the intended LAN. They remain pending.

| Test | Procedure | Expected result | Status |
|---|---|---|---|
| Full win with two phones | On the intended LAN, scan both role codes and complete a run with the physical ESP32. | Both phones confirm the registered names and roles, the laptop runs the mission, and one correctly named win is saved. | Pending physical verification |
| Loss and offline exit | Lose a run and disconnect the board after the console receives the result. | The loss is displayed, and **Return to leaderboard** works while offline. | Pending physical verification |
| Connection and restart recovery | Start with USB alone. Disconnect during a run, then reconnect to the same board. Repeat after restarting the bridge. Separately reboot the board during a run. | USB alone is usable. Same-boot recovery restores the roster and progress. A reboot leaves the prior result unconfirmed. | Pending physical verification |
| Wi-Fi to USB | Start over Wi-Fi with USB ready and part of a code entered. Disconnect internet while maintaining the LAN, then interrupt board Wi-Fi. Repeat at the ready and result screens. | Internet loss leaves the LAN working. USB takes over within four seconds with the same entry and current time. No input is replayed or score duplicated. | Pending physical verification |
| OLED, controls, and buzzer | Play on the board through ready, active, cleared, win, and all three loss states while watching the console. | Clues, timer, strikes, and outcomes agree. The keypad and wires respond during redraws. The buzzer plays countdown and result cues and returns to silence on reset. | Pending physical verification |
