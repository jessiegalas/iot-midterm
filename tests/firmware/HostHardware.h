#pragma once
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <fstream>
#include <string>
#include <vector>
#include "glcdfont.c"

using byte = uint8_t;
using std::min;
constexpr int HIGH = 1, LOW = 0, INPUT_PULLUP = 0, OUTPUT = 1;
constexpr int pdPASS = 1, SSD1306_SWITCHCAPVCC = 2, SSD1306_WHITE = 1;
inline unsigned long nowMillis = 0;
inline std::array<int, 40> pinState{};
inline std::deque<char> keysWaiting;
inline unsigned long millis() { return nowMillis; }
inline int digitalRead(int pin) { return pinState.at(pin); }
inline void digitalWrite(int pin, int value) { pinState.at(pin) = value; }
inline void pinMode(int, int) {}
inline unsigned toneRequests = 0;
inline void tone(int, unsigned, unsigned) { ++toneRequests; }
inline void noTone(int) {}
inline void delay(unsigned ms) { nowMillis += ms; }
inline void delayMicroseconds(unsigned) {}
inline int constrain(int value, int low, int high) { return std::clamp(value, low, high); }
inline int map(int value, int a, int b, int c, int d) { return c + (value - a) * (d - c) / (b - a); }
inline long random(long first, long end) { return first + std::rand() % (end - first); }
inline void randomSeed(unsigned value) { std::srand(value); }
inline unsigned esp_random() { return 42; }
inline int xTaskCreate(void (*)(void*), const char*, int, void*, int, void*) { return 0; }
inline void vTaskDelete(void*) {}

inline struct { uint64_t getEfuseMac() { return 1; } } ESP;
inline struct {
  std::deque<char> input;
  bool available() { return !input.empty(); }
  char read() { char key = input.front(); input.pop_front(); return key; }
  void begin(unsigned) {}
  void print(const char*) {}
  void println(const char*) {}
} Serial;
inline struct HostWire {
  void begin(int, int) {}
  void setClock(unsigned) {}
} Wire;

class Keypad {
 public:
  Keypad(char*, byte*, byte*, byte, byte) {}
  char getKey() {
    if (keysWaiting.empty()) return 0;
    char key = keysWaiting.front();
    keysWaiting.pop_front();
    return key;
  }
};
#define makeKeymap(layout) (&layout[0][0])

// The emulator uses the Adafruit fixed-width font and the same 6 x 8 character cells.
// The sketch runs normally. Only display I/O and hardware peripherals are simulated.
class Adafruit_SSD1306 {
 public:
  Adafruit_SSD1306(int, int, HostWire*, int) {}
  bool begin(int, int) { return true; }
  void clearDisplay() { pixels.fill(0); clipped = 0; wraps = 0; }
  void setTextColor(int value) { color = value; }
  void setTextSize(int value) { scale = value; }
  void setTextWrap(bool value) { wrap = value; }
  void setCursor(int x, int y) { column = x; row = y; }
  void drawPixel(int x, int y, int value) {
    if (x < 0 || y < 0 || x >= 128 || y >= 64) { ++clipped; return; }
    pixels[y * 128 + x] = value != 0;
  }
  void fillRect(int x, int y, int width, int height, int value) {
    for (int i = 0; i < width; ++i)
      for (int j = 0; j < height; ++j) drawPixel(x + i, y + j, value);
  }
  void drawFastHLine(int x, int y, int width, int value) { fillRect(x, y, width, 1, value); }
  void drawFastVLine(int x, int y, int height, int value) { fillRect(x, y, 1, height, value); }
  void drawRect(int x, int y, int width, int height, int value) {
    drawFastHLine(x, y, width, value);
    drawFastHLine(x, y + height - 1, width, value);
    drawFastVLine(x, y, height, value);
    drawFastVLine(x + width - 1, y, height, value);
  }
  void drawLine(int x, int y, int endX, int endY, int value) {
    const int dx = std::abs(endX - x), dy = -std::abs(endY - y);
    const int sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
    int error = dx + dy;
    for (;;) {
      drawPixel(x, y, value);
      if (x == endX && y == endY) break;
      const int twice = 2 * error;
      if (twice >= dy) { error += dy; x += sx; }
      if (twice <= dx) { error += dx; y += sy; }
    }
  }
  void print(char value) {
    if (value == '\n') { column = 0; row += 8 * scale; return; }
    if (wrap && column + 6 * scale > 128) { print('\n'); ++wraps; }
    for (int i = 0; i < 5; ++i) {
      const byte data = font[static_cast<byte>(value) * 5 + i];
      for (int j = 0; j < 8; ++j) {
        if (data & (1 << j)) fillRect(column + i * scale, row + j * scale, scale, scale, color);
      }
    }
    column += 6 * scale;
  }
  void print(const char* value) { while (*value) print(*value++); }
  void print(int value) { print(std::to_string(value).c_str()); }
  void println(const char* value) { print(value); print('\n'); }
  void display() { shown = pixels; ++frames; }
  void save(const std::string& path) const {
    std::ofstream out(path);
    out << "P1\n128 64\n";
    for (int y = 0; y < 64; ++y) {
      for (int x = 0; x < 128; ++x) out << 1 - shown[y * 128 + x] << ' ';
      out << '\n';
    }
  }
  int clipped = 0, wraps = 0, frames = 0;
  std::array<byte, 128 * 64> shown{};

 private:
  int column = 0, row = 0, scale = 1, color = 1;
  bool wrap = true;
  std::array<byte, 128 * 64> pixels{};
};

namespace BridgeTransport {
enum Source { USB, WIFI };
constexpr size_t FRAME_SIZE = 192;
inline unsigned connectedGeneration = 0;
inline std::vector<std::string> published;
struct Frame { unsigned generation = 0; char text[FRAME_SIZE]{}; };
struct LineReader {
  Frame frame;
  size_t length = 0;
  bool add(char ch) {
    if (ch == '\n') { frame.text[length] = '\0'; length = 0; return true; }
    if (length + 1 < sizeof(frame.text)) frame.text[length++] = ch;
    return false;
  }
};
inline void send(Source, const char* text) { published.emplace_back(text); }
inline void begin() {}
inline bool receiveWifi(Frame&) { return false; }
}
