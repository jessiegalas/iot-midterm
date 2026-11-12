/*
  *** FINAL VERSION: all 3 levels + title screens + balloon-popper servo (GPIO23). ***
  - The titles shown on the OLED are set in the "Titles" section near the top.
  - Servo settings are in the "Balloon-popper servo" section.
  - Set SERVO_ENABLED to false to test the game without moving the servo.

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
  Board package: "esp32" by Espressif Systems
  Board selection in Arduino IDE: "ESP32 Dev Module"
  ====================================================================
*/

#include <Wire.h>
#include <Keypad.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

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
byte colPins[COLS] = {25, 33, 32, 4};
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
const bool SERVO_ENABLED = true;      // false = servo NEVER moves (use this while testing!)
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


// ---------------- The 6 defusal wires ----------------
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
// HOST LINK (USB serial, 115200 baud) - used by the web frontend
// ====================================================================
// Every machine-readable line the device prints starts with '@' so the web app
// can tell it apart from the human debug text. The game rules are NOT changed:
// the device stays in charge, the web page just mirrors it (and can press
// keypad keys / start the game for you).
//
// Device -> host (one line each):
//   @HELLO,1                                   protocol version (boot, and after SYNC)
//   @IDLE                                      title screen
//   @READY,level,missingWireMask,secs          waiting for wires + A (level = the one about to start)
//   @LEVEL,level,code,reqWireMask,cards,secs   level started; cards look like 1:5
//   @ENTRY,digits                              digits typed so far
//   @CODE,OK   |   @CODE,BAD,wrongTries
//   @WIRE,index,OK   |   @WIRE,index,BAD
//   @CLEAR,level                               level cleared
//   @TIME,secs                                 once per second while playing
//   @PROGRESS,entry,solved,wrong,pulledMask    only as part of a SYNC reply
//   @WON,secs   |   @LOST,CODE|WIRE|TIME
// Host -> device (end each line with a newline):
//   SYNC     re-send HELLO plus the current state
//   START    start a new game (same as D on the keypad), from any state
//   RESET    abort back to the title screen
//   ARM      same as pressing A (only works when every wire is seated)
//   KEY,x    same as pressing keypad key x  (0-9 * # A B C D)
// Wire index 0/1/2 = RED/BLACK/BLUE. In masks, bit i is wire i.
char hostBuf[16];
byte hostLen = 0;
bool hostSkip = false;   // true while throwing away an over-long line
char hostKey = 0;        // key injected by the web page; acts like a keypad press

// Physical keypad first, then a key sent from the web page.
char readKey() {
  char k = keypad.getKey();
  if (!k && hostKey) { k = hostKey; hostKey = 0; }
  return k;
}

void sendHello() { Serial.println("@HELLO,1"); }

void sendEntry() {
  Serial.print("@ENTRY,"); Serial.println(codeBuffer);
}

void sendReady(byte missing) {
  Serial.print("@READY,"); Serial.print(level); Serial.print(',');
  Serial.print(missing); Serial.print(','); Serial.println(timeLeft);
}

void sendLevel() {
  byte reqMask = 0;
  for (int i = 0; i < requiredCount; i++) reqMask |= (1 << requiredColors[i]);
  Serial.print("@LEVEL,"); Serial.print(level); Serial.print(',');
  for (int i = 0; i < 4; i++) Serial.print(secretCode[i]);
  Serial.print(','); Serial.print(reqMask); Serial.print(',');
  for (int i = 0; i < requiredCount; i++) {
    if (i) Serial.print(':');
    Serial.print(assignedCards[i]);
  }
  Serial.print(','); Serial.println(timeLeft);
}

void sendProgress() {
  byte pulled = 0;
  for (int i = 0; i < 3; i++) if (wireCounted[i]) pulled |= (1 << i);
  Serial.print("@PROGRESS,"); Serial.print(codeBuffer); Serial.print(',');
  Serial.print(codeSolved ? 1 : 0); Serial.print(',');
  Serial.print(wrongCodeTries); Serial.print(','); Serial.println(pulled);
}

// Lets a web page that connects in the middle of a game catch up.
void sendSnapshot() {
  switch (state) {
    case GAME_READY:   sendReady(missingWiresMask()); break;
    case GAME_PLAYING: sendLevel(); sendProgress(); break;
    default:           Serial.println("@IDLE"); break;   // idle, or a finished game
  }
}

void resetToIdle() {
  state = GAME_IDLE;
  hostKey = 0;
  noTone(BUZZER_PIN);
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_GREEN, LOW);
  showIdleScreen();
  Serial.println("@IDLE");
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

// Collects characters from the USB serial port; runs each complete line.
void pollHost() {
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

  showIdleScreen();
  sendHello();
  Serial.println("@IDLE");
}

// ====================================================================
// Start / reset: the D key on the keypad. The onboard BOOT button (GPIO0) still
// works too, as a backup in case the keypad ever misbehaves.
bool startPressed() {
  char k = readKey();
  return (k == 'D') || (digitalRead(START_BUTTON) == LOW);
}

void loop() {
  pollHost();   // commands from the web page (does nothing if no one is connected)
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

  // 2) pick `lvl` correct wire colors out of 6, no repeats
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
        Serial.println("@CODE,OK");
      } else {
        wrongCodeTries++;
        tone(BUZZER_PIN, 300, 300);
        Serial.print("@CODE,BAD,"); Serial.println(wrongCodeTries);
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
        Serial.print("@WIRE,"); Serial.print(i); Serial.println(",OK");
      } else {
        Serial.print("@WIRE,"); Serial.print(i); Serial.println(",BAD");
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
    Serial.print("@CLEAR,"); Serial.println(level);
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
    Serial.print("@TIME,"); Serial.println(timeLeft);
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
  Serial.print("@LOST,"); Serial.println(tag);   // before the slow balloon pop below
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
  Serial.print("@WON,"); Serial.println(timeLeft);
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
  if (mm < 10) display.print("0"); display.print(mm); display.print(":");
  if (ss < 10) display.print("0"); display.print(ss);

  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);

  // Morse code, one digit per line
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

  USB serial (115200 baud): the web frontend talks to the board over the
  same USB cable used for uploading - see "HOST LINK" above. Close the
  Arduino Serial Monitor before connecting the web page (only one program
  can use the port at a time).

  Buzzer (passive piezo): + -> GPIO15, - -> GND
  Red LED (through 220ohm resistor): anode -> GPIO12
  Green LED (through 220ohm resistor): anode -> GPIO2
  Start/Reset: the D key on the keypad (no extra wiring; the onboard BOOT button on GPIO0 also works as a backup)
  ====================================================================
*/
