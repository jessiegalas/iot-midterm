#pragma once

#include <stdint.h>

namespace SoundtrackBeat {
constexpr uint32_t MAIN_BPM = 160;
constexpr uint32_t CLIMAX_BPM = 175;
constexpr uint32_t ONE_MINUTE_LEFT_MS = 180000;
constexpr uint32_t CLIMAX_START_MS = 210000;
constexpr uint32_t LAST_TEN_SECONDS_MS = 230000;

struct Beat {
  uint32_t step;
  bool beep;
  bool downbeat;
};

constexpr Beat at(uint32_t elapsedMs) {
  const bool climax = elapsedMs >= CLIMAX_START_MS;
  const uint32_t segmentMs = climax ? elapsedMs - CLIMAX_START_MS : elapsedMs;
  const uint32_t bpm = climax ? CLIMAX_BPM : MAIN_BPM;
  const uint32_t eighth = segmentMs * bpm * 2 / 60000;
  const uint32_t beatsBetweenTicks = elapsedMs < ONE_MINUTE_LEFT_MS ? 4 : elapsedMs < LAST_TEN_SECONDS_MS ? 2 : 1;
  const uint32_t segmentOffset = climax ? CLIMAX_START_MS * MAIN_BPM * 2 / 60000 : 0;
  return {segmentOffset + eighth, eighth % beatsBetweenTicks == 0, eighth % 8 == 0};
}
}
