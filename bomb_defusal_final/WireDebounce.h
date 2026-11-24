#pragma once
#include <stdint.h>

class WireDebounce {
 public:
  constexpr void reset() { pending = false; }

  constexpr bool pulled(bool open, uint32_t now) {
    if (!open) {
      reset();
      return false;
    }
    if (!pending) {
      pending = true;
      openedAt = now;
    }
    return now - openedAt >= 40;
  }

 private:
  bool pending = false;
  uint32_t openedAt = 0;
};
