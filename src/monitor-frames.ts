/*
 * Binary-frame demultiplexer for the CV2612 firmware's DBG_STATE telemetry.
 *
 * Wire format (little-endian):
 *   0xAA | ver=1 | type | len | payload[len] | xor
 * where xor is the XOR of type, len and every payload byte (ver excluded).
 *
 * Types:
 *   'K' 0x4B keyframe — full state snapshot, two lengths on the wire
 *       (versioned by len, same pattern as 'V'):
 *       len = 27 (legacy): u16 pitchRaw | u16 cv | i16 bend | i8 K | i8 aX |
 *       i8 aY | i8 aZ | u8 X | u8 Y | u8 Z |
 *       u8 jackFlags(bit0=X,1=Y,2=Z,3=button,4=gate,
 *       5=aX/6=aY/7=aZ trimmer wiper open) |
 *       i8 modW | i8 modX | i8 modY | i8 modZ | u8 note |
 *       u8 modeQuant(mode bits0-2, quantize bits3-5) | u8 tu | u8 tr |
 *       u8 TL0 | u8 TL3 | u16 loopRate | u8 dropCount
 *       len = 29 (v2): the legacy 27 bytes followed by u16 pitchRest — the
 *       firmware's calibration.pitch_rest, the per-unit calibrated resting
 *       level of the pitch input (inputs.pitch domain).
 *   'D' 0x44 delta (len = 3..21) — u16 bitmask (bit i = i-th field of the
 *       first 16 logical
 *       fields: pitchRaw,cv,bend,K,aX,aY,aZ,X,Y,Z,jackFlags,modW,modX,modY,
 *       modZ,note) followed by only those fields' bytes, in field order.
 *       The payload length must equal 2 + the summed width of the masked
 *       fields. Applied on top of the last keyframe state; deltas arriving
 *       before any keyframe are dropped (nothing to merge onto).
 *   'E' 0x45 event (len = 2) — u8 kind (1=noteOn, 2=noteOff, 3=modeChange,
 *       4=instrumentLoad, 5=eepromRestore) + u8 value. For kind 4 the value
 *       packs (slot << 6) | instrument: slot 0-3 = config-mode target A-D,
 *       instrument 0-41 = main-knob dial position (0 = EEPROM-restore
 *       position, 1-41 = the editor's instrument bank, 1-based). For kind 5
 *       the value is the slot (0-3) restored from EEPROM.
 *   'V' 0x56 voices — two lengths on the wire:
 *       len = 7 (legacy): u8 note ×6 (voices 0..5) followed by a u8 gate
 *       bitmask (bit i set = voice i gated/sounding).
 *       len = 19 (v2): the legacy 7 bytes followed by u16 cv ×6 — each
 *       voice's FINAL pitch in CV counts (8 counts/semitone, 96/octave,
 *       A4 = 440Hz at cv = 456), i.e. MIDI note + analog CV + tuning +
 *       transpose + bend + play-mode intervals, per voice.
 *   'P' 0x50 patch (len = 27) — u8 channel (0..5) followed by the module's
 *       26-byte channel_t verbatim (the same byte layout the editor encodes
 *       for the CRC32 sync check, see src/utils/checksum.ts):
 *       FB_ALG | LR_AMS_FMS | 4 × (DT1_MUL, TL, RS_AR, AM_D1R, D2R, D1L_RR).
 *       The firmware rotates through the 6 channels (~1 per second), so a
 *       full chip snapshot refreshes every ~6s.
 *
 * The serial stream interleaves these frames with plain ASCII debug lines:
 * any byte that is not part of a valid frame is routed to an ASCII line
 * accumulator (printable chars + tab kept, '\n' terminates a line, all other
 * bytes discarded). A bad checksum or malformed header resyncs by rescanning
 * from the byte after the candidate 0xAA.
 */

