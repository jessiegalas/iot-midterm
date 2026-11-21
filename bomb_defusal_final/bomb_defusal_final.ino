/*
  COMPLETE VERSION: 3 levels + servo + USB Serial + Wi-Fi WebSocket + OTA uploads.
  - The titles shown on the OLED are set in the "Titles" section near the top.
  - Servo settings are in the "Balloon-popper servo" section.
  - Set SERVO_ENABLED to false while testing without the balloon mechanism.
  - Set your 2.4 GHz Wi-Fi SSID and password below (or leave placeholders for USB only).
  - Set a unique OTA_PASSWORD below to enable authenticated wireless uploads.
  - OTA requires an OTA-capable partition layout and one initial upload by USB/serial,
    unless compatible OTA firmware is already running on your board.

  ====================================================================
  TWO-PLAYER BOMB DEFUSAL MINIGAME - ESP32 (classic DevKit V1)
  ====================================================================
  Player 1 (the "Defuser"): sits at the device, has NO documents.
  Player 2 (the "Expert"): has the printed manual, NO view of the device.

  LEVEL 1: 4-digit code (morse) + pull 1 correct wire  (2 decoys)
  LEVEL 2: 4-digit code (morse) + pull 2 correct wires (1 decoy)
  LEVEL 3: 4-digit code (morse) + pull all 3 wires

  Pull the WRONG wire at any time -> instant explosion.
  Enter the WRONG code 3 times    -> instant explosion.
  Timer hits zero                 -> instant explosion.

  Before EVERY level (including level 1): put all wires back in, then press A on the
  keypad. The clock only runs while a level is being played.
  Start / reset the game: press D on the keypad (the onboard BOOT button also works).

  Libraries required (install via Library Manager):
    - "Keypad" by Chris--A / Mark Stanley
    - "Adafruit SSD1306"
    - "Adafruit GFX Library"
    - "WebSockets" by Markus Sattler (Links2004)
  Board package: "esp32" by Espressif Systems
  Board selection in Arduino IDE: "ESP32 Dev Module"
  ====================================================================
*/

#include <Wire.h>
#include <Keypad.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>                // bundled with ESP32 board package
#include <ArduinoOTA.h>          // bundled with ESP32 board package
#include <WebSocketsServer.h>    // WebSockets library by Markus Sattler

// ---------------- Wi-Fi / WebSocket settings ----------------
// Standard ESP32 DevKit V1 supports 2.4 GHz Wi-Fi (not 5 GHz-only networks).
// Credentials are intentionally not embedded in the distributed sketch.
const char* WIFI_SSID = "5ig169_2.4G";
const char* WIFI_PASSWORD = "wlan9665";
const uint16_t WEBSOCKET_PORT = 81;
WebSocketsServer webSocket(WEBSOCKET_PORT);

// ---------------- Authenticated Arduino OTA settings ----------------
// CHANGE THIS before uploading. A password is required so anyone on the same
// network cannot flash new code without permission. Do NOT reuse Wi-Fi password.
// If left as the placeholder below, OTA stays disabled (USB/WebSocket still work).
const char* OTA_HOSTNAME = "esp32-bomb-defusal";
const char* OTA_PASSWORD = "123456789";
const char* OTA_PASSWORD_PLACEHOLDER = "123456789";

bool otaStarted = false;
bool otaInProgress = false;
bool otaPasswordWarningShown = false;

// ---------------- OLED ----------------
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define SDA_PIN 21
#define SCL_PIN 22
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ---------------- Keypad (4x4) ----------------
const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
byte rowPins[ROWS] = {13, 14, 27, 26};
byte colPins[COLS] = {25, 32, 33, 4};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ---------------- Buzzer / LEDs / Start button ----------------
#define BUZZER_PIN   15
#define LED_RED      12
#define LED_GREEN    2
#define START_BUTTON 0   // onboard "BOOT" button: backup start/reset (active LOW)

