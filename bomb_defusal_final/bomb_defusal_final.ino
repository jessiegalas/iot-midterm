
#include <Wire.h>
#include <Keypad.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "BridgeTransport.h"
#include "WireDebounce.h"
#include "SoundtrackBeat.h"

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
const int WIRES_PER_LEVEL[] = {1, 2, 2};
// ---------------- Five defusal wires ----------------
const char* colorNames[NUM_WIRES] = {"RED", "BLACK", "BLUE", "WHITE", "PURPLE"};
const int   wirePins[NUM_WIRES]   = {5, 18, 19, 16, 17};
bool wireBaseline[NUM_WIRES];      // state recorded at the start of each level (should be LOW = wire present)
bool wireCounted[NUM_WIRES];       // prevents double-triggering the same pull
WireDebounce wireDebounce[NUM_WIRES];


// ---------------- Riddle card bank ----------------
// Columns follow colorNames. Rows are the three card types in the Expert Manual.
enum CardKind { ELIMINATION_CARD, NUMBER_CARD, MIXED_CARD };
constexpr int CARDS_BY_KIND[][NUM_WIRES] = {
  {2, 4, 6, 8, 10},
  {1, 3, 5, 7, 9},
  {11, 12, 13, 14, 15}
};
constexpr CardKind CARD_KINDS_BY_LEVEL[][2] = {
  {ELIMINATION_CARD, ELIMINATION_CARD},
  {ELIMINATION_CARD, NUMBER_CARD},
  {NUMBER_CARD, MIXED_CARD}
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
int correctDecisions = 0;
int totalDecisions = 0;
bool codeSolved = false;

int requiredColors[NUM_WIRES];     // indices into colorNames/wirePins for THIS level
int assignedCards[NUM_WIRES];      // riddle card numbers shown to the player for THIS level
int requiredCount = 0;
int wiresPulledCorrect = 0;

const unsigned long totalGameSeconds = 240; // Shared with the console's countdown and soundtrack timing.
long timeLeft = 240;
unsigned long lastTickMillis = 0;
byte lastReadyMask = 255;   // which wires were missing when the ready screen was last drawn

// Carry the active fraction of a second across pauses so the beat keeps its phase.
unsigned long pausedTickMillis = 0;

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
constexpr unsigned long LEVEL_CLEAR_MS = 900;
constexpr unsigned LEVEL_CLEAR_STEPS = 4;
unsigned clearedStep = 0;
uint32_t lastBuzzerBeat = UINT32_MAX;
unsigned long buzzerStarted = 0;
unsigned buzzerDuration = 0;
bool buzzerReady = false;
unsigned winSoundStep = 0;
std::atomic<bool> lossFeedback{false};
bool playingFrameValid = false;

void showIdleScreen();
void startGame();
void resetToIdle();
void beginLevel();
void enterReady();
void handleReady();
bool handleKeypad(char key);
void handleWires();
void updateTimer(unsigned long now);
unsigned long musicElapsedMillis();
void updatePlayingScreen();
void checkLevelComplete(unsigned long now);
void showClearedScreen();
void showResultScreen(const char* title, const char* detail, bool success);
void explode(const char* reason, const char* tag);
void winGame();
byte missingWiresMask();

void stopBuzzer() {
  if (buzzerReady) ledcWriteTone(BUZZER_PIN, 0);
  buzzerDuration = 0;
}

void playFeedbackTone(unsigned frequency, unsigned duration) {
  if (!buzzerReady) return;
  ledcWriteTone(BUZZER_PIN, frequency);
  buzzerStarted = millis();
  buzzerDuration = duration;
}

void updateWarningBeep() {
  const auto beat = SoundtrackBeat::at(musicElapsedMillis());
  if (beat.step == lastBuzzerBeat) return;
  lastBuzzerBeat = beat.step;
  if (beat.beep && buzzerDuration == 0) {
    playFeedbackTone(beat.downbeat ? 1200 : 1000, 45);
  }
}

void sendHello(BridgeTransport::Source source) {
  char frame[36];
  snprintf(frame, sizeof(frame), "@HELLO,3,%s,%s", deviceId, bootId);
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
  // The soundtrack samples the playing clock before the matching state frame.
  if (state == GAME_PLAYING) {
    snprintf(frame, sizeof(frame), "@MUSIC,%s,%lu,%lu,%lu", bootId,
             static_cast<unsigned long>(runId), static_cast<unsigned long>(revision), musicElapsedMillis());
    BridgeTransport::send(source, frame);
  }
  const unsigned long tickFraction = state == GAME_PLAYING ? min(millis() - lastTickMillis, 999UL) : pausedTickMillis;
  const unsigned long remainingMs = timeLeft > 0 ? timeLeft * 1000UL - tickFraction : 0;
  snprintf(frame, sizeof(frame), "@STATE,%s,%lu,%lu,%s,%d,%ld,%s,%d,%d,%d,%u,%s,%s,%s,%s,%d,%d,%lu",
           bootId, static_cast<unsigned long>(runId), static_cast<unsigned long>(revision), phases[state],
           level, timeLeft, state == GAME_IDLE || state == GAME_READY ? "" : codeBuffer,
           state == GAME_IDLE || state == GAME_READY ? 0 : wrongCodeTries, totalWrongTries,
           codeSolved && state != GAME_IDLE && state != GAME_READY ? 1 : 0, mask, clues, cards,
           state == GAME_LOST ? lastLossTag : "", lastCommand, correctDecisions, totalDecisions, remainingMs);
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
  if (lossFeedback || state == GAME_LEVEL_CLEARED) return false;
  if (strcmp(command, "START") == 0) {
    startGame();
  } else if (strcmp(command, "RESET") == 0) {
    resetToIdle();
  } else if (strcmp(command, "ARM") == 0 || strcmp(command, "KEY,A") == 0) {
    if (state != GAME_READY) return false;
    if (missingWiresMask() != 0) {
      playFeedbackTone(300, 300);
      return false;
    }
    beginLevel();
    return state == GAME_PLAYING;
  } else if (strcmp(command, "KEY,D") == 0 && (state == GAME_IDLE || state == GAME_WON || state == GAME_LOST)) {
    if (state == GAME_IDLE) startGame();
    else resetToIdle();
  } else if (state == GAME_PLAYING && strncmp(command, "KEY,", 4) == 0 && command[4] &&
             !command[5] && strchr("0123456789*#", command[4])) {
    return handleKeypad(command[4]);
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
  stopBuzzer();
  state = GAME_IDLE;
  level = 1;
  timeLeft = totalGameSeconds;
  pausedTickMillis = 0;
  totalWrongTries = 0;
  correctDecisions = 0;
  totalDecisions = 0;
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
  digitalWrite(BUZZER_PIN, LOW);
  buzzerReady = ledcAttach(BUZZER_PIN, 1200, 10);
  stopBuzzer();
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
  display.setTextWrap(false);

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
  if (buzzerDuration && millis() - buzzerStarted >= buzzerDuration) stopBuzzer();
  updateTimer(millis());
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
      if (state == GAME_PLAYING) {
        updateWarningBeep();
        updatePlayingScreen();
      }
      break;
    case GAME_LEVEL_CLEARED: {
      const unsigned long elapsed = millis() - feedbackStarted;
      if (elapsed >= LEVEL_CLEAR_MS) {
        ++level;
        enterReady();
      } else {
        const unsigned step = elapsed / (LEVEL_CLEAR_MS / LEVEL_CLEAR_STEPS);
        if (step != clearedStep) {
          clearedStep = step;
          showClearedScreen();
        }
      }
      break;
    }
    case GAME_WON:
      if (keypad.getKey() == 'D' || bootPressed) {
        resetToIdle();
      } else if (winSoundStep == 0 && millis() - feedbackStarted >= 220) {
        playFeedbackTone(1900, 200);
        ++winSoundStep;
      } else if (winSoundStep == 1 && millis() - feedbackStarted >= 440) {
        playFeedbackTone(2400, 400);
        ++winSoundStep;
      }
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
  stopBuzzer();
  lastBuzzerBeat = UINT32_MAX;
  ++runId;
  totalWrongTries = 0;
  correctDecisions = 0;
  totalDecisions = 0;
  level = 1;
  timeLeft = totalGameSeconds;
  lastTickMillis = millis();
  pausedTickMillis = 0;
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_GREEN, LOW);
  enterReady();   // level 1 also waits for the wires + the A key
}

void generateLevel() {
  // 1) random 4-digit code
  for (int i = 0; i < 4; i++) secretCode[i] = random(0, 10);
  codeBufLen = 0;
  codeBuffer[0] = '\0';
  wrongCodeTries = 0;
  codeSolved = false;

  // 2) shuffle the five wires and take this level's required number
  int pool[NUM_WIRES];
  for (int i = 0; i < NUM_WIRES; i++) pool[i] = i;
  for (int i = NUM_WIRES - 1; i > 0; i--) {
    int j = random(0, i + 1);
    int t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  requiredCount = WIRES_PER_LEVEL[level - 1];
  for (int i = 0; i < requiredCount; i++) requiredColors[i] = pool[i];

  // 3) take each level's prescribed card type for the shuffled colors.
  for (int i = 0; i < requiredCount; i++) {
    assignedCards[i] = CARDS_BY_KIND[CARD_KINDS_BY_LEVEL[level - 1][i]][requiredColors[i]];
  }

  // 4) record wire baseline (all should read LOW = wire plugged in)
  for (int i = 0; i < NUM_WIRES; i++) {
    wireBaseline[i] = digitalRead(wirePins[i]);
    wireCounted[i] = false;
    wireDebounce[i].reset();
  }
  wiresPulledCorrect = 0;

}

bool handleKeypad(char k) {
  if (!k) return false;
  const unsigned long now = millis();
  updateTimer(now);
  if (state != GAME_PLAYING || codeSolved) return false;

  if (k == '*') {
    codeBufLen = 0;
    codeBuffer[0] = '\0';
    changed = true;
  } else if (k >= '0' && k <= '9') {
    if (codeBufLen < 4) {
      codeBuffer[codeBufLen++] = k;
      codeBuffer[codeBufLen] = '\0';
      playFeedbackTone(1200, 40);
    }
    changed = true;
  } else if (k == '#') {
    if (codeBufLen == 4) {
      ++totalDecisions;
      bool match = true;
      for (int i = 0; i < 4; i++) {
        if (codeBuffer[i] - '0' != secretCode[i]) { match = false; break; }
      }
      if (match) {
        codeSolved = true;
        ++correctDecisions;
        playFeedbackTone(2000, 150);
        changed = true;
      } else {
        wrongCodeTries++;
        totalWrongTries++;
        changed = true;
        if (wrongCodeTries >= MAX_STRIKES) {
          explode("WRONG CODE 3X", "CODE");
          return true;
        }
        playFeedbackTone(300, 300);
      }
    }
    codeBufLen = 0;
    codeBuffer[0] = '\0';
    changed = true;
  } else {
    return false;
  }

  checkLevelComplete(now);
  return true;
}

void handleWires() {
  const unsigned long now = millis();
  updateTimer(now);
  if (state != GAME_PLAYING) return;
  for (int i = 0; i < NUM_WIRES; i++) {
    const bool open = digitalRead(wirePins[i]) == HIGH;
    if (!wireCounted[i] && wireBaseline[i] == LOW && wireDebounce[i].pulled(open, now)) {
      // this wire was just pulled
      wireCounted[i] = true;
      ++totalDecisions;
      changed = true;
      bool isRequired = false;
      for (int r = 0; r < requiredCount; r++) {
        if (requiredColors[r] == i) { isRequired = true; break; }
      }
      if (isRequired) {
        wiresPulledCorrect++;
        ++correctDecisions;
        playFeedbackTone(1800, 100);
      } else {
        explode("WRONG WIRE PULLED", "WIRE");
        return;
      }
    }
  }
  checkLevelComplete(now);
}

void checkLevelComplete(unsigned long now) {
  if (state != GAME_PLAYING) return;
  if (codeSolved && wiresPulledCorrect >= requiredCount) {
    changed = true;
    if (level >= 3) {
      winGame();
    } else {
      pausedTickMillis = now - lastTickMillis;
      state = GAME_LEVEL_CLEARED;
      feedbackStarted = now;
      clearedStep = 0;
      playFeedbackTone(1800, 160);
      showClearedScreen();
    }
  }
}

void updateTimer(unsigned long now) {
  if (state != GAME_PLAYING) return;
  const unsigned long elapsedSeconds = (now - lastTickMillis) / 1000;
  if (elapsedSeconds == 0) return;
  if (elapsedSeconds >= static_cast<unsigned long>(timeLeft)) {
    timeLeft = 0;
    explode("TIME'S UP", "TIME");
    return;
  }
  lastTickMillis += elapsedSeconds * 1000;
  timeLeft -= static_cast<long>(elapsedSeconds);
  changed = true;
}

unsigned long musicElapsedMillis() {
  return (totalGameSeconds - timeLeft) * 1000 + min(millis() - lastTickMillis, 999UL);
}

// `reason` is shown on the OLED; `tag` (CODE, WIRE or TIME) goes to the web page.
void explode(const char* reason, const char* tag) {
  pausedTickMillis = min(millis() - lastTickMillis, 999UL);
  state = GAME_LOST;
  lastLossTag = tag;
  changed = true;
  digitalWrite(LED_RED, HIGH);
  digitalWrite(LED_GREEN, LOW);
  playFeedbackTone(200, 2000);
  showResultScreen("FAILED", reason, false);
  Serial.print("EXPLODED: "); Serial.println(reason);

  lossFeedback = true;
  if (xTaskCreate([](void*) {
        popBalloon();
        lossFeedback = false;
        vTaskDelete(nullptr);
      }, "loss-feedback", 3072, nullptr, 1, nullptr) != pdPASS) lossFeedback = false;
}

void winGame() {
  pausedTickMillis = min(millis() - lastTickMillis, 999UL);
  state = GAME_WON;
  feedbackStarted = millis();
  winSoundStep = 0;
  playFeedbackTone(1500, 200);
  changed = true;
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(LED_RED, LOW);
  showResultScreen("DEFUSED", "All levels cleared", true);
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
  printCentered("Decidefer", 9, 2);
  printCentered("Dont stop talking", 30, 1);
  display.drawFastHLine(0, 43, SCREEN_WIDTH, SSD1306_WHITE);
  printCentered("D  Start setup", 52, 1);
  display.display();
}

void showResultScreen(const char* title, const char* detail, bool success) {
  display.clearDisplay();
  display.drawRect(4, 10, 12, 12, SSD1306_WHITE);
  if (success) {
    display.drawLine(6, 16, 9, 19, SSD1306_WHITE);
    display.drawLine(9, 19, 13, 13, SSD1306_WHITE);
  } else {
    display.drawFastVLine(9, 13, 4, SSD1306_WHITE);
    display.drawPixel(9, 18, SSD1306_WHITE);
  }
  printCentered(title, 8, 2);
  printCentered(detail, 31, 1);
  display.drawFastHLine(0, 43, SCREEN_WIDTH, SSD1306_WHITE);
  printCentered("D  Reset", 52, 1);
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
  char title[12];
  snprintf(title, sizeof(title), "LEVEL %d", level);
  display.clearDisplay();
  printCentered(title, 0, 2);
  printCentered(level == 1 ? "READY CHECK" : "TIMER PAUSED", 19, 1);
  display.drawFastHLine(0, 28, SCREEN_WIDTH, SSD1306_WHITE);
  if (missing == 0) {
    printCentered("All wires seated", 35, 1);
    printCentered("A  Begin level", 53, 1);
  } else {
    char names[2][22]{};
    for (int w = 0; w < NUM_WIRES; ++w) {
      if (!(missing & (1 << w))) continue;
      char* line = names[w < 3 ? 0 : 1];
      if (*line) strcat(line, "  ");
      strcat(line, colorNames[w]);
    }
    printCentered(names[0], 32, 1);
    printCentered(names[1], 41, 1);
    printCentered("Reconnect these wires", 55, 1);
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
  if (keypad.getKey() == 'A') {
    if (missing == 0) beginLevel();
    else playFeedbackTone(300, 300);
  }
}

void beginLevel() {
  generateLevel();        // new code and wires; the wire baseline is taken with every wire seated
  for (int i = 0; i < NUM_WIRES; i++) {
    if (wireBaseline[i] == HIGH) { enterReady(); return; }   // a wire wasn't really seated, so ask again
  }
  lastTickMillis = millis() - pausedTickMillis;
  state = GAME_PLAYING;
  playFeedbackTone(1500, 200);
  playingFrameValid = false;
  changed = true;
}

void showClearedScreen() {
  display.clearDisplay();
  printCentered("LEVEL OK", 13, 2);
  printCentered("Timer paused", 34, 1);
  printCentered("Reseat all wires", 50, 1);
  for (unsigned segment = 0; segment < LEVEL_CLEAR_STEPS; ++segment) {
    const int x = 41 + segment * 12;
    if (segment <= clearedStep) display.fillRect(x, 60, 10, 3, SSD1306_WHITE);
    else display.drawFastHLine(x, 61, 10, SSD1306_WHITE);
  }
  display.display();
}

void updatePlayingScreen() {
  static unsigned long lastDraw = 0;
  static long shownTime = 0;
  static int shownStrikes = 0;
  static int shownWires = 0;
  static bool shownSolved = false;
  static char shownEntry[sizeof(codeBuffer)]{};
  const unsigned long now = millis();
  if (playingFrameValid &&
      (now - lastDraw < 150 ||
       (shownTime == timeLeft && shownStrikes == wrongCodeTries && shownWires == wiresPulledCorrect &&
        shownSolved == codeSolved && strcmp(shownEntry, codeBuffer) == 0))) return;
  lastDraw = now;
  shownTime = timeLeft;
  shownStrikes = wrongCodeTries;
  shownWires = wiresPulledCorrect;
  shownSolved = codeSolved;
  strcpy(shownEntry, codeBuffer);
  playingFrameValid = true;

  char clockText[8];
  snprintf(clockText, sizeof(clockText), "%02u:%02u",
           static_cast<unsigned>(timeLeft / 60), static_cast<unsigned>(timeLeft % 60));
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(2, 0);
  display.print(clockText);
  display.setTextSize(1);
  display.setCursor(76, 0);
  display.print("LVL ");
  display.print(level);
  display.print("/3");
  display.setCursor(76, 9);
  display.print("STR ");
  for (int i = 0; i < MAX_STRIKES; ++i) {
    const int x = 101 + i * 8;
    display.drawRect(x, 9, 6, 6, SSD1306_WHITE);
    if (i < wrongCodeTries) display.fillRect(x + 1, 10, 4, 4, SSD1306_WHITE);
  }
  display.drawFastHLine(0, 17, SCREEN_WIDTH, SSD1306_WHITE);

  for (int i = 0; i < 4; i++) {
    const int x = 3 + i % 2 * 64;
    const int y = 20 + i / 2 * 10;
    display.setCursor(x, y);
    display.print(i + 1);
    const char* pattern = morseDigits[secretCode[i]];
    for (int mark = 0; mark < 5; ++mark) {
      const int markX = x + 13 + mark * 7;
      if (pattern[mark] == '.') display.fillRect(markX + 1, y + 2, 2, 2, SSD1306_WHITE);
      else display.fillRect(markX, y + 2, 5, 2, SSD1306_WHITE);
    }
  }
  display.drawFastHLine(0, 39, SCREEN_WIDTH, SSD1306_WHITE);
  display.setCursor(0, 43);
  display.print("CARDS");
  for (int i = 0; i < requiredCount; i++) {
    display.print(" ");
    if (assignedCards[i] < 10) display.print('0');
    display.print(assignedCards[i]);
  }
  display.setCursor(0, 55);
  display.print("CODE ");
  if (codeSolved) display.print("OK");
  else for (int i = 0; i < 4; ++i) display.print(i < codeBufLen ? codeBuffer[i] : '_');
  display.setCursor(78, 55);
  display.print("WIRE ");
  display.print(wiresPulledCorrect);
  display.print("/");
  display.print(requiredCount);
  display.display();
}