export type MonitorState = {
  pitchRaw: number // pitch ADC raw 0..1023
  cv: number // final pitch CV
  bend: number // pitch bend, signed
  k: number // main knob -128..127
  ax: number // attenuverters -128..127
  ay: number
  az: number
  x: number // mod CV inputs 0..255
  y: number
  z: number
  xConn: boolean // jack detection flags
  yConn: boolean
  zConn: boolean
  button: boolean // raw logical button state (jackFlags bit 3)
  gate: boolean // raw gate input state (jackFlags bit 4)
  // trimmer wiper physically disconnected (dying pot), detected by the
  // firmware's ADC charge probe — jackFlags bits 5/6/7
  axOpen: boolean
  ayOpen: boolean
  azOpen: boolean
  modW: number // effective mod values -128..127
  modX: number
  modY: number
  modZ: number
  note: number
  mode: number // play mode 0..6 (modeQuant bits 0-2)
  quantize: number // modeQuant bits 3-5: 0 = off, 1 = chromatic, 2.. = scale
  tu: number // tuning
  tr: number // transpose
  tl0: number // live morphed TL ch0 op0
  tl3: number // live morphed TL ch0 op3
  loopRate: number // main loop iterations per second
  dropCount: number // frames the firmware failed to send
  // calibrated pitch rest (v2 keyframes only; null until one arrives —
  // legacy len-27 firmware never sends it)
  pitchRest: number | null
  ledBright: number // settings.led_brightness (v3 keyframes)
  bindMask: number // X/Y/Z bound-to-anything, bits 0-2 (v3 keyframes)
  rawX: number // cv_x.raw, ADC pre-cal: 0=-5V,512=0V,1023=+5V (v4 keyframes)
  rawY: number
  rawZ: number
  stackFree: number | null // free SRAM under the stack, bytes (v5 keyframes; null = pre-v5 fw)
}

export type StateFrame = {
  type: 'state'
  frame: 'K' | 'D'
  state: MonitorState
  // FIELD_BITS bitmask of the fields this frame changed: for deltas it is
  // the wire bitmask verbatim; for keyframes it is a diff against the
  // previous merged state (0 on the first keyframe — nothing to compare)
  changed: number
}

// bit positions for StateFrame.changed — bits 0..15 mirror the delta wire
// bitmask, 16+ cover the keyframe-only tail fields
export const FIELD_BITS = {
  pitchRaw: 0,
  cv: 1,
  bend: 2,
  k: 3,
  ax: 4,
  ay: 5,
  az: 6,
  x: 7,
  y: 8,
  z: 9,
  jack: 10,
  modW: 11,
  modX: 12,
  modY: 13,
  modZ: 14,
  note: 15,
  mode: 16,
  tu: 17,
  tr: 18,
  tl0: 19,
  tl3: 20,
  pitchRest: 21,
  ledBright: 22,
  bindMask: 23,
  rawX: 24,
  rawY: 25,
  rawZ: 26,
  stackFree: 27,
} as const

export type EventFrame = {
  type: 'event'
  kind: number // 1=noteOn 2=noteOff 3=modeChange
  value: number
}

export type VoicesFrame = {
  type: 'voices'
  notes: number[] // 6 entries, note number per voice
  gates: boolean[] // 6 entries, true = voice gated (sounding)
  cvs?: number[] // v2 frames only: 6 entries, final pitch CV per voice
}

// one decoded YM2612 operator (fields named as in the editor's patch model)
export type PatchOp = {
  mul: number // multiplier 0..15
  det: number // detune 0..7
  tl: number // total level 0..127
  ar: number // attack rate 0..31
  rs: number // rate scaling 0..3
  d1: number // decay-1 rate 0..31
  am: number // amplitude modulation 0..1
  d2: number // decay-2 rate 0..31
  rr: number // release rate 0..15
  sl: number // sustain level (D1L) 0..15
}

// one decoded channel_t: what the chip is actually playing on this channel
export type PatchChannelState = {
  al: number // algorithm 0..7
  fb: number // feedback 0..7
  fms: number // FM sensitivity 0..7
  ams: number // AM sensitivity 0..3
  lr: number // stereo routing 0..3 (bit1=L, bit0=R)
  ops: PatchOp[] // 4 operators
}

export type PatchFrame = {
  type: 'patch'
  channel: number // 0..5
  ch: PatchChannelState
  raw: Uint8Array // the 26 channel_t bytes verbatim (copied)
}