// ---------------- Titles shown on the OLED ----------------
// Edit these to rename the game or the levels (max 10 characters for the
// big titles, max 21 characters for the small subtitles).
const char* GAME_TITLE_1 = "BOMB";
const char* GAME_TITLE_2 = "DEFUSAL";
const char* LEVEL_TITLES[3]    = {"LEVEL 1", "LEVEL 2", "LEVEL 3"};
const char* LEVEL_SUBTITLES[3] = {"Warm-up", "Getting hot", "Sudden death"};

// ---------------- Balloon-popper servo ----------------
#define SERVO_PIN 23                  // servo signal wire (orange / yellow)
const bool SERVO_ENABLED = true;     // change to true ONLY when the servo is safely mounted
const int  REST_ANGLE    = 0;         // needle pulled back, away from the balloon
const int  POP_ANGLE     = 90;        // swing size: 90 or 180 (try 90 first)
const int  POP_JABS      = 2;         // number of jabs (2 = a second chance to pop)
const int  SERVO_MIN_US  = 500;       // pulse width for 0 degrees   (SG90: about 500)
const int  SERVO_MAX_US  = 2400;      // pulse width for 180 degrees (SG90: about 2400)

// Sends the standard 50-per-second servo pulses for `ms` milliseconds so the
// servo moves to (and briefly holds) `angle`. It only ever runs at the moment
// of the explosion, so the servo can't twitch during the game and can't
// interfere with the buzzer's tone() PWM.
void servoHold(int angle, int ms) {
  angle = constrain(angle, 0, 180);
  int pulseUs = map(angle, 0, 180, SERVO_MIN_US, SERVO_MAX_US);
  unsigned long start = millis();
  while (millis() - start < (unsigned long)ms) {
    digitalWrite(SERVO_PIN, HIGH);
    delayMicroseconds(pulseUs);
    digitalWrite(SERVO_PIN, LOW);
    delay(18);   // plus the pulse = roughly 20 ms per cycle (50 Hz)
  }
}

void popBalloon() {
  if (!SERVO_ENABLED) {
    Serial.println("[servo disabled] the balloon would pop here");
    return;
  }
  for (int i = 0; i < POP_JABS; i++) {
    servoHold(POP_ANGLE, 450);    // swing the needle into the balloon
    servoHold(REST_ANGLE, 450);   // pull it back
  }
}


// ---------------- The 3 defusal wires ----------------
const char* colorNames[3] = {"RED", "BLACK", "BLUE"};
const int   wirePins[3]   = {5, 18, 19};
bool wireBaseline[3];      // state recorded at the start of each level (should be LOW = wire present)
bool wireCounted[3];       // prevents double-triggering the same pull

// ---------------- Riddle card bank ----------------
// Each card's flavor text lives in the printed manual, not here.
// The firmware only needs to know which color each card number maps to.
struct RiddleCard { int number; const char* color; };
RiddleCard riddleBank[6] = {
  {1, "RED"},   {2, "RED"},
  {3, "BLACK"}, {4, "BLACK"},
  {5, "BLUE"},  {6, "BLUE"}
};

// ---------------- Morse table for digits 0-9 ----------------
const char* morseDigits[10] = {
  "-----", ".----", "..---", "...--", "....-",
  ".....", "-....", "--...", "---..", "----."
};

// ---------------- Game state ----------------
// Note: these are prefixed GAME_ because the Keypad library's Key.h
// already defines its own enum containing "IDLE", which would
// otherwise collide with a plain "IDLE" here.
enum GameState { GAME_IDLE, GAME_READY, GAME_PLAYING, GAME_LEVEL_CLEARED, GAME_WON, GAME_LOST };
GameState state = GAME_IDLE;
const char* lastLossTag = "TIME"; // used to re-sync web clients after a loss

int level = 1;
int secretCode[4];
char codeBuffer[5] = "";
int codeBufLen = 0;
int wrongCodeTries = 0;
bool codeSolved = false;

int requiredColors[3];     // indices into colorNames/wirePins for THIS level
int assignedCards[3];      // riddle card numbers shown to the player for THIS level
int requiredCount = 0;
int wiresPulledCorrect = 0;

unsigned long totalGameSeconds = 240; // 4 minute overall timer - change to taste
unsigned long levelStartMillis = 0;
long timeLeft = 0;
unsigned long lastTickMillis = 0;
byte lastReadyMask = 255;   // which wires were missing when the ready screen was last drawn

