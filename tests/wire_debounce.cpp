#include "../bomb_defusal_final/WireDebounce.h"

constexpr bool ignoresBriefOpensAndAcceptsStablePull() {
  WireDebounce wire;
  return !wire.pulled(true, 0) && !wire.pulled(true, 39) && !wire.pulled(false, 39)
      && !wire.pulled(true, 42) && !wire.pulled(true, 81) && wire.pulled(true, 82);
}

constexpr bool handlesCounterWrapAndLevelReset() {
  WireDebounce wire;
  if (wire.pulled(true, UINT32_MAX - 19) || wire.pulled(true, 19) || !wire.pulled(true, 20)) return false;
  wire.reset();
  return !wire.pulled(true, 21);
}

static_assert(ignoresBriefOpensAndAcceptsStablePull(), "Only stable opens should count");
static_assert(handlesCounterWrapAndLevelReset(), "Debounce must handle clock wrap and level reset");