/*
 * Decode a 26-byte channel_t. Byte layout mirrors the editor's CRC32
 * encoder (src/utils/checksum.ts) — this is its exact inverse:
 *   [0]      ch_fb_alg_t:     ALG bits 0-2 | FB bits 3-5
 *   [1]      ch_lr_ams_fms_t: FMS bits 0-2 | AMS bits 3-4 | LR bits 6-7
 *   [2+6i+0] op_dt1_mul_t:    MUL bits 0-3 | DT1 bits 4-6
 *   [2+6i+1] op_tl_t:         TL bits 0-6
 *   [2+6i+2] op_rs_ar_t:      AR bits 0-4 | RS bits 6-7
 *   [2+6i+3] op_am_d1r_t:     D1R bits 0-4 | AM bit 7
 *   [2+6i+4] op_d2r_t:        D2R bits 0-4
 *   [2+6i+5] op_d1l_rr_t:     RR bits 0-3 | D1L bits 4-7
 */
export const CHANNEL_T_LEN = 26
export const decodePatchChannel = (b: Uint8Array): PatchChannelState => ({
  al: b[0] & 7,
  fb: (b[0] >> 3) & 7,
  fms: b[1] & 7,
  ams: (b[1] >> 3) & 3,
  lr: (b[1] >> 6) & 3,
  ops: Array.from({ length: 4 }, (_, i) => {
    const o = 2 + i * 6
    return {
      mul: b[o] & 15,
      det: (b[o] >> 4) & 7,
      tl: b[o + 1] & 0x7f,
      ar: b[o + 2] & 31,
      rs: (b[o + 2] >> 6) & 3,
      d1: b[o + 3] & 31,
      am: (b[o + 3] >> 7) & 1,
      d2: b[o + 4] & 31,
      rr: b[o + 5] & 15,
      sl: (b[o + 5] >> 4) & 15,
    }
  }),
})

// ---------------------------------------------------------------------------
// pitch CV math — the firmware's unified pitch model: 8 CV counts per
// semitone, 96 per octave; A4 (MIDI 69, 440Hz) sits at cv = 456
// ---------------------------------------------------------------------------
export const CV_PER_SEMITONE = 8
export const CV_PER_OCTAVE = 96
export const CV_A4 = 456
export const CENTS_PER_COUNT = 12.5 // 100 cents / 8 counts

/* final pitch CV → frequency in Hz */
export const freqHz = (cv: number): number =>
  440 * 2 ** ((cv - CV_A4) / CV_PER_OCTAVE)

/* MIDI note → the CV that note alone would produce (no CV/tune/transpose) */
export const baseCv = (note: number): number => (note - 12) * CV_PER_SEMITONE

/*
 * Everything non-MIDI shifting a voice — analog CV, tuning, transpose, bend,
 * play-mode intervals (DUO/TRIO/CHORD) — in cents relative to the voice's
 * MIDI base note.
 */
export const centsOffset = (cv: number, note: number): number =>
  (cv - baseCv(note)) * CENTS_PER_COUNT

/* Rest assumed when the firmware predates the calibrated-rest keyframe */
export const PITCH_REST_FALLBACK = 50
/* The firmware clamps a deviation this small to zero (pitch_deviation()) */
export const PITCH_REST_DEADBAND = 1

/*
 * Cents the pitch input contributes, mirroring the firmware's rest deadband:
 * at rest the ADC dithers +-1 count, which the module ignores, so reporting
 * those 12.5 cents here would contradict the voices' own (correct) 0c.
 */
export const pitchDevCents = (
  pitchRaw: number,
  pitchRest: number | null,
): number => {
  const dev = pitchRaw - (pitchRest ?? PITCH_REST_FALLBACK)
  return Math.abs(dev) <= PITCH_REST_DEADBAND ? 0 : dev * CENTS_PER_COUNT
}

export type ParsedFrame = StateFrame | EventFrame | VoicesFrame | PatchFrame

export type FeedResult = { frames: ParsedFrame[]; textLines: string[] }

export const QUANTIZE_NAMES = [
  'off',
  'chromatic',
  'major',
  'nat. minor',
  'harm. minor',
  'dorian',
  'pent. major',
  'pent. minor',
]

