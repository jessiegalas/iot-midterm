
#include <Wire.h>
#include <Keypad.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "BridgeTransport.h"
#include "WireDebounce.h"

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

#define NUM_WIRES 5
const int MIN_REQUIRED = 1;
const int MAX_REQUIRED = 5;
// ---------------- Five defusal wires ----------------
const char* colorNames[NUM_WIRES] = {"RED", "BLACK", "BLUE", "WHITE", "PURPLE"};
const int   wirePins[NUM_WIRES]   = {5, 18, 19, 16, 17};
bool wireBaseline[NUM_WIRES];      // state recorded at the start of each level (should be LOW = wire present)
bool wireCounted[NUM_WIRES];       // prevents double-triggering the same pull
WireDebounce wireDebounce[NUM_WIRES];


// ---------------- Riddle card bank ----------------
// Each card's flavor text lives in the printed manual, not here.
// The firmware only needs to know which color each card number maps to.
struct RiddleCard { int number; const char* color; };
RiddleCard riddleBank[10] = {
  {1, "RED"},   {2, "RED"},
  {3, "BLACK"}, {4, "BLACK"},
  {5, "BLUE"},  {6, "BLUE"},
  {7, "WHITE"},  {8, "WHITE"},
  {9, "PURPLE"},  {10, "PURPLE"}
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
int totalWrongTries = 0;
bool codeSolved = false;

int requiredColors[NUM_WIRES];     // indices into colorNames/wirePins for THIS level
int assignedCards[NUM_WIRES];      // riddle card numbers shown to the player for THIS level
int requiredCount = 0;
int wiresPulledCorrect = 0;

unsigned long totalGameSeconds = 240; // 4 minute overall timer - change to taste
long timeLeft = 240;
unsigned long lastTickMillis = 0;
byte lastReadyMask = 255;   // which wires were missing when the ready screen was last drawn

// Beeps faster and faster as time runs out, then goes to a
// continuous alarm tone for the final few seconds.
unsigned long lastWarnBeepMillis = 0;
const int PANIC_SECONDS   = 3;    // switch to a continuous tone at this point

const int MAX_STRIKES = 3;
uint32_t revision = 0;
uint32_t runId = 0;
char bootId[9];
char deviceId[13];
char lease[17] = "";
char lastCommand[17] = "";
BridgeTransport::Source controlSource = BridgeTransport::USB;
unsigned controlGeneration = 0;
bool changed = true;
unsigned long feedbackStarted = 0;
int winSoundStep = 0;
std::atomic<bool> lossFeedback{false};

void showIdleScreen();
void startGame();
void resetToIdle();
void beginLevel();
void enterReady();
void handleReady();
void handleKeypad(char key);
void handleWires();
void handleTimer();
void updateWarningBeep();
void updatePlayingScreen();
void checkLevelComplete();
void flashMessage(const char* msg);
void explode(const char* reason, const char* tag);
void winGame();
void showWinScreen();
byte missingWiresMask();

void sendHello(BridgeTransport::Source source) {
  char frame[36];
  snprintf(frame, sizeof(frame), "@HELLO,2,%s,%s", deviceId, bootId);
  BridgeTransport::send(source, frame);
}

void sendState(BridgeTransport::Source source) {
  static const char* phases[] = {"idle", "ready", "playing", "cleared", "won", "lost"};
  char clues[24] = "";
  char cards[16] = "";
  unsigned mask = 0;
  if (state == GAME_READY) {
    mask = missingWiresMask();
  } else if (state != GAME_IDLE) {
    snprintf(clues, sizeof(clues), "%s:%s:%s:%s", morseDigits[secretCode[0]],
             morseDigits[secretCode[1]], morseDigits[secretCode[2]], morseDigits[secretCode[3]]);
    size_t written = 0;
    for (int i = 0; i < requiredCount; ++i) {
      written += snprintf(cards + written, sizeof(cards) - written, "%s%d", i ? ":" : "", assignedCards[i]);
    }
    for (int i = 0; i < NUM_WIRES; ++i) {
      if (wireCounted[i]) mask |= 1u << i;
    }
  }
  char frame[BridgeTransport::FRAME_SIZE];
  snprintf(frame, sizeof(frame), "@STATE,%s,%lu,%lu,%s,%d,%ld,%s,%d,%d,%d,%u,%s,%s,%s,%s",
           bootId, static_cast<unsigned long>(runId), static_cast<unsigned long>(revision), phases[state],
           level, timeLeft, state == GAME_IDLE || state == GAME_READY ? "" : codeBuffer,
           state == GAME_IDLE || state == GAME_READY ? 0 : wrongCodeTries, totalWrongTries,
           codeSolved && state != GAME_IDLE && state != GAME_READY ? 1 : 0, mask, clues, cards,
           state == GAME_LOST ? lastLossTag : "", lastCommand);
  BridgeTransport::send(source, frame);
}

void publishState() {
  if (!changed) return;
  changed = false;
  ++revision;
  sendState(BridgeTransport::USB);
  sendState(BridgeTransport::WIFI);
}

bool isToken(const char* text) {
  return strlen(text) == 16 && strspn(text, "0123456789abcdef") == 16;
}

bool applyCommand(const char* command) {
  if (lossFeedback || state == GAME_LEVEL_CLEARED || (state == GAME_WON && winSoundStep < 2)) return false;
  if (strcmp(command, "START") == 0) {
    startGame();
  } else if (strcmp(command, "RESET") == 0) {
    resetToIdle();
  } else if (strcmp(command, "ARM") == 0 || strcmp(command, "KEY,A") == 0) {
    if (state != GAME_READY) return false;
    if (missingWiresMask() != 0) {
      tone(BUZZER_PIN, 300, 300);
      return false;
    }
    beginLevel();
    return state == GAME_PLAYING;
  } else if (strcmp(command, "KEY,D") == 0 && (state == GAME_IDLE || state == GAME_WON || state == GAME_LOST)) {
    if (state == GAME_IDLE) startGame();
    else resetToIdle();
  } else if (state == GAME_PLAYING && strncmp(command, "KEY,", 4) == 0 && command[4] &&
             !command[5] && strchr("0123456789*#", command[4])) {
    handleKeypad(command[4]);
  } else {
    return false;
  }
  return true;
}

void processFrame(BridgeTransport::Source source, BridgeTransport::Frame& frame) {
  char* command = frame.text;
  if (strcmp(command, "SYNC") == 0 || strcmp(command, "PING") == 0) {
    sendHello(source);
    if (command[0] == 'S') sendState(source);
  } else if (strncmp(command, "TAKE,", 5) == 0 && isToken(command + 5)) {
    strcpy(lease, command + 5);
    controlSource = source;
    controlGeneration = frame.generation;
    char reply[32];
    snprintf(reply, sizeof(reply), "@TAKEN,%s", lease);
    BridgeTransport::send(source, reply);
    sendState(source);
  } else if (strncmp(command, "CMD,", 4) == 0 && source == controlSource && frame.generation == controlGeneration) {
    char* incomingLease = command + 4;
    char* commandId = strchr(incomingLease, ',');
    if (!commandId) return;
    *commandId++ = '\0';
    if (!lease[0] || strcmp(lease, incomingLease) != 0) return;
    char* value = strchr(commandId, ',');
    if (!value) return;
    *value++ = '\0';
    if (!isToken(commandId)) return;
    bool applied = strcmp(lastCommand, commandId) == 0;
    if (!applied && applyCommand(value)) {
      strcpy(lastCommand, commandId);
      changed = true;
      publishState();
      applied = true;
    }
    char reply[54];
    snprintf(reply, sizeof(reply), "@ACK,%s,%s,%s", lease, commandId, applied ? "OK" : "REFUSED");
    BridgeTransport::send(source, reply);
  }
}

void pollBridge() {
  static BridgeTransport::LineReader serial;
  for (int count = 0; count < 192 && Serial.available(); ++count) {
    if (serial.add(static_cast<char>(Serial.read()))) processFrame(BridgeTransport::USB, serial.frame);
  }
  BridgeTransport::Frame frame;
  for (int count = 0; count < 4 && BridgeTransport::receiveWifi(frame); ++count) {
    if (frame.generation == BridgeTransport::connectedGeneration) processFrame(BridgeTransport::WIFI, frame);
  }
}

void resetToIdle() {
  state = GAME_IDLE;
  level = 1;
  timeLeft = totalGameSeconds;
  totalWrongTries = 0;
  noTone(BUZZER_PIN);
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_GREEN, LOW);
  showIdleScreen();
  changed = true;
}

