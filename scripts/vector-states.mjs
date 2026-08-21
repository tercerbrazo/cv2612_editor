/*
 * The shared vector-state spec: deterministic editor states used by the
 * golden CRC vectors AND the wire-level sync stream. The firmware's native
 * suite (cv2612_fw test/support/golden_state.h) constructs the same logical
 * states — change the formulas in BOTH repos or not at all.
 */
const op = (sid, cid, o) => ({
  mul: (sid + cid + o) % 16,
  det: (sid + o) % 8,
  tl: (sid * 20 + cid * 3 + o) % 128,
  ar: (cid + o * 2) % 32,
  rs: (sid + cid) % 4,
  d1: (o * 7 + sid) % 32,
  am: (cid + o) % 2,
  d2: (sid * 3 + cid) % 32,
  rr: (o + cid * 2) % 16,
  sl: (sid + o * 3) % 16,
})

const zeroOp = () => ({
  mul: 0, det: 0, tl: 0, ar: 0, rs: 0, d1: 0, am: 0, d2: 0, rr: 0, sl: 0,
})

const scene = (sid, rich) => ({
  lfo: rich ? sid % 8 : 0,
  channels: Array.from({ length: 6 }, (_, cid) => ({
    al: rich ? (sid + cid) % 8 : 0,
    fb: rich ? (cid * 2 + sid) % 8 : 0,
    ams: rich ? (sid + cid) % 4 : 0,
    fms: rich ? (sid * 2 + cid) % 8 : 0,
    operators: Array.from({ length: 4 }, (_, o) =>
      rich ? op(sid, cid, o) : zeroOp(),
    ),
  })),
})

const state = (rich) => ({
  pid: 0,
  patches: [
    {
      scenes: Array.from({ length: 4 }, (_, sid) => scene(sid, rich)),
      routing: [3, 3, 3, 3, 3, 3],
    },
  ],
  // vector 2: one binding per modulator incl. the index-0 (lfo) edge
  bindings: rich ? [[0, 11, 21], [13], [43]] : [[], [], []],
  settings: rich
    ? {
        pm: 4, rc: 16, tr: 64, tu: 70, lb: 100,
        // voice v holds steps v and v+8
        sequence: Array.from({ length: 6 }, (_, v) => {
          const steps = new Array(16).fill(0)
          steps[v] = 1
          steps[v + 8] = 1
          return steps
        }),
        stp: 5, portamento: 0, pbu: 12, pbd: 12, vs: 64,
        mmx: 2, mmy: 2, mmz: 2, qz: 3,
      }
    : {
        // vector 1 = the firmware's DEFAULT_SETTINGS, everything else zeroed
        pm: 0, rc: 16, tr: 64, tu: 64, lb: 127,
        // staircase default: voice v on step v
        sequence: Array.from({ length: 6 }, (_, v) => {
          const steps = new Array(16).fill(0)
          steps[v] = 1
          return steps
        }),
        stp: 5, portamento: 0, pbu: 12, pbd: 12, vs: 64,
        mmx: 2, mmy: 2, mmz: 2, qz: 0,
      },
})

// Golden CRC32 of each vector, pinned on both sides. The firmware suite
// (test_eeprom_crc.cpp) asserts the same numbers.
const EXPECTED = { default: 0x4cf61413, rich: 0x6e577108 }

export { state, EXPECTED }