export const EVENT_KINDS: Record<number, string> = {
  1: 'noteOn',
  2: 'noteOff',
  3: 'modeChange',
  4: 'instrumentLoad',
  5: 'eepromRestore',
}

// config-mode target slots, in firmware order
export const SLOT_NAMES = ['A', 'B', 'C', 'D'] as const

/*
 * Event kind 4 (instrumentLoad) packs its value as (slot << 6) | instrument:
 * slot 0-3 = A/B/C/D, instrument 0-41 = main-knob dial position (0 is the
 * EEPROM-restore notch, 1-41 map 1-based onto the editor's instrument bank).
 */
export const unpackInstrumentEvent = (
  value: number,
): { slot: number; instrument: number } => ({
  slot: (value >> 6) & 3,
  instrument: value & 63,
})

// firmware play_mode_t order (src/types.h)
export const PLAY_MODES = [
  'MONO',
  'DUO',
  'TRIO',
  'CHORD',
  'SEQ',
  'RAND',
  'POLY',
]
export const modeName = (m: number): string => PLAY_MODES[m] ?? `?${m}`

const SOF = 0xaa
const VERSION = 1
const TYPE_KEY = 0x4b // 'K'
const TYPE_DELTA = 0x44 // 'D'
const TYPE_EVENT = 0x45 // 'E'
const TYPE_VOICES = 0x56 // 'V'
const TYPE_PATCH = 0x50 // 'P'

const readU16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8)

// a field reader: byte width, signedness and how it lands on the state
type Field = {
  size: 1 | 2
  signed?: boolean
  apply: (s: MonitorState, v: number) => void
}

type NumKey = {
  [K in keyof MonitorState]: MonitorState[K] extends number ? K : never
}[keyof MonitorState]

const F = (key: NumKey, size: 1 | 2 = 1, signed = false): Field => ({
  size,
  signed,
  apply: (s, v) => {
    s[key] = v
  },
})

const jackField: Field = {
  size: 1,
  apply: (s, v) => {
    s.xConn = (v & 1) !== 0
    s.yConn = (v & 2) !== 0
    s.zConn = (v & 4) !== 0
    s.button = (v & 8) !== 0
    s.gate = (v & 16) !== 0
    s.axOpen = (v & 32) !== 0
    s.ayOpen = (v & 64) !== 0
    s.azOpen = (v & 128) !== 0
  },
}

const modeQuantField: Field = {
  size: 1,
  apply: (s, v) => {
    s.mode = v & 7
    s.quantize = (v >> 3) & 7
  },
}

// v2 keyframe tail: calibrated pitch rest (typed number | null on the state,
// so it lives outside the NumKey-driven F() helper)
const pitchRestField: Field = {
  size: 2,
  apply: (s, v) => {
    s.pitchRest = v
  },
}

// the 16 delta-addressable fields, in bitmask bit order
const DELTA_FIELDS: Field[] = [
  F('pitchRaw', 2),
  F('cv', 2),
  F('bend', 2, true),
  F('k', 1, true),
  F('ax', 1, true),
  F('ay', 1, true),
  F('az', 1, true),
  F('x'),
  F('y'),
  F('z'),
  jackField,
  F('modW', 1, true),
  F('modX', 1, true),
  F('modY', 1, true),
  F('modZ', 1, true),
  F('note'),
]

// keyframe layout = the delta fields followed by the snapshot-only tail
const KEY_FIELDS: Field[] = [
  ...DELTA_FIELDS,
  modeQuantField,
  F('tu'),
  F('tr'),
  F('tl0'),
  F('tl3'),
  F('loopRate', 2),
  F('dropCount'),
]

// v2 keyframes append the calibrated pitch rest
const KEY_FIELDS_V2: Field[] = [...KEY_FIELDS, pitchRestField]

// v3 keyframes append LED brightness + the bindable-source mask (config state)
const KEY_FIELDS_V3: Field[] = [...KEY_FIELDS_V2, F('ledBright'), F('bindMask')]

// v4 keyframes append the raw mod-CV ADCs (pre-calibration, 2 bytes each)
const KEY_FIELDS_V4: Field[] = [
  ...KEY_FIELDS_V3,
  F('rawX', 2),
  F('rawY', 2),
  F('rawZ', 2),
]

