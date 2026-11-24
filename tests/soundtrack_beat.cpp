#include "../bomb_defusal_final/SoundtrackBeat.h"

using SoundtrackBeat::at;

static_assert(at(0).beep && at(0).downbeat);
static_assert(!at(375).beep && at(750).beep);
static_assert(at(180000).beep && at(180375).beep);
static_assert(at(210000).downbeat && at(210000).step == at(209999).step + 1);
static_assert(!at(210172).beep && at(210343).beep);
static_assert(at(230058).beep && at(230229).beep);
