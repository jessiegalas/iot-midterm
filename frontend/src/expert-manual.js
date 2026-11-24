// Puzzle text from Player2_Manual_Expert_5wires.docx.
export const LOCKS = [
  "KEYWORD lock.  Write the keyword over and over underneath the note. Each note letter was pushed forward by the number of the keyword letter beneath it. To open it, pull each letter back by that number, wrapping from A back round to Z. Example: CAT with keyword BED becomes DEW (C+1, A+4, T+3).",
  "MIRROR.  Flip the alphabet end to end: A and Z swap, B and Y swap, C and X swap, and so on up to M and N. Example: CAT becomes XZG. Mirroring twice undoes itself.",
  "PUSH n.  Every letter moves forward n places, wrapping from Z to A. Example: CAT with PUSH 3 becomes FDW. To undo it, pull every letter back n places.",
  "MIRROR, then PUSH n.  The note was mirrored first and pushed second. To open it, undo them in the opposite order: pull back n first, then mirror.",
  "ZIGZAG r.  The note was written in a zigzag, down and up across r rows, then each row was read off left to right, top row first. To open it, rebuild the zigzag. Example with 3 rows: HELLOWORLD gives a top row HOL, a middle row ELWRD and a bottom row LO, so the locked note reads HOLELWRDLO.",
  "Opened notes come out as plain English with no spaces. Split them into words yourself, and read them carefully."
];

export const RIDDLE_CARDS = [
  {
    "id": 1,
    "lines": [
      "A locked note. Open it, then work out which wire it means.",
      "JLWMP YBSZE CBXWH BYR",
      "LOCK:  KEYWORD.",
      "CLUE:  The keyword is the surname of the scientist whose second law says force equals mass times acceleration.",
      "Once opened, the note describes a colour. Name it."
    ]
  },
  {
    "id": 2,
    "lines": [
      "Five tags. One correct wire.",
      "Five wires hang from the device and each wears a tag. Exactly ONE of the five tags is telling the truth, and exactly one wire is the correct one to pull.",
      "The stop-sign wire’s tag:  “The clear-sky wire’s tag is lying.”",
      "The coal wire’s tag:  “The clear-sky wire’s tag is telling the truth.”",
      "The clear-sky wire’s tag:  “The coal wire’s tag is telling the truth.”",
      "The snow wire’s tag:  “The correct wire is the coal wire or the clear-sky wire.”",
      "The amethyst wire’s tag:  “The correct wire is NOT the stop-sign wire.”",
      "Which wire is correct? Name its colour."
    ]
  },
  {
    "id": 3,
    "lines": [
      "A locked note. Open it, then work out which wire it means.",
      "RCJGF VESJN HVJY",
      "LOCK:  MIRROR, then PUSH N.",
      "CLUE:  N is the number of black keys in one octave of a piano, plus the number of Great Lakes.",
      "Once opened, the note describes a colour. Name it."
    ]
  },
  {
    "id": 4,
    "lines": [
      "Five tags. One correct wire.",
      "Five wires hang from the device and each wears a tag. Exactly FOUR of the five tags are telling the truth, and exactly one wire is the correct one to pull.",
      "The stop-sign wire’s tag:  “The snow wire’s tag is telling the truth.”",
      "The coal wire’s tag:  “The correct wire is the amethyst wire.”",
      "The clear-sky wire’s tag:  “The coal wire’s tag is lying.”",
      "The snow wire’s tag:  “The coal wire’s tag is lying.”",
      "The amethyst wire’s tag:  “The correct wire is the coal wire or the amethyst wire.”",
      "Which wire is correct? Name its colour."
    ]
  },
  {
    "id": 5,
    "lines": [
      "A locked note. Open it, then work out which wire it means.",
      "CRNLA NOSYE OK",
      "LOCK:  ZIGZAG R.",
      "CLUE:  R is the number of Fates in Greek mythology.",
      "Once opened, the note describes a colour. Name it."
    ]
  },
  {
    "id": 6,
    "lines": [
      "Five tags. One correct wire.",
      "Five wires hang from the device and each wears a tag. Exactly TWO of the five tags are telling the truth, and exactly one wire is the correct one to pull.",
      "The stop-sign wire’s tag:  “The correct wire is the stop-sign wire or the clear-sky wire.”",
      "The coal wire’s tag:  “The snow wire’s tag is telling the truth.”",
      "The clear-sky wire’s tag:  “The snow wire’s tag is telling the truth.”",
      "The snow wire’s tag:  “The clear-sky wire’s tag is telling the truth.”",
      "The amethyst wire’s tag:  “The correct wire is the clear-sky wire.”",
      "Which wire is correct? Name its colour."
    ]
  },
  {
    "id": 7,
    "lines": [
      "A locked note. Open it, then work out which wire it means.",
      "QENHG SDLCA VFQON",
      "LOCK:  KEYWORD.",
      "CLUE:  The keyword is the surname of the naturalist who wrote On the Origin of Species.",
      "Once opened, the note describes a colour. Name it."
    ]
  },
  {
    "id": 8,
    "lines": [
      "Five tags. One correct wire.",
      "Five wires hang from the device and each wears a tag. Exactly TWO of the five tags are telling the truth, and exactly one wire is the correct one to pull.",
      "The stop-sign wire’s tag:  “The correct wire is the amethyst wire.”",
      "The coal wire’s tag:  “The snow wire’s tag is lying.”",
      "The clear-sky wire’s tag:  “The correct wire is the snow wire or the amethyst wire.”",
      "The snow wire’s tag:  “The stop-sign wire’s tag is lying.”",
      "The amethyst wire’s tag:  “The coal wire’s tag is telling the truth.”",
      "Which wire is correct? Name its colour."
    ]
  },
  {
    "id": 9,
    "lines": [
      "A locked note. Open it, then work out which wire it means.",
      "IWEPB KQPCE WQPUV E",
      "LOCK:  MIRROR, then PUSH N.",
      "CLUE:  N is the number of planets in the solar system, plus the number of natural moons Earth has.",
      "Once opened, the note describes a colour. Name it."
    ]
  },
  {
    "id": 10,
    "lines": [
      "Five tags. One correct wire.",
      "Five wires hang from the device and each wears a tag. Exactly TWO of the five tags are telling the truth, and exactly one wire is the correct one to pull.",
      "The stop-sign wire’s tag:  “The clear-sky wire’s tag is telling the truth.”",
      "The coal wire’s tag:  “The stop-sign wire’s tag is lying.”",
      "The clear-sky wire’s tag:  “The stop-sign wire’s tag is telling the truth.”",
      "The snow wire’s tag:  “The correct wire is NOT the amethyst wire.”",
      "The amethyst wire’s tag:  “The snow wire’s tag is telling the truth.”",
      "Which wire is correct? Name its colour."
    ]
  }
];
