#include "HostHardware.h"
#include "Sketch.h"

static int failures = 0;
static bool baseline = false;
static std::string output;

void expect(const char* label, bool pass, bool knownBaselineFailure = false) {
  const bool expected = !baseline || !knownBaselineFailure;
  std::printf("%s %s%s\n", pass == expected ? "PASS" : "FAIL", label,
              expected ? "" : " (baseline defect reproduced)");
  failures += pass != expected;
}

void step(unsigned long elapsed = 0, char key = 0) {
  nowMillis += elapsed;
  if (key) keysWaiting.push_back(key);
  loop();
}

void newLevel(int number) {
  pinState.fill(LOW);
  pinState[START_BUTTON] = HIGH;
  resetToIdle();
  startGame();
  level = number;
  step(200);
  step(200, 'A');
  step(200);
}

void enterCode() {
  for (int digit : secretCode) step(0, '0' + digit);
  step(0, '#');
}

void pullRequired() {
  for (int i = 0; i < requiredCount; ++i) pinState[wirePins[requiredColors[i]]] = HIGH;
  step();
  step(40);
}

void capture(const char* name) {
  display.save(output + "/" + name + ".pbm");
  std::printf("OLED %s: %d pixels clipped, %d text wraps\n", name, display.clipped, display.wraps);
}