// Beeps faster and faster as time runs out, then goes to a
// continuous alarm tone for the final few seconds.
unsigned long lastWarnBeepMillis = 0;
const int PANIC_SECONDS   = 3;    // switch to a continuous tone at this point

// ====================================================================
// USB Serial + Wi-Fi WebSocket bridge (same commands/events on both transports)
// ====================================================================
// Device -> host (all lines start with '@'):
//   @HELLO,1                                   protocol version
//   @IDLE                                      idle/title screen
//   @READY,level,missingWireMask,secs          waiting for wires and A
//   @LEVEL,level,code,reqWireMask,cards,secs   level started
//   @ENTRY,digits                              typed code
//   @CODE,OK | @CODE,BAD,wrongTries            code result
//   @WIRE,index,OK | @WIRE,index,BAD           wire result
//   @CLEAR,level                               level cleared
//   @TIME,secs                                 time remaining
//   @PROGRESS,entry,solved,wrong,pulledMask    current level snapshot
//   @WON,secs | @LOST,CODE|WIRE|TIME           final result
// Host -> device (Serial: newline terminated; WebSocket: plain text frame):
//   SYNC | START | RESET | ARM | KEY,x
// Wire indices 0/1/2 = RED/BLACK/BLUE; masks use bit i for wire i.
// WebSocket URL: ws://<ESP32-IP>:81/ (use Serial Monitor at 115200 to find IP).
// USB Serial continues to work without Wi-Fi.

// OTA is serviced from loop() without blocking gameplay.
// While firmware is being updated, game handling is suspended so flash writes
// are not interrupted by game/servo operations.

// Explicit prototypes make function references reliable in Arduino IDE.
void showIdleScreen();
void startGame();
void enterReady();
void beginLevel();
void handleReady();
void handleKeypad();
void handleWires();
void handleTimer();
void updateWarningBeep();
void updatePlayingScreen();
void checkLevelComplete();
void flashMessage(const char* msg, int ms);
void explode(const char* reason, const char* tag);
void winGame();
byte missingWiresMask();

char hostBuf[16];
byte hostLen = 0;
bool hostSkip = false;
char hostKey = 0;

void broadcastEvent(const String& msg) {
  Serial.println(msg);
  if (WiFi.status() == WL_CONNECTED) {
    String outbound = msg;  // broadcastTXT accepts a mutable String in some versions
    webSocket.broadcastTXT(outbound);
  }
}

void connectWiFi() {
  if (strcmp(WIFI_SSID, "YOUR_2_4_GHZ_WIFI_SSID") == 0 || WIFI_SSID[0] == '\0') {
    Serial.println("WiFi not configured; USB Serial mode is available.");
    return;
  }
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to 2.4 GHz WiFi");
  unsigned long began = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - began < 10000UL) {
    delay(250);
    Serial.print('.');
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\nESP32 IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("WebSocket: ws://");
    Serial.print(WiFi.localIP());
    Serial.print(':');
    Serial.println(WEBSOCKET_PORT);
  } else {
    Serial.println("\nWiFi unavailable; USB Serial mode stays active.");
  }
}

// Start authenticated OTA as soon as Wi-Fi becomes available. This also handles
// connecting after the initial 10-second Wi-Fi attempt in setup() times out.
void serviceOTA() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (!otaStarted) {
    if (OTA_PASSWORD[0] == '\0' ||
        strcmp(OTA_PASSWORD, OTA_PASSWORD_PLACEHOLDER) == 0 ||
        strlen(OTA_PASSWORD) < 8) {
      if (!otaPasswordWarningShown) {
        Serial.println("OTA disabled: set a unique OTA_PASSWORD of 8+ characters in the sketch.");
        otaPasswordWarningShown = true;
      }
      return;
    }

    ArduinoOTA.setHostname(OTA_HOSTNAME);
    ArduinoOTA.setPassword(OTA_PASSWORD);
    ArduinoOTA.onStart([]() {
      otaInProgress = true;
      noTone(BUZZER_PIN);
      digitalWrite(SERVO_PIN, LOW);  // avoid servo pulses during the update
      Serial.println("OTA update started. Keep ESP32 powered.");
    });
    ArduinoOTA.onEnd([]() {
      Serial.println("OTA complete. Rebooting.");
    });
    ArduinoOTA.onError([](ota_error_t error) {
      Serial.printf("OTA error: %u\n", (unsigned int)error);
      otaInProgress = false;
      lastTickMillis = millis(); // resume game clock without counting upload time
    });
    ArduinoOTA.begin();
    otaStarted = true;
    Serial.print("OTA available as: ");
    Serial.print(OTA_HOSTNAME);
    Serial.print(" at ");
    Serial.println(WiFi.localIP());
  }

  ArduinoOTA.handle();
}