void setup() {
  Serial.begin(115200);
  pinMode(SERVO_PIN, OUTPUT);
  digitalWrite(SERVO_PIN, LOW);   // no pulses = servo stays still until the explosion

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(START_BUTTON, INPUT_PULLUP);

  for (int i = 0; i < NUM_WIRES; i++) {
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

  snprintf(bootId, sizeof(bootId), "%08lx", static_cast<unsigned long>(esp_random()));
  snprintf(deviceId, sizeof(deviceId), "%012llx", static_cast<unsigned long long>(ESP.getEfuseMac()) & 0xffffffffffffULL);
  showIdleScreen();
  sendHello(BridgeTransport::USB);
  BridgeTransport::begin();
}

bool bootButtonPressed() {
  static bool raw = HIGH;
  static bool stable = HIGH;
  static unsigned long changedAt = 0;
  bool current = digitalRead(START_BUTTON);
  if (current != raw) {
    raw = current;
    changedAt = millis();
  }
  if (raw != stable && millis() - changedAt >= 25) {
    stable = raw;
    return stable == LOW;
  }
  return false;
}

void loop() {
  pollBridge();
  const bool bootPressed = bootButtonPressed();
  switch (state) {
    case GAME_IDLE:
      if (keypad.getKey() == 'D' || bootPressed) startGame();
      break;
    case GAME_READY:
      handleReady();
      break;
    case GAME_PLAYING:
      handleKeypad(keypad.getKey());
      if (state == GAME_PLAYING) handleWires();
      if (state == GAME_PLAYING) handleTimer();
      if (state == GAME_PLAYING) updatePlayingScreen();
      break;
    case GAME_LEVEL_CLEARED:
      if (millis() - feedbackStarted >= 900) {
        ++level;
        enterReady();
      }
      break;
    case GAME_WON:
      if (winSoundStep == 0 && millis() - feedbackStarted >= 220) {
        tone(BUZZER_PIN, 1900, 200);
        ++winSoundStep;
      }
      if (winSoundStep == 1 && millis() - feedbackStarted >= 440) {
        tone(BUZZER_PIN, 2400, 400);
        showWinScreen();
        ++winSoundStep;
      }
      if (winSoundStep == 2 && (keypad.getKey() == 'D' || bootPressed)) resetToIdle();
      break;
    case GAME_LOST:
      if (!lossFeedback && (keypad.getKey() == 'D' || bootPressed)) resetToIdle();
      break;
  }
  publishState();
}

// ====================================================================
// GAME FLOW
// ====================================================================
void startGame() {
  ++runId;
  totalWrongTries = 0;
  level = 1;
  timeLeft = totalGameSeconds;
  lastTickMillis = millis();
  lastWarnBeepMillis = 0;
  noTone(BUZZER_PIN);
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_GREEN, LOW);
  enterReady();   // level 1 also waits for the wires + the A key
}

