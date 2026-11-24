# DEFUSE Physical Hardware Verification

| Test | Procedure | Expected result | Status |
|---|---|---|---|
| Full win with two phones | On the intended LAN, scan both role codes and complete a run with the physical ESP32. | Both roles join, the Expert can open the manual, and one correctly named win is saved. | Pending physical verification |
| Loss and offline exit | Lose a run and disconnect the board after the console receives the result. | The loss is displayed, and **Return to leaderboard** works while offline. | Pending physical verification |
| Connection and restart recovery | Start with USB alone. Disconnect during a run, then reconnect to the same board. Repeat after restarting the bridge. Separately reboot the board during a run. | USB alone is usable. Same-boot recovery restores the roster and progress. A reboot leaves the prior result unconfirmed. | Pending physical verification |
| Wi-Fi to USB | Start over Wi-Fi with USB ready and part of a code entered. Disconnect internet while maintaining the LAN, then interrupt board Wi-Fi. Repeat at the ready and result screens. | Internet loss leaves the LAN working. USB takes over within four seconds with the same entry and current time. No input is replayed or score duplicated. | Pending physical verification |