// The physical keypad has priority; the next queued remote key is used otherwise.
char readKey() {
  char k = keypad.getKey();
  if (!k && hostKey) { k = hostKey; hostKey = 0; }
  return k;
}

void sendHello() { broadcastEvent("@HELLO,1"); }

void sendEntry() {
  broadcastEvent(String("@ENTRY,") + codeBuffer);
}

void sendReady(byte missing) {
  broadcastEvent("@READY," + String(level) + "," + String((unsigned int)missing) + "," + String(timeLeft));
}

void sendLevel() {
  byte reqMask = 0;
  for (int i = 0; i < requiredCount; i++) reqMask |= (1 << requiredColors[i]);
  String msg = "@LEVEL," + String(level) + ",";
  for (int i = 0; i < 4; i++) msg += String(secretCode[i]);
  msg += "," + String((unsigned int)reqMask) + ",";
  for (int i = 0; i < requiredCount; i++) {
    if (i) msg += ':';
    msg += String(assignedCards[i]);
  }
  msg += "," + String(timeLeft);
  broadcastEvent(msg);
}

void sendProgress() {
  byte pulled = 0;
  for (int i = 0; i < 3; i++) if (wireCounted[i]) pulled |= (1 << i);
  broadcastEvent(String("@PROGRESS,") + codeBuffer + "," +
                 String(codeSolved ? 1 : 0) + "," +
                 String(wrongCodeTries) + "," + String((unsigned int)pulled));
}

void sendSnapshot() {
  switch (state) {
    case GAME_READY:   sendReady(missingWiresMask()); break;
    case GAME_PLAYING: sendLevel(); sendProgress(); break;
    case GAME_WON:     broadcastEvent("@WON," + String(timeLeft)); break;
    case GAME_LOST:    broadcastEvent(String("@LOST,") + lastLossTag); break;
    default:           broadcastEvent("@IDLE"); break;
  }
}

void resetToIdle() {
  state = GAME_IDLE;
  hostKey = 0;
  noTone(BUZZER_PIN);
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_GREEN, LOW);
  showIdleScreen();
  broadcastEvent("@IDLE");
}

void runHostCommand(const char* cmd) {
  if (strcmp(cmd, "SYNC") == 0) {
    sendHello();
    sendSnapshot();
  } else if (strcmp(cmd, "START") == 0) {
    hostKey = 0;
    startGame();
  } else if (strcmp(cmd, "RESET") == 0) {
    resetToIdle();
  } else if (strcmp(cmd, "ARM") == 0) {
    hostKey = 'A';
  } else if (strncmp(cmd, "KEY,", 4) == 0 && cmd[4] != '\0' && cmd[5] == '\0') {
    if (strchr("0123456789*#ABCD", cmd[4])) hostKey = cmd[4];
  }
}

void onWebSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) {
    sendHello();
    sendSnapshot();
  } else if (type == WStype_TEXT) {
    char cmd[16];
    if (length >= sizeof(cmd)) return;  // reject overlong commands
    memcpy(cmd, payload, length);
    cmd[length] = '\0';
    while (length > 0 && (cmd[length - 1] == '\r' || cmd[length - 1] == '\n')) {
      cmd[--length] = '\0';
    }
    if (length > 0) runHostCommand(cmd);
  }
}