void generateLevel() {
  tone(BUZZER_PIN, 1500, 200);  // round-start beep
  // 1) random 4-digit code
  for (int i = 0; i < 4; i++) secretCode[i] = random(0, 10);
  codeBufLen = 0;
  codeBuffer[0] = '\0';
  wrongCodeTries = 0;
  codeSolved = false;

  // 2) shuffle the 5 wires, then take a RANDOM number of them
  int pool[NUM_WIRES];
  for (int i = 0; i < NUM_WIRES; i++) pool[i] = i;
  for (int i = NUM_WIRES - 1; i > 0; i--) {
    int j = random(0, i + 1);
    int t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  requiredCount = random(MIN_REQUIRED, MAX_REQUIRED + 1);
  for (int i = 0; i < requiredCount; i++) requiredColors[i] = pool[i];

  // 3) for each required wire, pick a random matching riddle card
  for (int i = 0; i < requiredCount; i++) {
    const char* targetColor = colorNames[requiredColors[i]];
    int matches[10]; int m = 0;
    for (int c = 0; c < 10; c++) {
      if (strcmp(riddleBank[c].color, targetColor) == 0) matches[m++] = riddleBank[c].number;
    }
    assignedCards[i] = matches[random(0, m)];
  }

  // 4) record wire baseline (all should read LOW = wire plugged in)
  for (int i = 0; i < NUM_WIRES; i++) {
    wireBaseline[i] = digitalRead(wirePins[i]);
    wireCounted[i] = false;
    wireDebounce[i].reset();
  }
  wiresPulledCorrect = 0;

}

void handleKeypad(char k) {
  if (!k) return;

  if (k == '*') {
    codeBufLen = 0;
    codeBuffer[0] = '\0';
    changed = true;
  } else if (k >= '0' && k <= '9') {
    if (codeBufLen < 4) {
      codeBuffer[codeBufLen++] = k;
      codeBuffer[codeBufLen] = '\0';
    }
    tone(BUZZER_PIN, 1200, 40);
    changed = true;
  } else if (k == '#') {
    if (codeBufLen == 4) {
      bool match = true;
      for (int i = 0; i < 4; i++) {
        if (codeBuffer[i] - '0' != secretCode[i]) { match = false; break; }
      }
      if (match) {
        codeSolved = true;
        tone(BUZZER_PIN, 2000, 150);
        changed = true;
      } else {
        wrongCodeTries++;
        totalWrongTries++;
        changed = true;
        tone(BUZZER_PIN, 300, 300);
        if (wrongCodeTries >= MAX_STRIKES) {
          explode("WRONG CODE 3X", "CODE");
          return;
        }
      }
    }
    codeBufLen = 0;
    codeBuffer[0] = '\0';
    changed = true;
  }

  checkLevelComplete();
}

void handleWires() {
  const unsigned long now = millis();
  for (int i = 0; i < NUM_WIRES; i++) {
    const bool open = digitalRead(wirePins[i]) == HIGH;
    if (!wireCounted[i] && wireBaseline[i] == LOW && wireDebounce[i].pulled(open, now)) {
      // this wire was just pulled
      wireCounted[i] = true;
      changed = true;
      bool isRequired = false;
      for (int r = 0; r < requiredCount; r++) {
        if (requiredColors[r] == i) { isRequired = true; break; }
      }
      if (isRequired) {
        wiresPulledCorrect++;
        tone(BUZZER_PIN, 1800, 100);
      } else {
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
    changed = true;
    if (level >= 3) {
      winGame();
    } else {
      noTone(BUZZER_PIN);
      lastWarnBeepMillis = 0;
      state = GAME_LEVEL_CLEARED;
      feedbackStarted = millis();
      flashMessage("LEVEL CLEAR!");
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
    changed = true;
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
  changed = true;
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

  lossFeedback = true;
  if (xTaskCreate([](void*) {
        popBalloon();
        lossFeedback = false;
        vTaskDelete(nullptr);
      }, "loss-feedback", 3072, nullptr, 1, nullptr) != pdPASS) lossFeedback = false;
}

void winGame() {
  state = GAME_WON;
  changed = true;
  feedbackStarted = millis();
  winSoundStep = 0;
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(LED_RED, LOW);
  tone(BUZZER_PIN, 1500, 200);
}

void showWinScreen() {
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
  for (int i = 0; i < NUM_WIRES; i++) {
    if (digitalRead(wirePins[i]) == HIGH) m |= (1 << i);
  }
  return m;
}

void enterReady() {
  state = GAME_READY;
  changed = true;
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
    char names[32];
    names[0] = '\0';
    int count = 0;
    for (int w = 0; w < NUM_WIRES; w++) {
      if (missing & (1 << w)) {
        if (names[0] != '\0') strcat(names, " ");
        strcat(names, colorNames[w]);
        count++;
      }
    }
    printCentered("Put these wires back:", 36, 1);
    if (strlen(names) <= 21) {
      printCentered(names, 46, 1);
    } else {
      snprintf(names, sizeof(names), "%d wires missing", count);
      printCentered(names, 46, 1);
    }
    printCentered("then press A", 56, 1);
  }
  display.display();
}

void handleReady() {
  byte missing = missingWiresMask();
  if (missing != lastReadyMask) {          // redraw only when something changed
    lastReadyMask = missing;
    drawReadyScreen(missing);
    changed = true;
  }
  char k = keypad.getKey();
  if (k == 'A') {
    if (missing == 0) beginLevel();
    else tone(BUZZER_PIN, 300, 300);       // refused: a wire is still out
  }
}

void beginLevel() {
  generateLevel();        // new code and wires; the wire baseline is taken with every wire seated
  for (int i = 0; i < NUM_WIRES; i++) {
    if (wireBaseline[i] == HIGH) { enterReady(); return; }   // a wire wasn't really seated, so ask again
  }
  lastTickMillis = millis();   // the clock only runs while a level is actually being played
  lastWarnBeepMillis = 0;
  state = GAME_PLAYING;
  changed = true;
}

void flashMessage(const char* msg) {
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(5, 25);
  display.println(msg);
  display.display();
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
    // Morse code as a 2 x 2 table: digits 1-2 on the top row, digits 3-4 on the bottom row
  const int MORSE_COL_X[2] = {4, 70};
  const int MORSE_ROW_Y[2] = {14, 24};
  for (int i = 0; i < 4; i++) {
    display.setCursor(MORSE_COL_X[i % 2], MORSE_ROW_Y[i / 2]);
    display.print(morseDigits[secretCode[i]]);
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