int main(int argc, char** argv) {
  if (argc != 3) return 2;
  output = argv[1];
  baseline = std::string(argv[2]) == "baseline";
  pinState[START_BUTTON] = HIGH;
  pinState[BUZZER_PIN] = HIGH;
  setup();
  if (!baseline) expect("setup drives the buzzer pin low", digitalRead(BUZZER_PIN) == LOW);
  capture("idle");

  startGame();
  for (int pin : wirePins) pinState[pin] = HIGH;
  step(200);
  capture("ready-missing");
  step(0, 'A');
  expect("A refuses to start with wires missing", state == GAME_READY);
  for (int pin : wirePins) pinState[pin] = LOW;
  step(200);
  capture("ready-seated");
  if (!baseline) {
    bool fits = true;
    for (unsigned mask = 1; mask < 32; ++mask) {
      for (int wire = 0; wire < NUM_WIRES; ++wire) pinState[wirePins[wire]] = (mask >> wire) & 1;
      step(1);
      fits &= display.clipped == 0 && display.wraps == 0;
    }
    expect("all missing-wire lists fit the ready screen", fits);
    for (int pin : wirePins) pinState[pin] = LOW;
  }
  step(0, 'A');
  step(200);
  capture("playing");
  expect("playing framebuffer stays inside panel", display.clipped == 0, true);
  if (!baseline) {
    const int frames = display.frames;
    step(160);
    expect("unchanged playing screen skips I2C flush", display.frames == frames);
    step(0, '0');
    expect("changed entry redraws when cadence allows it", display.frames == frames + 1);
    step(0, '1');
    expect("playing redraw stays within cadence", display.frames == frames + 1);
    step(150);
    expect("pending entry redraws after cadence", display.frames == frames + 2);
    requiredCount = 5;
    for (int i = 0; i < requiredCount; ++i) assignedCards[i] = 2 * (i + 1);
    codeSolved = true;
    wrongCodeTries = 2;
    wiresPulledCorrect = 4;
    step(150);
    capture("playing-five-cards");
    expect("five cards fit without wrapping", display.clipped == 0 && display.wraps == 0);
  }

  newLevel(1);
  enterCode();
  const bool bridgeAccepted = applyCommand("KEY,1");
  for (int i = 0; i < 3; ++i) {
    const char digit = secretCode[0] == 0 ? '1' : '0';
    for (int j = 0; j < 4; ++j) step(0, digit);
    step(0, '#');
  }
  expect("completed code ignores keypad and bridge input",
         !bridgeAccepted && state == GAME_PLAYING && wrongCodeTries == 0, true);

  newLevel(1);
  step(999);
  enterCode();
  pullRequired();
  capture("cleared");
  expect("level-clear title remains on one line", display.wraps == 0, true);
  const long clearedTime = timeLeft;
  if (baseline) step(900);
  else {
    const int frames = display.frames;
    step(224);
    expect("level-clear animation waits for its next frame", display.frames == frames);
    step(1);
    expect("level-clear animation advances without advancing the timer", display.frames == frames + 1 && timeLeft == clearedTime);
    step(675);
  }
  step(8000);
  expect("level clear preserves the timer through reseating", state == GAME_READY && timeLeft == clearedTime);
  for (int pin : wirePins) pinState[pin] = LOW;
  step(0, 'A');
  step(1000);
  expect("armed level resumes the shared timer", state == GAME_PLAYING && timeLeft == clearedTime - 1);

  newLevel(3);
  for (int digit : secretCode) step(0, '0' + digit);
  pullRequired();
  timeLeft = 1;
  lastTickMillis = nowMillis;
  step(1000, '#');
  expect("physical submit at deadline loses to timeout", state == GAME_LOST && timeLeft == 0, true);

  newLevel(3);
  for (int digit : secretCode) step(0, '0' + digit);
  pullRequired();
  timeLeft = 1;
  lastTickMillis = nowMillis;
  nowMillis += 1000;
  expect("bridge submit at deadline is refused",
         !applyCommand("KEY,#") && state == GAME_LOST && timeLeft == 0, true);

  newLevel(3);
  enterCode();
  timeLeft = 1;
  lastTickMillis = nowMillis;
  for (int i = 0; i < requiredCount; ++i) pinState[wirePins[requiredColors[i]]] = HIGH;
  step(960);
  step(40);
  expect("debounced wire pull at deadline loses to timeout", state == GAME_LOST && timeLeft == 0, true);

  newLevel(1);
  timeLeft = 4;
  lastTickMillis = nowMillis;
  step(5500);
  expect("late loop catches up immediately without negative time", state == GAME_LOST && timeLeft == 0, true);
  for (int i = 0; i < 5 && state == GAME_PLAYING; ++i) step(1000);
  capture("lost-time");

  newLevel(2);
  int wrongWire = 0;
  while (std::find(requiredColors, requiredColors + requiredCount, wrongWire) != requiredColors + requiredCount) {
    if (++wrongWire == NUM_WIRES) { requiredCount = 1; wrongWire = (requiredColors[0] + 1) % NUM_WIRES; break; }
  }
  pinState[wirePins[wrongWire]] = HIGH;
  step();
  step(40);
  expect("wrong wire ends the run", state == GAME_LOST && std::strcmp(lastLossTag, "WIRE") == 0);
  capture("lost-wire");

  newLevel(1);
  step(0, '#');
  expect("incomplete submission consumes no strike", wrongCodeTries == 0);
  for (int i = 0; i < 3; ++i) {
    for (int digit : secretCode) step(0, '0' + (digit + 1) % 10);
    step(0, '#');
  }
  expect("third incorrect code ends the run", state == GAME_LOST && std::strcmp(lastLossTag, "CODE") == 0);
  capture("lost-code");

  const int expectedCounts[] = {1, 2, 2};
  bool pacing = true, matching = true;
  for (int i = 1; i <= 3; ++i) {
    for (int run = 0; run < 8; ++run) {
      newLevel(i);
      pacing &= requiredCount == expectedCounts[i - 1];
      bool used[NUM_WIRES]{};
      for (int j = 0; j < requiredCount; ++j) {
        const int color = requiredColors[j];
        matching &= !used[color] && (assignedCards[j] - 1) / 2 == color;
        used[color] = true;
      }
    }
  }
  expect("student pacing is 1, 2, 2 across multiple runs", pacing, true);
  expect("required wire colours are unique and map to their cards", matching);

  enterCode();
  pullRequired();
  expect("final level accepts valid code and wires before deadline", state == GAME_WON);
  step(220);
  step(220);
  capture("won");

  if (!baseline) {
    newLevel(1);
    for (int round = 1; round <= 3; ++round) {
      if (round == 2) {
        pullRequired();
        enterCode();
      } else {
        enterCode();
        pullRequired();
      }
      if (round != 3) {
        expect("completed level enters the reseating transition", state == GAME_LEVEL_CLEARED);
        step(900);
        for (int pin : wirePins) pinState[pin] = LOW;
        step(0, 'A');
      }
    }
    expect("three-level run wins with one shared clock", state == GAME_WON && level == 3 && timeLeft > 0);
  }

  newLevel(1);
  timeLeft = 2;
  nowMillis = 0xFFFFFF00UL;
  lastTickMillis = nowMillis;
  step(1000);
  expect("tick survives unsigned millisecond rollover", timeLeft == 1 && state == GAME_PLAYING);
  step(1000);
  expect("rollover preserves exact timeout", timeLeft == 0 && state == GAME_LOST);
  if (!baseline) expect("buzzer stays silent through setup, play, and results", toneRequests == 0 && digitalRead(BUZZER_PIN) == LOW);
  return failures != 0;
}