// Read both transports on every pass through loop().
void pollHost() {
  webSocket.loop();
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (!hostSkip && hostLen > 0) {
        hostBuf[hostLen] = '\0';
        runHostCommand(hostBuf);
      }
      hostLen = 0;
      hostSkip = false;
    } else if (hostSkip) {
      continue;  // discard the rest of an overlong command
    } else if (hostLen < sizeof(hostBuf) - 1) {
      hostBuf[hostLen++] = c;
    } else {
      hostSkip = true;
    }
  }
}

// ====================================================================
void setup() {
  Serial.begin(115200);
  pinMode(SERVO_PIN, OUTPUT);
  digitalWrite(SERVO_PIN, LOW);   // no pulses = servo stays still until the explosion

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(START_BUTTON, INPUT_PULLUP);

  for (int i = 0; i < 3; i++) {
    pinMode(wirePins[i], INPUT_PULLUP);
  }

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);  // 100kHz - more reliable over breadboard jumper wires
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED not found");
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  randomSeed(esp_random());

  connectWiFi();
  serviceOTA(); // advertise OTA if already connected and password is configured
  webSocket.begin();
  webSocket.onEvent(onWebSocketEvent);

  showIdleScreen();
  sendHello();
  broadcastEvent("@IDLE");
}

// ====================================================================
// Start / reset: the D key on the keypad. The onboard BOOT button (GPIO0) still
// works too, as a backup in case the keypad ever misbehaves.
bool startPressed() {
  char k = readKey();
  return (k == 'D') || (digitalRead(START_BUTTON) == LOW);
}

void loop() {
  serviceOTA(); // service authenticated network uploads on every iteration
  if (otaInProgress) {
    delay(1);   // suspend game handling until OTA succeeds or fails
    return;
  }
  pollHost();   // USB Serial + Wi-Fi WebSocket commands
  switch (state) {
    case GAME_IDLE:
      if (startPressed()) {
        delay(250); // debounce
        startGame();
      }
      break;

    case GAME_READY:
      handleReady();   // wait for every wire to be back in, then the A key
      break;

    case GAME_PLAYING:
      handleKeypad();
      if (state != GAME_PLAYING) break;   // exploded or won: leave the result screen alone
      handleWires();
      if (state != GAME_PLAYING) break;
      handleTimer();
      if (state != GAME_PLAYING) break;
      updatePlayingScreen();
      break;

    case GAME_WON:
    case GAME_LOST:
      if (startPressed()) {
        delay(250);
        resetToIdle();
      }
      break;

    default:
      break;
  }
}

// ====================================================================
// GAME FLOW
// ====================================================================
void startGame() {
  level = 1;
  timeLeft = totalGameSeconds;
  lastTickMillis = millis();
  lastWarnBeepMillis = 0;
  noTone(BUZZER_PIN);
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_GREEN, LOW);
  enterReady();   // level 1 also waits for the wires + the A key
}