// v5 keyframes append u16 stackFree: free SRAM at send depth (FreeStack, bench sizing)
const KEY_FIELDS_V5: Field[] = [...KEY_FIELDS_V4, F('stackFree', 2)]

export const KEYFRAME_LEN = KEY_FIELDS.reduce((n, f) => n + f.size, 0) // 27
export const KEYFRAME_LEN_V2 = KEY_FIELDS_V2.reduce((n, f) => n + f.size, 0) // 29
export const KEYFRAME_LEN_V3 = KEY_FIELDS_V3.reduce((n, f) => n + f.size, 0) // 31
export const KEYFRAME_LEN_V4 = KEY_FIELDS_V4.reduce((n, f) => n + f.size, 0) // 37
export const KEYFRAME_LEN_V5 = KEY_FIELDS_V5.reduce((n, f) => n + f.size, 0) // 39
const DELTA_FIELDS_LEN = DELTA_FIELDS.reduce((n, f) => n + f.size, 0) // 19
const DELTA_MIN_LEN = 3 // bitmask + at least one 1-byte field
const DELTA_MAX_LEN = 2 + DELTA_FIELDS_LEN // bitmask + all 16 fields
const EVENT_LEN = 2
export const NUM_VOICES = 6
const VOICES_LEN = NUM_VOICES + 1 // legacy: 6 notes + gate bitmask
const VOICES_LEN_V2 = VOICES_LEN + NUM_VOICES * 2 // + 6× u16 cv = 19
export const PATCH_LEN = 1 + CHANNEL_T_LEN // u8 channel + channel_t = 27

const ZERO_STATE: MonitorState = {
  pitchRaw: 0,
  cv: 0,
  bend: 0,
  k: 0,
  ax: 0,
  ay: 0,
  az: 0,
  x: 0,
  y: 0,
  z: 0,
  xConn: false,
  yConn: false,
  zConn: false,
  button: false,
  gate: false,
  axOpen: false,
  ayOpen: false,
  azOpen: false,
  modW: 0,
  modX: 0,
  modY: 0,
  modZ: 0,
  note: 0,
  mode: 0,
  quantize: 0,
  tu: 0,
  tr: 0,
  tl0: 0,
  tl3: 0,
  loopRate: 0,
  dropCount: 0,
  pitchRest: null,
  ledBright: 0,
  bindMask: 0,
  rawX: 0,
  rawY: 0,
  rawZ: 0,
  stackFree: null,
}

// numeric fields compared by keyframe diffing, with their FIELD_BITS bit
const DIFF_KEYS: [NumKey, number][] = [
  ['pitchRaw', FIELD_BITS.pitchRaw],
  ['cv', FIELD_BITS.cv],
  ['bend', FIELD_BITS.bend],
  ['k', FIELD_BITS.k],
  ['ax', FIELD_BITS.ax],
  ['ay', FIELD_BITS.ay],
  ['az', FIELD_BITS.az],
  ['x', FIELD_BITS.x],
  ['y', FIELD_BITS.y],
  ['z', FIELD_BITS.z],
  ['modW', FIELD_BITS.modW],
  ['modX', FIELD_BITS.modX],
  ['modY', FIELD_BITS.modY],
  ['modZ', FIELD_BITS.modZ],
  ['note', FIELD_BITS.note],
  ['tu', FIELD_BITS.tu],
  ['tr', FIELD_BITS.tr],
  ['tl0', FIELD_BITS.tl0],
  ['tl3', FIELD_BITS.tl3],
]

