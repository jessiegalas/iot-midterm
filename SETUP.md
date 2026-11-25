# DEFUSE setup on Windows with VS Code

Use **Wi-Fi with USB backup** if the PC and ESP32 can share a local network. Use **USB only** if Wi-Fi is unavailable or the network blocks devices from talking to each other. Both options use the USB cable to upload the firmware.

## 1. Install the tools and clone the project

1. Install [VS Code](https://code.visualstudio.com/download) and [Node.js 24](https://nodejs.org/download/release/latest-v24.x/). Choose the Windows `.msi` for your PC, usually `x64.msi`.
2. In VS Code, open **Terminal → New Terminal** and choose **PowerShell**. Run the lines for any tools you still need. [Git for Windows](https://git-scm.com/download/win) · [Arduino CLI installers](https://arduino.github.io/arduino-cli/latest/installation/)

   ```powershell
   winget install --id Git.Git --exact
   winget install --id ArduinoSA.CLI --exact
   ```

3. Close and reopen VS Code after installing the tools. In a new terminal, check `git --version`, `node --version`, and `arduino-cli version`. The Node version should begin with `v24.`
4. Press **Ctrl+Shift+P**, choose **Git: Clone**, and paste `https://github.com/jessiegalas/iot-midterm.git`. Pick a folder to save it in and select **Open** when the clone finishes. If prompted to sign in, use an account with access to the repo. [Cloning in VS Code](https://code.visualstudio.com/docs/sourcecontrol/repos-remotes#_clone-repositories)

## 2. Install project dependencies and find the board

Open **Terminal → New Terminal** in the cloned `iot-midterm` folder. Run these commands once. The ESP32 tools can take several minutes to download. [Espressif board package](https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html) · [Arduino CLI library manager](https://arduino.github.io/arduino-cli/latest/commands/arduino-cli_lib_install/)

```powershell
npm.cmd ci --prefix frontend
$esp32Index = 'https://espressif.github.io/arduino-esp32/package_esp32_index.json'
arduino-cli core update-index --additional-urls $esp32Index
arduino-cli core install esp32:esp32@4.0.0 --additional-urls $esp32Index
arduino-cli lib update-index
arduino-cli lib install Keypad "Adafruit GFX Library" "Adafruit SSD1306"
```

Plug the ESP32 into the PC with a **USB data cable** and run `arduino-cli board list`. Note the new `COM` port, such as `COM3`. It may appear as **Unknown**. If you see multiple ports, unplug the cable, run the command again, and look for the port that disappeared.

## 3. Choose one connection option

### Option 1 · Wi-Fi with USB backup

1. Connect the PC to the local network the ESP32 will use. The ESP32 needs access to a **2.4 GHz** Wi-Fi network. Leave the USB cable connected for backup.
2. Run `ipconfig` in the VS Code terminal and find the PC’s **IPv4 Address** under the active Wi-Fi or Ethernet adapter. Generate a pairing key in the same terminal.

   ```powershell
   node -p "require('node:crypto').randomBytes(32).toString('hex')"
   ```

3. In the VS Code Explorer, create `frontend/server/bridge.local.json` with the contents below. Replace `COM3` with your port and `PASTE_KEY_HERE` with the generated key.

   ```json
   {
     "serialPort": "COM3",
     "wifi": {
       "identity": "classroom-esp32",
       "key": "PASTE_KEY_HERE",
       "bind": "0.0.0.0"
     }
   }
   ```

4. Create `bomb_defusal_final/bridge_local.h` and fill in your network name, password, PC IPv4 address, and the **same pairing key**. Keep `classroom-esp32` in both files.

   ```cpp
   #define BRIDGE_WIFI_SSID "YOUR_WIFI_NAME"
   #define BRIDGE_WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
   #define BRIDGE_LAPTOP_IP "YOUR_PC_IPV4"
   #define BRIDGE_PSK_ID "classroom-esp32"
   #define BRIDGE_PSK_HEX "PASTE_KEY_HERE"
   ```

5. Save both files and continue to **Upload and launch**. The board connects to the PC on TCP **8443**. If Windows Firewall asks about Node.js, allow it on the private network. The two local config files are ignored by Git. Keep them on your PC.

### Option 2 · USB only

1. Create `frontend/server/bridge.local.json` in VS Code with the contents below. Replace `COM3` with your port.

   ```json
   {
     "serialPort": "COM3"
   }
   ```

2. If you previously set up Wi-Fi, replace the contents of `bomb_defusal_final/bridge_local.h` with the blank settings in `bomb_defusal_final/bridge_local.example.h`. On a fresh clone, you can skip creating the header. Leave the USB cable connected and continue below.

## 4. Upload and launch

1. Save your changes and close any Serial Monitor. If the game server is running, stop it with **Ctrl+C** so the upload can open the COM port.
2. Upload from the VS Code terminal. Replace `COM3` with your port. This command targets the project’s **ESP32 Dev Module**. [Arduino CLI compile and upload options](https://arduino.github.io/arduino-cli/latest/commands/arduino-cli_compile/)

   ```powershell
   arduino-cli compile --upload --fqbn esp32:esp32:esp32 --port COM3 .\bomb_defusal_final
   ```

3. Once the upload succeeds, build and start the game.

   ```powershell
   npm.cmd run build --prefix frontend
   npm.cmd start --prefix frontend
   ```

4. Open the **Console ready** URL printed in the terminal. In **Mission control**, look for **Wi-Fi connected / USB ready** for Option 1 or **USB connected** for Option 2. Select **Use ESP32**. The laptop speaker button controls the soundtrack. The updated ESP32 firmware keeps the buzzer silent.

For your next session, plug in the board, open the project in VS Code, and run `npm.cmd start --prefix frontend`. Rebuild after web changes. Re-upload after firmware changes or updates to `bridge_local.h`.

## 5. Play a round

Choose **Start game** and scan one QR code per role. Each phone collects a player name and confirms the assigned role. If the phones cannot reach the PC, enter both names under **Manual entry**. Once both names appear on the laptop, choose **Start test run** for an untimed browser round or **Start real game** to proceed. For the real game, seat all the wires, then select **Start level 1** or press **A** on the board.

| If you get stuck | What to check |
|---|---|
| No COM port appears | Try a USB data cable and another USB port. Check **Device Manager → Ports (COM & LPT)**. |
| The uploader reports that the port is busy | Stop the game server and close any Serial Monitor, then retry. |
| Option 1 shows **USB connected** | The cable is working. Check the Wi-Fi credentials, matching pairing key, PC IPv4 address, and inbound TCP **8443** on the private network. If the PC’s address changed, update the header and upload again. |
| A phone cannot open a QR link | Connect it to the same local network as the PC. Allow the port printed under **Phone joining** through Windows Firewall on the private network. If the PC has several network adapters, select the right one in the lobby. |
| You hear the board but no PC music | Enable the speaker button and check the Windows audio output. |