void generateLevel(int lvl) {
  tone(BUZZER_PIN, 1500, 200);  // round-start beep
  // 1) random 4-digit code
  for (int i = 0; i < 4; i++) secretCode[i] = random(0, 10);
  codeBufLen = 0;
  codeBuffer[0] = '\0';
  wrongCodeTries = 0;
  codeSolved = false;

  // 2) pick `lvl` correct wire colors out of 3, no repeats
  int pool[3] = {0, 1, 2};
  for (int i = 2; i > 0; i--) { // shuffle
    int j = random(0, i + 1);
    int t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  requiredCount = lvl;
  for (int i = 0; i < requiredCount; i++) requiredColors[i] = pool[i];

  // 3) for each required color, assign a random matching riddle card
  for (int i = 0; i < requiredCount; i++) {
    const char* targetColor = colorNames[requiredColors[i]];
    int matches[4]; int m = 0;
    for (int c = 0; c < 6; c++) {
      if (strcmp(riddleBank[c].color, targetColor) == 0) matches[m++] = riddleBank[c].number;
    }
    assignedCards[i] = matches[random(0, m)];
  }

  // 4) record wire baseline (all should read LOW = wire plugged in)
  for (int i = 0; i < 3; i++) {
    wireBaseline[i] = digitalRead(wirePins[i]);
    wireCounted[i] = false;
  }
  wiresPulledCorrect = 0;

  Serial.print("LEVEL "); Serial.println(lvl);
  Serial.print("Code: ");
  for (int i = 0; i < 4; i++) Serial.print(secretCode[i]);
  Serial.println();
  Serial.print("Required colors: ");
  for (int i = 0; i < requiredCount; i++) { Serial.print(colorNames[requiredColors[i]]); Serial.print(" "); }
  Serial.println();
  Serial.print("Riddle cards: ");
  for (int i = 0; i < requiredCount; i++) { Serial.print(assignedCards[i]); Serial.print(" "); }
  Serial.println();
}

void handleKeypad() {
  char k = readKey();
  if (!k) return;

  if (k == '*') {
    codeBufLen = 0;
    codeBuffer[0] = '\0';
    sendEntry();
  } else if (k >= '0' && k <= '9') {
    if (codeBufLen < 4) {
      codeBuffer[codeBufLen++] = k;
      codeBuffer[codeBufLen] = '\0';
    }
    tone(BUZZER_PIN, 1200, 40);
    sendEntry();
  } else if (k == '#') {
    if (codeBufLen == 4) {
      bool match = true;
      for (int i = 0; i < 4; i++) {
        if (codeBuffer[i] - '0' != secretCode[i]) { match = false; break; }
      }
      if (match) {
        codeSolved = true;
        tone(BUZZER_PIN, 2000, 150);
        broadcastEvent("@CODE,OK");
      } else {
        wrongCodeTries++;
        tone(BUZZER_PIN, 300, 300);
        broadcastEvent("@CODE,BAD," + String(wrongCodeTries));
        if (wrongCodeTries >= 3) {
          explode("WRONG CODE 3X", "CODE");
          return;
        }
      }
    }
    codeBufLen = 0;
    codeBuffer[0] = '\0';
    sendEntry();
  }

  checkLevelComplete();
}

void handleWires() {
  for (int i = 0; i < 3; i++) {
    bool nowState = digitalRead(wirePins[i]);
    if (!wireCounted[i] && wireBaseline[i] == LOW && nowState == HIGH) {
      // this wire was just pulled
      wireCounted[i] = true;
      bool isRequired = false;
      for (int r = 0; r < requiredCount; r++) {
        if (requiredColors[r] == i) { isRequired = true; break; }
      }
      if (isRequired) {
        wiresPulledCorrect++;
        tone(BUZZER_PIN, 1800, 100);
        broadcastEvent("@WIRE," + String(i) + ",OK");
      } else {
        broadcastEvent("@WIRE," + String(i) + ",BAD");
        explode("WRONG WIRE PULLED", "WIRE");
        return;
      }
    }
  }
  checkLevelComplete();
}

void checkLevelComplete() {
  if (state != GAME_PLAYING) return;
  if (codeSolved && wiresPulledCorrect >= requiredCount) {
    broadcastEvent("@CLEAR," + String(level));
    if (level >= 3) {
      winGame();
    } else {
      noTone(BUZZER_PIN);
      lastWarnBeepMillis = 0;
      flashMessage("LEVEL CLEAR!", 900);
      level++;
      enterReady();   // wires must be put back and A pressed before the next level
    }
  }
}

void handleTimer() {
  if (millis() - lastTickMillis >= 1000) {
    lastTickMillis += 1000;
    timeLeft--;
    if (timeLeft <= 0) {
      explode("TIME'S UP", "TIME");
      return;
    }
    broadcastEvent("@TIME," + String(timeLeft));
  }
  updateWarningBeep();
}

void updateWarningBeep() {
  if (timeLeft <= 0) return;

  if (timeLeft <= PANIC_SECONDS) {
    tone(BUZZER_PIN, 1200);  // continuous - no duration means it doesn't stop on its own
    return;
  }

  // beeps for the ENTIRE round, starting slow (~900ms) and accelerating
  // smoothly down to fast (~100ms) as timeLeft approaches zero
  int interval = map(timeLeft, 0, totalGameSeconds, 100, 900);
  interval = constrain(interval, 100, 900);
  if (millis() - lastWarnBeepMillis >= (unsigned long)interval) {
    lastWarnBeepMillis = millis();
    tone(BUZZER_PIN, 1000, interval / 2);
  }
}

// `reason` is shown on the OLED; `tag` (CODE, WIRE or TIME) goes to the web page.
void explode(const char* reason, const char* tag) {
  state = GAME_LOST;
  lastLossTag = tag;
  broadcastEvent(String("@LOST,") + tag);   // before the slow balloon pop below
  digitalWrite(LED_RED, HIGH);
  digitalWrite(LED_GREEN, LOW);
  tone(BUZZER_PIN, 200, 2000);
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(5, 10);
  display.println("BOOM!");
  display.setTextSize(1);
  display.setCursor(5, 35);
  display.println(reason);
  display.setCursor(5, 50);
  display.println("Press D to reset");
  display.display();
  Serial.print("EXPLODED: "); Serial.println(reason);

  // Pop the balloon LAST, after the screen, LED and buzzer have already reacted
  popBalloon();
}

void winGame() {
  state = GAME_WON;
  broadcastEvent("@WON," + String(timeLeft));
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(LED_RED, LOW);
  tone(BUZZER_PIN, 1500, 200);
  delay(220);
  tone(BUZZER_PIN, 1900, 200);
  delay(220);
  tone(BUZZER_PIN, 2400, 400);
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(5, 15);
  display.println("DEFUSED!");
  display.setTextSize(1);
  display.setCursor(5, 45);
  display.println("Press D to reset");
  display.display();
}

// ====================================================================
// DISPLAY
// ====================================================================
// Prints text horizontally centered on the 128-pixel-wide screen.
void printCentered(const char* s, int y, int size) {
  display.setTextSize(size);
  int w = strlen(s) * 6 * size;          // each character is 6 pixels wide at size 1
  int x = (SCREEN_WIDTH - w) / 2;
  if (x < 0) x = 0;
  display.setCursor(x, y);
  display.print(s);
}

// Title screen: shown at power-on and between games.
void showIdleScreen() {
  display.clearDisplay();
  printCentered(GAME_TITLE_1, 0, 2);
  printCentered(GAME_TITLE_2, 18, 2);
  display.drawLine(0, 40, 127, 40, SSD1306_WHITE);
  printCentered("Press D on the keypad", 46, 1);
  printCentered("to arm the device", 56, 1);
  display.display();
}

// ====================================================================
// BETWEEN LEVELS: put every wire back in, then press A
// ====================================================================
// Bit i of the result is set if wire i is NOT seated (its pin reads HIGH).
byte missingWiresMask() {
  byte m = 0;
  for (int i = 0; i < 3; i++) {
    if (digitalRead(wirePins[i]) == HIGH) m |= (1 << i);
  }
  return m;
}

void enterReady() {
  state = GAME_READY;
  lastReadyMask = 255;   // forces the ready screen to be drawn
}

void drawReadyScreen(byte missing) {
  int i = constrain(level, 1, 3) - 1;
  display.clearDisplay();
  printCentered(LEVEL_TITLES[i], 0, 2);
  printCentered(LEVEL_SUBTITLES[i], 20, 1);
  display.drawLine(0, 32, 127, 32, SSD1306_WHITE);
  if (missing == 0) {
    printCentered("All wires seated", 38, 1);
    printCentered("Press A to start", 50, 1);
  } else {
    char names[24];
    names[0] = '\0';
    for (int w = 0; w < 3; w++) {
      if (missing & (1 << w)) {
        if (names[0] != '\0') strcat(names, " ");
        strcat(names, colorNames[w]);
      }
    }
    printCentered("Put these wires back:", 36, 1);
    printCentered(names, 46, 1);
    printCentered("then press A", 56, 1);
  }
  display.display();
}

void handleReady() {
  byte missing = missingWiresMask();
  if (missing != lastReadyMask) {          // redraw only when something changed
    lastReadyMask = missing;
    drawReadyScreen(missing);
    sendReady(missing);
  }
  char k = readKey();
  if (k == 'A') {
    if (missing == 0) beginLevel();
    else tone(BUZZER_PIN, 300, 300);       // refused: a wire is still out
  }
}

void beginLevel() {
  generateLevel(level);        // new code and wires; the wire baseline is taken with every wire seated
  for (int i = 0; i < 3; i++) {
    if (wireBaseline[i] == HIGH) { enterReady(); return; }   // a wire wasn't really seated, so ask again
  }
  lastTickMillis = millis();   // the clock only runs while a level is actually being played
  lastWarnBeepMillis = 0;
  state = GAME_PLAYING;
  sendLevel();
}

void flashMessage(const char* msg, int ms) {
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(5, 25);
  display.println(msg);
  display.display();
  delay(ms);
}

void updatePlayingScreen() {
  static unsigned long lastDraw = 0;
  if (millis() - lastDraw < 150) return; // limit redraw rate
  lastDraw = millis();

  display.clearDisplay();
  display.setTextSize(1);

  // Top bar: level + timer
  display.setCursor(0, 0);
  display.print("LEVEL "); display.print(level);
  display.print("  TIME ");
  int mm = timeLeft / 60; int ss = timeLeft % 60;
  if (mm < 10) display.print("0");
  display.print(mm);
  display.print(":");
  if (ss < 10) display.print("0");
  display.print(ss);

  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);

  // Morse patterns, displayed on a single line
  display.setCursor(0, 14);
  display.print("CODE:");
  display.setCursor(0, 24);
  for (int i = 0; i < 4; i++) {
    display.print(morseDigits[secretCode[i]]);
    display.print(" ");
  }
  display.setCursor(0, 34);
  display.print("Entered: ");
  display.print(codeBuffer);
  if (codeSolved) display.print(" OK");

  // Riddle cards for this level
  display.setCursor(0, 46);
  display.print("Cards: ");
  for (int i = 0; i < requiredCount; i++) {
    display.print(assignedCards[i]);
    display.print(" ");
  }
  display.setCursor(0, 56);
  display.print("Wires pulled: ");
  display.print(wiresPulledCorrect);
  display.print("/");
  display.print(requiredCount);

  display.display();
}