const diffStates = (a: MonitorState, b: MonitorState): number => {
  let m = 0
  for (const [key, bit] of DIFF_KEYS) if (a[key] !== b[key]) m |= 1 << bit
  if (
    a.xConn !== b.xConn ||
    a.yConn !== b.yConn ||
    a.zConn !== b.zConn ||
    a.button !== b.button ||
    a.gate !== b.gate ||
    a.axOpen !== b.axOpen ||
    a.ayOpen !== b.ayOpen ||
    a.azOpen !== b.azOpen
  )
    m |= 1 << FIELD_BITS.jack
  if (a.mode !== b.mode || a.quantize !== b.quantize) m |= 1 << FIELD_BITS.mode
  if (a.pitchRest !== b.pitchRest) m |= 1 << FIELD_BITS.pitchRest
  if (a.ledBright !== b.ledBright) m |= 1 << FIELD_BITS.ledBright
  if (a.bindMask !== b.bindMask) m |= 1 << FIELD_BITS.bindMask
  if (a.rawX !== b.rawX) m |= 1 << FIELD_BITS.rawX
  if (a.rawY !== b.rawY) m |= 1 << FIELD_BITS.rawY
  if (a.rawZ !== b.rawZ) m |= 1 << FIELD_BITS.rawZ
  return m
}

const readField = (f: Field, p: Uint8Array, o: number): number => {
  let v = f.size === 2 ? readU16(p, o) : p[o]
  if (f.signed) v = f.size === 2 ? (v << 16) >> 16 : (v << 24) >> 24
  return v
}

const MAX_PENDING_TEXT = 1024

// a checksum-valid delta whose bitmask disagrees with its length means the
// firmware and this parser disagree on field widths (protocol drift).
// warn once per session so it surfaces without flooding the console
let warnedMaskLenMismatch = false

export class FrameDemux {
  private buf = new Uint8Array(0)
  private textBytes: number[] = []
  private state: MonitorState | null = null

  /* Latest merged state (null until the first valid keyframe). */
  get lastState(): MonitorState | null {
    return this.state
  }

  /*
   * Feed a chunk of raw serial bytes. Returns every complete frame decoded
   * from the stream so far plus every completed ASCII line. Partial frames
   * and partial lines are buffered for the next call.
   */
  feed(bytes: Uint8Array): FeedResult {
    // append the chunk to any leftover from the previous feed
    let buf: Uint8Array
    if (this.buf.length === 0) {
      buf = bytes
    } else {
      buf = new Uint8Array(this.buf.length + bytes.length)
      buf.set(this.buf, 0)
      buf.set(bytes, this.buf.length)
    }

    const frames: ParsedFrame[] = []
    const textLines: string[] = []
    let i = 0

    while (i < buf.length) {
      const b = buf[i]
      if (b !== SOF) {
        this.pushTextByte(b, textLines)
        i++
        continue
      }
      // candidate frame start: need the fixed header first
      if (buf.length - i < 4) break // wait for more bytes
      const ver = buf[i + 1]
      const type = buf[i + 2]
      const len = buf[i + 3]
      if (ver !== VERSION || !this.lenValid(type, len)) {
        // not a frame after all — treat this 0xAA as garbage and rescan
        this.pushTextByte(b, textLines)
        i++
        continue
      }
      const total = 4 + len + 1
      if (buf.length - i < total) break // incomplete frame, wait
      let xor = 0
      for (let j = i + 2; j < i + 4 + len; j++) xor ^= buf[j]
      if (xor !== buf[i + 4 + len]) {
        // bad checksum: resync by scanning from the next byte
        this.pushTextByte(b, textLines)
        i++
        continue
      }
      const payload = buf.subarray(i + 4, i + 4 + len)
      const frame = this.parsePayload(type, payload)
      if (frame === null) {
        // structurally invalid (e.g. delta bitmask/len mismatch) — resync
        this.pushTextByte(b, textLines)
        i++
        continue
      }
      if (frame !== undefined) frames.push(frame)
      i += total
    }

    this.buf = buf.slice(i)
    return { frames, textLines }
  }

  private lenValid(type: number, len: number): boolean {
    switch (type) {
      case TYPE_KEY:
        return (
          len === KEYFRAME_LEN ||
          len === KEYFRAME_LEN_V2 ||
          len === KEYFRAME_LEN_V3 ||
          len === KEYFRAME_LEN_V4 ||
          len === KEYFRAME_LEN_V5
        )
      case TYPE_DELTA:
        return len >= DELTA_MIN_LEN && len <= DELTA_MAX_LEN
      case TYPE_EVENT:
        return len === EVENT_LEN
      case TYPE_VOICES:
        return len === VOICES_LEN || len === VOICES_LEN_V2
      case TYPE_PATCH:
        return len === PATCH_LEN
      default:
        return false
    }
  }

  /*
   * Returns a ParsedFrame, undefined for a valid-but-unemittable frame
   * (delta before the first keyframe), or null for a malformed payload.
   */
  private parsePayload(
    type: number,
    p: Uint8Array,
  ): ParsedFrame | undefined | null {
    switch (type) {
      case TYPE_KEY: {
        const prev = this.state
        const s: MonitorState = { ...(prev ?? ZERO_STATE) }
        // len picks the layout: 27 = legacy (pitchRest untouched, stays at
        // its last known value / null), 29 = v2 with the calibrated rest,
        // 31 = v3 with LED brightness + bind mask appended
        const fields =
          p.length === KEYFRAME_LEN_V5
            ? KEY_FIELDS_V5
            : p.length === KEYFRAME_LEN_V4
              ? KEY_FIELDS_V4
              : p.length === KEYFRAME_LEN_V3
              ? KEY_FIELDS_V3
              : p.length === KEYFRAME_LEN_V2
                ? KEY_FIELDS_V2
                : KEY_FIELDS
        let o = 0
        for (const f of fields) {
          f.apply(s, readField(f, p, o))
          o += f.size
        }
        this.state = s
        return {
          type: 'state',
          frame: 'K',
          state: s,
          changed: prev ? diffStates(prev, s) : 0,
        }
      }
      case TYPE_DELTA: {
        const mask = readU16(p, 0)
        let expected = 2
        for (let bit = 0; bit < 16; bit++) {
          if (mask & (1 << bit)) expected += DELTA_FIELDS[bit].size
        }
        if (expected !== p.length) {
          if (!warnedMaskLenMismatch) {
            warnedMaskLenMismatch = true
            console.warn(
              `monitor-frames: delta frame passed checksum but mask/len ` +
                `disagree (mask=0x${mask.toString(16)} expects ${expected} ` +
                `bytes, got ${p.length}) — firmware/parser protocol drift?`,
            )
          }
          return null
        }
        if (this.state === null) return undefined // no keyframe yet
        const s: MonitorState = { ...this.state }
        let o = 2
        for (let bit = 0; bit < 16; bit++) {
          if (!(mask & (1 << bit))) continue
          const f = DELTA_FIELDS[bit]
          f.apply(s, readField(f, p, o))
          o += f.size
        }
        this.state = s
        return { type: 'state', frame: 'D', state: s, changed: mask }
      }
      case TYPE_EVENT:
        return { type: 'event', kind: p[0], value: p[1] }
      case TYPE_VOICES: {
        const notes = Array.from(p.subarray(0, NUM_VOICES))
        const bits = p[NUM_VOICES]
        const gates = notes.map((_, i) => (bits & (1 << i)) !== 0)
        if (p.length === VOICES_LEN) return { type: 'voices', notes, gates }
        // v2: 6× u16 LE final pitch CV after the gate bitmask
        const cvs = notes.map((_, i) => readU16(p, VOICES_LEN + i * 2))
        return { type: 'voices', notes, gates, cvs }
      }
      case TYPE_PATCH: {
        const channel = p[0]
        // a checksum-valid frame with an impossible channel is protocol
        // drift/corruption — treat as malformed and resync
        if (channel >= NUM_VOICES) return null
        const raw = p.slice(1) // copy: p aliases the (reused) rx buffer
        return { type: 'patch', channel, ch: decodePatchChannel(raw), raw }
      }
      default:
        return null
    }
  }

  private pushTextByte(b: number, out: string[]) {
    if (b === 0x0a) {
      if (this.textBytes.length > 0) {
        out.push(String.fromCharCode(...this.textBytes))
        this.textBytes = []
      }
      return
    }
    // keep printable ASCII and tab; drop CR, control bytes and binary garbage
    if (b === 0x09 || (b >= 0x20 && b <= 0x7e)) {
      this.textBytes.push(b)
      if (this.textBytes.length > MAX_PENDING_TEXT)
        this.textBytes = this.textBytes.slice(-MAX_PENDING_TEXT / 2)
    }
  }
}