/*
  ====================================================================
  WIRING NOTES
  ====================================================================
  OLED (I2C SSD1306 128x64):
    VCC -> 3V3      GND -> GND
    SDA -> GPIO21   SCL -> GPIO22

  4x4 Keypad:
    Rows -> GPIO13, 14, 27, 26
    Cols -> GPIO25, 33, 32, 4

  3 defusal wires (each: one end into GPIO pin's breadboard row,
  other end into the GND rail). These match wirePins[] in the code:
    RED    -> GPIO5
    BLACK  -> GPIO18
    BLUE   -> GPIO19
  (Internal pull-ups are enabled in code, so no external resistors
  are needed. Pin reads LOW while the wire is seated, HIGH once pulled.)

  Balloon-popper servo signal -> GPIO23 (see SERVO_PIN)

  USB Serial (115200 baud) and Wi-Fi WebSocket (port 81) share the same protocol.
  OTA uses ArduinoOTA on the local network (separate from WebSocket port 81).
  Arduino IDE: Tools > Partition Scheme must select a scheme with OTA slots;
  avoid "Huge APP (No OTA)". Set OTA_PASSWORD before first OTA-enabled upload.
  The very first OTA-enabled sketch must normally be flashed through USB/serial.
  For USB/Web Serial, close Arduino Serial Monitor before opening the web app.
  For Wi-Fi, connect your web app to ws://ESP32_IP:81/ on the same network.
  Classic ESP32 DevKit V1 needs a 2.4 GHz network. USB works without Wi-Fi.

  Buzzer (passive piezo): + -> GPIO15, - -> GND
  Red LED (through 220ohm resistor): anode -> GPIO12
  Green LED (through 220ohm resistor): anode -> GPIO2
  Start/Reset: the D key on the keypad (no extra wiring; the onboard BOOT button on GPIO0 also works as a backup)
  ====================================================================
*/