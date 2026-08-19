/*
 * Tests for the DBG_STATE binary-frame demultiplexer (src/monitor-frames.ts).
 * Run with: node scripts/test-frames.mjs
 * (Node >= 22.18 strips the TS types of the imported module natively.)
 *
 * Frames are synthesized from the protocol spec. Point DBG_FIXTURES at a
 * real capture file to additionally stream it through the demux as a smoke
 * test (hex lines or raw binary are both accepted).
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  baseCv,
  centsOffset,
  pitchDevCents,
  decodePatchChannel,
  EVENT_KINDS,
  FIELD_BITS,
  FrameDemux,
  freqHz,
  KEYFRAME_LEN,
  KEYFRAME_LEN_V2,
  KEYFRAME_LEN_V5,
  modeName,
  PATCH_LEN,
  SLOT_NAMES,
  unpackInstrumentEvent,
} from '../src/monitor-frames.ts'

// Optional real-capture fixtures: point DBG_FIXTURES at a dbg_state capture
// file to exercise the parser against hardware truth; skipped when unset.
const FIXTURES = process.env.DBG_FIXTURES ?? ''

let passed = 0
const check = (name, fn) => {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

// ---------------------------------------------------------------------------
// frame builders
// ---------------------------------------------------------------------------
const frame = (type, payload, { badXor = false, ver = 1 } = {}) => {
  const t = typeof type === 'string' ? type.charCodeAt(0) : type
  let xor = t ^ payload.length
  for (const b of payload) xor ^= b
  if (badXor) xor ^= 0xff
  return Uint8Array.from([0xaa, ver, t, payload.length, ...payload, xor])
}

const u16 = (v) => [v & 0xff, (v >> 8) & 0xff]
const i16 = (v) => u16(v & 0xffff)
const i8 = (v) => [v & 0xff]

const KEY_DEFAULTS = {
  pitchRaw: 512,
  cv: 640,
  bend: -100,
  k: 41,
  ax: -7,
  ay: 0,
  az: -18,
  x: 135,
  y: 134,
  z: 3,
  jackFlags: 0b001, // X connected
  modW: -128,
  modX: 0,
  modY: 12,
  modZ: -18,
  note: 45,
  modeQuant: 0 | (1 << 3), // MONO + quantize chromatic
  tu: 64,
  tr: 63,
  tl0: 28,
  tl3: 15,
  loopRate: 1127,
  dropCount: 2,
}

// legacy (len 27) keyframe payload; pass pitchRest for a v2 (len 29) one
const keyPayload = (over = {}) => {
  const v = { ...KEY_DEFAULTS, ...over }
  return Uint8Array.from([
    ...u16(v.pitchRaw),
    ...u16(v.cv),
    ...i16(v.bend),
    ...i8(v.k),
    ...i8(v.ax),
    ...i8(v.ay),
    ...i8(v.az),
    v.x,
    v.y,
    v.z,
    v.jackFlags,
    ...i8(v.modW),
    ...i8(v.modX),
    ...i8(v.modY),
    ...i8(v.modZ),
    v.note,
    v.modeQuant,
    v.tu,
    v.tr,
    v.tl0,
    v.tl3,
    ...u16(v.loopRate),
    v.dropCount,
    ...(v.pitchRest !== undefined ? u16(v.pitchRest) : []), // v2
    ...(v.ledBright !== undefined ? [v.ledBright, v.bindMask] : []), // v3
    ...(v.rawX !== undefined
      ? [...u16(v.rawX), ...u16(v.rawY), ...u16(v.rawZ)]
      : []), // v4
    ...(v.stackFree !== undefined ? u16(v.stackFree) : []), // v5
  ])
}

const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))
const concat = (...parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

// ---------------------------------------------------------------------------
// keyframe
// ---------------------------------------------------------------------------
check(
  'keyframe payload builder matches the full field-list length (27)',
  () => {
    assert.equal(keyPayload().length, KEYFRAME_LEN)
    assert.equal(KEYFRAME_LEN, 27)
  },
)

check('keyframe parses to a full state', () => {
  const d = new FrameDemux()
  const { frames, textLines } = d.feed(frame('K', keyPayload()))
  assert.equal(textLines.length, 0)
  assert.equal(frames.length, 1)
  const f = frames[0]
  assert.equal(f.type, 'state')
  assert.equal(f.frame, 'K')
  const s = f.state
  assert.equal(s.pitchRaw, 512)
  assert.equal(s.cv, 640)
  assert.equal(s.bend, -100)
  assert.equal(s.k, 41)
  assert.equal(s.ax, -7)
  assert.equal(s.ay, 0)
  assert.equal(s.az, -18)
  assert.equal(s.x, 135)
  assert.equal(s.y, 134)
  assert.equal(s.z, 3)
  assert.equal(s.xConn, true)
  assert.equal(s.yConn, false)
  assert.equal(s.zConn, false)
  assert.equal(s.modW, -128)
  assert.equal(s.modX, 0)
  assert.equal(s.modY, 12)
  assert.equal(s.modZ, -18)
  assert.equal(s.note, 45)
  assert.equal(s.mode, 0)
  assert.equal(modeName(s.mode), 'MONO')
  assert.equal(s.quantize, 1)
  assert.equal(s.tu, 64)
  assert.equal(s.tr, 63)
  assert.equal(s.tl0, 28)
  assert.equal(s.tl3, 15)
  assert.equal(s.loopRate, 1127)
  assert.equal(s.dropCount, 2)
  // legacy keyframe: no calibrated rest on the wire
  assert.equal(s.pitchRest, null)
})

check('v2 keyframe (len 29) exposes the calibrated pitch rest', () => {
  const payload = keyPayload({ pitchRest: 63 })
  assert.equal(payload.length, KEYFRAME_LEN_V2)
  assert.equal(KEYFRAME_LEN_V2, 29)
  const d = new FrameDemux()
  const { frames } = d.feed(frame('K', payload))
  assert.equal(frames.length, 1)
  const s = frames[0].state
  assert.equal(s.pitchRest, 63)
  // the legacy 27-byte prefix decodes identically
  assert.equal(s.pitchRaw, 512)
  assert.equal(s.loopRate, 1127)
  assert.equal(s.dropCount, 2)
})

// the full v5 keyframe the current firmware sends: every tail field must reach
// the editor, so a v5-aware parser shows the whole state, not just the prefix
check('v5 keyframe (len 39) exposes led, bind mask, raw CVs and free RAM', () => {
  const payload = keyPayload({
    pitchRest: 62,
    ledBright: 200,
    bindMask: 0b101,
    rawX: 300,
    rawY: 512,
    rawZ: 900,
    stackFree: 210,
  })
  assert.equal(payload.length, KEYFRAME_LEN_V5)
  assert.equal(KEYFRAME_LEN_V5, 39)
  const d = new FrameDemux()
  const { frames } = d.feed(frame('K', payload))
  const s = frames[0].state
  // attenuverters, mod-CV inputs and system fields survive the longer frame
  assert.equal(s.ax, -7)
  assert.equal(s.ay, 0)
  assert.equal(s.az, -18)
  assert.equal(s.x, 135)
  assert.equal(s.y, 134)
  assert.equal(s.z, 3)
  assert.equal(s.loopRate, 1127)
  assert.equal(s.mode, 0)
  // the v3/v4/v5 tail
  assert.equal(s.ledBright, 200)
  assert.equal(s.bindMask, 0b101)
  assert.equal(s.rawX, 300)
  assert.equal(s.rawY, 512)
  assert.equal(s.rawZ, 900)
  assert.equal(s.stackFree, 210)
})

check(
  'pitchRest survives deltas and legacy keyframes, diffs when changed',
  () => {
    const d = new FrameDemux()
    d.feed(frame('K', keyPayload({ pitchRest: 63 })))
    // a delta never touches it
    const rd = d.feed(frame('D', Uint8Array.from([...u16(1 << 15), 60])))
    assert.equal(rd.frames[0].state.pitchRest, 63)
    // a legacy (len 27) keyframe from older firmware leaves it as-is
    const rl = d.feed(frame('K', keyPayload()))
    assert.equal(rl.frames[0].state.pitchRest, 63)
    assert.equal(rl.frames[0].changed & (1 << FIELD_BITS.pitchRest), 0)
    // a v2 keyframe with a new rest flags the change (recalibration seen live)
    const rv = d.feed(frame('K', keyPayload({ pitchRest: 65 })))
    assert.equal(rv.frames[0].state.pitchRest, 65)
    assert.ok(rv.frames[0].changed & (1 << FIELD_BITS.pitchRest))
  },
)

check('keyframe with wrong len is rejected, stream resyncs', () => {
  const d = new FrameDemux()
  const bad25 = frame('K', keyPayload().subarray(0, 25)) // len 25 ≠ 27
  const bad28 = frame(
    'K',
    keyPayload({ pitchRest: 63 }).subarray(0, 28), // len 28 ∉ {27, 29}
  )
  const good = frame('K', keyPayload())
  const { frames } = d.feed(concat(bad25, bad28, good))
  assert.equal(frames.length, 1)
  assert.equal(frames[0].state.loopRate, 1127)
})

// ---------------------------------------------------------------------------
// delta
// ---------------------------------------------------------------------------
check('delta merges onto the last keyframe', () => {
  const d = new FrameDemux()
  d.feed(frame('K', keyPayload()))
  // bits: 0=pitchRaw(u16), 2=bend(i16), 10=jackFlags(u8), 15=note(u8)
  const mask = (1 << 0) | (1 << 2) | (1 << 10) | (1 << 15)
  const payload = Uint8Array.from([
    ...u16(mask),
    ...u16(700),
    ...i16(150),
    0b110, // Y+Z now connected, X gone
    60,
  ])
  const { frames } = d.feed(frame('D', payload))
  assert.equal(frames.length, 1)
  assert.equal(frames[0].frame, 'D')
  const s = frames[0].state
  // changed fields
  assert.equal(s.pitchRaw, 700)
  assert.equal(s.bend, 150)
  assert.equal(s.xConn, false)
  assert.equal(s.yConn, true)
  assert.equal(s.zConn, true)
  assert.equal(s.note, 60)
  // untouched fields carry over from the keyframe
  assert.equal(s.cv, 640)
  assert.equal(s.k, 41)
  assert.equal(s.modW, -128)
  assert.equal(s.loopRate, 1127)
  assert.equal(s.dropCount, 2)
})

check('jackFlags bits 3/4 decode to button/gate (keyframe + delta)', () => {
  const d = new FrameDemux()
  // keyframe: X jack + button pressed + gate high
  const r1 = d.feed(frame('K', keyPayload({ jackFlags: 0b11001 })))
  let s = r1.frames[0].state
  assert.equal(s.xConn, true)
  assert.equal(s.yConn, false)
  assert.equal(s.zConn, false)
  assert.equal(s.button, true)
  assert.equal(s.gate, true)
  // delta: button released, gate stays high, X jack still in
  const r2 = d.feed(frame('D', Uint8Array.from([...u16(1 << 10), 0b10001])))
  s = r2.frames[0].state
  assert.equal(s.button, false)
  assert.equal(s.gate, true)
  assert.equal(s.xConn, true)
  // delta: gate drops, button pressed again — jack bits untouched
  const r3 = d.feed(frame('D', Uint8Array.from([...u16(1 << 10), 0b01001])))
  s = r3.frames[0].state
  assert.equal(s.button, true)
  assert.equal(s.gate, false)
  assert.equal(s.xConn, true)
})

check('jackFlags bits 5-7 decode to trimmer wiper-open flags (K + D)', () => {
  const d = new FrameDemux()
  // keyframe: X jack in, aX wiper open, everything else normal
  const r1 = d.feed(frame('K', keyPayload({ jackFlags: 0b00100001 })))
  let s = r1.frames[0].state
  assert.equal(s.axOpen, true)
  assert.equal(s.ayOpen, false)
  assert.equal(s.azOpen, false)
  assert.equal(s.xConn, true)
  assert.equal(s.button, false)
  assert.equal(s.gate, false)
  // delta: aX recovers, aY+aZ open — jack/button/gate bits untouched
  const r2 = d.feed(frame('D', Uint8Array.from([...u16(1 << 10), 0b11000001])))
  s = r2.frames[0].state
  assert.equal(s.axOpen, false)
  assert.equal(s.ayOpen, true)
  assert.equal(s.azOpen, true)
  assert.equal(s.xConn, true)
  assert.equal(s.button, false)
  assert.equal(s.gate, false)
  // delta: all wipers closed again
  const r3 = d.feed(frame('D', Uint8Array.from([...u16(1 << 10), 0b00000001])))
  s = r3.frames[0].state
  assert.equal(s.axOpen, false)
  assert.equal(s.ayOpen, false)
  assert.equal(s.azOpen, false)
})

check('trimmer-open-only changes register as jack-field keyframe diffs', () => {
  const d = new FrameDemux()
  d.feed(frame('K', keyPayload({ jackFlags: 0b00000001 })))
  // same jacks/button/gate, aX wiper opens → diff must flag the jack field
  const r = d.feed(frame('K', keyPayload({ jackFlags: 0b00100001 })))
  assert.ok(r.frames[0].changed & (1 << FIELD_BITS.jack))
  // aY and aZ open likewise
  const r2 = d.feed(frame('K', keyPayload({ jackFlags: 0b11100001 })))
  assert.ok(r2.frames[0].changed & (1 << FIELD_BITS.jack))
  // identical flags → no jack diff
  const r3 = d.feed(frame('K', keyPayload({ jackFlags: 0b11100001 })))
  assert.equal(r3.frames[0].changed & (1 << FIELD_BITS.jack), 0)
})

check('button/gate-only changes register as jack-field keyframe diffs', () => {
  const d = new FrameDemux()
  d.feed(frame('K', keyPayload({ jackFlags: 0b00001 })))
  // same jacks, button now pressed → diff must flag the jack field
  const r = d.feed(frame('K', keyPayload({ jackFlags: 0b01001 })))
  assert.ok(r.frames[0].changed & (1 << FIELD_BITS.jack))
  // gate edge likewise
  const r2 = d.feed(frame('K', keyPayload({ jackFlags: 0b11001 })))
  assert.ok(r2.frames[0].changed & (1 << FIELD_BITS.jack))
  // identical flags → no jack diff
  const r3 = d.feed(frame('K', keyPayload({ jackFlags: 0b11001 })))
  assert.equal(r3.frames[0].changed & (1 << FIELD_BITS.jack), 0)
})

check('delta before any keyframe is dropped', () => {
  const d = new FrameDemux()
  const payload = Uint8Array.from([...u16(1 << 15), 60]) // note only
  const { frames } = d.feed(frame('D', payload))
  assert.equal(frames.length, 0)
  // a keyframe afterwards works normally
  const r2 = d.feed(frame('K', keyPayload()))
  assert.equal(r2.frames.length, 1)
})

check('state frames expose a changed-fields bitmask', () => {
  const d = new FrameDemux()
  // first keyframe: nothing to compare against
  const r1 = d.feed(frame('K', keyPayload()))
  assert.equal(r1.frames[0].changed, 0)
  // delta: changed == the wire bitmask, verbatim
  const mask = (1 << FIELD_BITS.pitchRaw) | (1 << FIELD_BITS.note)
  const payload = Uint8Array.from([...u16(mask), ...u16(700), 60])
  const r2 = d.feed(frame('D', payload))
  assert.equal(r2.frames[0].changed, mask)
  // later keyframe: changed == diff against the merged state
  const r3 = d.feed(frame('K', keyPayload({ note: 61, modeQuant: 2 | 8 })))
  assert.equal(
    r3.frames[0].changed,
    (1 << FIELD_BITS.pitchRaw) | // 512 vs delta's 700
      (1 << FIELD_BITS.note) | // 61 vs delta's 60
      (1 << FIELD_BITS.mode), // DUO vs MONO
  )
  // identical keyframe: nothing changed
  const r4 = d.feed(frame('K', keyPayload({ note: 61, modeQuant: 2 | 8 })))
  assert.equal(r4.frames[0].changed, 0)
})

check('delta with bitmask/len mismatch is rejected, stream resyncs', () => {
  const d = new FrameDemux()
  d.feed(frame('K', keyPayload()))
  // claims pitchRaw (2 bytes) but only carries 1 payload byte after the mask
  const bad = frame('D', Uint8Array.from([...u16(1 << 0), 0x42]))
  const good = frame('D', Uint8Array.from([...u16(1 << 15), 72]))
  const { frames } = d.feed(concat(bad, good))
  assert.equal(frames.length, 1)
  assert.equal(frames[0].state.note, 72)
})

// ---------------------------------------------------------------------------
// event
// ---------------------------------------------------------------------------
check('event frame parses', () => {
  const d = new FrameDemux()
  const { frames } = d.feed(frame('E', Uint8Array.from([1, 60])))
  assert.equal(frames.length, 1)
  assert.deepEqual(frames[0], { type: 'event', kind: 1, value: 60 })
  assert.equal(EVENT_KINDS[1], 'noteOn')
  assert.equal(EVENT_KINDS[2], 'noteOff')
  assert.equal(EVENT_KINDS[3], 'modeChange')
  assert.equal(EVENT_KINDS[4], 'instrumentLoad')
  assert.equal(EVENT_KINDS[5], 'eepromRestore')
})

check('event kind 4 value unpacks as (slot << 6) | instrument', () => {
  // slot 1 (B), instrument 17
  assert.deepEqual(unpackInstrumentEvent((1 << 6) | 17), {
    slot: 1,
    instrument: 17,
  })
  // extremes: slot A + dial 0 (EEPROM notch), slot D + dial 41 (last bank)
  assert.deepEqual(unpackInstrumentEvent(0), { slot: 0, instrument: 0 })
  assert.deepEqual(unpackInstrumentEvent((3 << 6) | 41), {
    slot: 3,
    instrument: 41,
  })
  assert.equal(SLOT_NAMES[0], 'A')
  assert.equal(SLOT_NAMES[3], 'D')
  // the packed value always fits the event's u8
  assert.ok(((3 << 6) | 41) <= 0xff)
})

check('event kind 4/5 frames flow through the demux as plain events', () => {
  const d = new FrameDemux()
  const { frames } = d.feed(
    concat(
      frame('E', Uint8Array.from([4, (2 << 6) | 5])), // instrument 5 → slot C
      frame('E', Uint8Array.from([5, 3])), // slot D restored from EEPROM
    ),
  )
  assert.equal(frames.length, 2)
  assert.deepEqual(frames[0], { type: 'event', kind: 4, value: (2 << 6) | 5 })
  assert.deepEqual(unpackInstrumentEvent(frames[0].value), {
    slot: 2,
    instrument: 5,
  })
  assert.deepEqual(frames[1], { type: 'event', kind: 5, value: 3 })
})

// ---------------------------------------------------------------------------
// voices
// ---------------------------------------------------------------------------
check(
  'legacy voices frame (len 7) parses 6 notes + gate bitmask, no cvs',
  () => {
    const d = new FrameDemux()
    const payload = Uint8Array.from([60, 64, 67, 72, 0, 127, 0b101001])
    const { frames, textLines } = d.feed(frame('V', payload))
    assert.equal(textLines.length, 0)
    assert.equal(frames.length, 1)
    assert.deepEqual(frames[0], {
      type: 'voices',
      notes: [60, 64, 67, 72, 0, 127],
      gates: [true, false, false, true, false, true],
    })
    assert.equal(frames[0].cvs, undefined)
  },
)

check('voices v2 frame (len 19) also carries 6× u16 LE final pitch CV', () => {
  const d = new FrameDemux()
  const notes = [60, 64, 67, 72, 0, 127]
  // C4 at base, E4 +1 count, G4 -8 counts, A4-equivalent, extremes
  const cvs = [384, 417, 432, 456, 0, 0xffff]
  const payload = Uint8Array.from([...notes, 0b001011, ...cvs.flatMap(u16)])
  const { frames } = d.feed(frame('V', payload))
  assert.equal(frames.length, 1)
  assert.deepEqual(frames[0], {
    type: 'voices',
    notes,
    gates: [true, true, false, true, false, false],
    cvs,
  })
})

check('voices frame with wrong len is rejected, stream resyncs', () => {
  const d = new FrameDemux()
  const bad6 = frame('V', Uint8Array.from([60, 64, 67, 72, 0, 127])) // len 6
  const bad8 = frame('V', Uint8Array.from([60, 64, 67, 72, 0, 127, 1, 0])) // len 8
  const bad18 = frame('V', Uint8Array.from(Array(18).fill(3))) // v2 minus 1
  const bad20 = frame('V', Uint8Array.from(Array(20).fill(3))) // v2 plus 1
  const good = frame('V', Uint8Array.from([1, 2, 3, 4, 5, 6, 0]))
  const { frames } = d.feed(concat(bad6, bad8, bad18, bad20, good))
  assert.equal(frames.length, 1)
  assert.equal(frames[0].type, 'voices')
  assert.deepEqual(frames[0].notes, [1, 2, 3, 4, 5, 6])
  assert.deepEqual(frames[0].gates, [false, false, false, false, false, false])
})

check('voices frames interleave with K/D without touching the state', () => {
  const d = new FrameDemux()
  const stream = concat(
    frame('K', keyPayload()),
    frame('V', Uint8Array.from([45, 0, 0, 0, 0, 0, 0b000001])),
    frame('D', Uint8Array.from([...u16(1 << 15), 62])), // note → 62
    frame('V', Uint8Array.from([62, 45, 0, 0, 0, 0, 0b000011])),
  )
  const { frames } = d.feed(stream)
  assert.equal(frames.length, 4)
  assert.equal(frames[0].frame, 'K')
  assert.equal(frames[1].type, 'voices')
  assert.deepEqual(frames[1].notes, [45, 0, 0, 0, 0, 0])
  assert.equal(frames[2].frame, 'D')
  assert.equal(frames[2].state.note, 62)
  assert.equal(frames[3].type, 'voices')
  assert.deepEqual(frames[3].gates, [true, true, false, false, false, false])
  // the merged state is untouched by the V frames in between
  assert.equal(d.lastState.note, 62)
  assert.equal(d.lastState.cv, 640)
})

// ---------------------------------------------------------------------------
// patch ('P') frames — rotating channel_t snapshots
// ---------------------------------------------------------------------------
// encode a channel_t exactly like the editor's CRC32 layout (checksum.ts);
// decodePatchChannel must be its inverse
const opBytes = (op) => [
  op.mul | (op.det << 4), // op_dt1_mul_t
  op.tl, // op_tl_t
  op.ar | (op.rs << 6), // op_rs_ar_t
  op.d1 | (op.am << 7), // op_am_d1r_t
  op.d2, // op_d2r_t
  op.rr | (op.sl << 4), // op_d1l_rr_t
]
const channelBytes = (ch) => [
  ch.al | (ch.fb << 3), // ch_fb_alg_t
  ch.fms | (ch.ams << 3) | (ch.lr << 6), // ch_lr_ams_fms_t
  ...ch.ops.flatMap(opBytes),
]

const OP_A = {
  mul: 2,
  det: 3,
  tl: 28,
  ar: 31,
  rs: 1,
  d1: 5,
  am: 0,
  d2: 0,
  rr: 15,
  sl: 0,
}
const OP_B = {
  mul: 1,
  det: 0,
  tl: 127,
  ar: 11,
  rs: 0,
  d1: 31,
  am: 1,
  d2: 31,
  rr: 4,
  sl: 15,
}
const CH_A = {
  al: 4,
  fb: 7,
  fms: 4,
  ams: 2,
  lr: 3,
  ops: [OP_A, OP_B, OP_A, OP_B],
}
const CH_B = {
  al: 0,
  fb: 0,
  fms: 0,
  ams: 0,
  lr: 1,
  ops: [OP_B, OP_A, OP_B, OP_A],
}

const patchPayload = (channel, ch) =>
  Uint8Array.from([channel, ...channelBytes(ch)])

check('patch frame (len 27) decodes the 26-byte channel_t', () => {
  assert.equal(PATCH_LEN, 27)
  const d = new FrameDemux()
  const { frames, textLines } = d.feed(frame('P', patchPayload(2, CH_A)))
  assert.equal(textLines.length, 0)
  assert.equal(frames.length, 1)
  const f = frames[0]
  assert.equal(f.type, 'patch')
  assert.equal(f.channel, 2)
  // full round-trip: decode(encode(ch)) == ch
  assert.deepEqual(f.ch, CH_A)
  // raw carries the channel_t bytes verbatim
  assert.deepEqual(Array.from(f.raw), channelBytes(CH_A))
  // and the standalone decoder agrees
  assert.deepEqual(decodePatchChannel(f.raw), CH_A)
})

check('patch frame decodes bit-packed extremes (TL=127, AM=1, DT1=7)', () => {
  const op = {
    mul: 15,
    det: 7,
    tl: 127,
    ar: 31,
    rs: 3,
    d1: 31,
    am: 1,
    d2: 31,
    rr: 15,
    sl: 15,
  }
  const ch = { al: 7, fb: 7, fms: 7, ams: 3, lr: 3, ops: [op, op, op, op] }
  const d = new FrameDemux()
  const { frames } = d.feed(frame('P', patchPayload(5, ch)))
  assert.equal(frames.length, 1)
  assert.deepEqual(frames[0].ch, ch)
})

check('patch frame with wrong len is rejected, stream resyncs', () => {
  const d = new FrameDemux()
  const bad26 = frame('P', patchPayload(0, CH_A).subarray(0, 26)) // len 26
  const bad28 = frame(
    'P',
    Uint8Array.from([...patchPayload(0, CH_A), 0]), // len 28
  )
  const good = frame('P', patchPayload(1, CH_B))
  const { frames } = d.feed(concat(bad26, bad28, good))
  assert.equal(frames.length, 1)
  assert.equal(frames[0].channel, 1)
  assert.deepEqual(frames[0].ch, CH_B)
})

check('patch frame with channel > 5 is rejected, stream resyncs', () => {
  const d = new FrameDemux()
  const bad = frame('P', patchPayload(6, CH_A))
  const good = frame('P', patchPayload(0, CH_A))
  const { frames } = d.feed(concat(bad, good))
  assert.equal(frames.length, 1)
  assert.equal(frames[0].channel, 0)
})

check('rotating patch frames assemble a per-channel snapshot', () => {
  // the firmware rotates ch 0..5 (~1/s); the monitor keeps the latest frame
  // per channel — mirror that fold and check the assembled snapshot
  const d = new FrameDemux()
  const stream = concat(
    ...[0, 1, 2, 3, 4, 5].map((c) =>
      frame('P', patchPayload(c, c % 2 === 0 ? CH_A : CH_B)),
    ),
    // second rotation begins: ch0 changes patch (morph moved a TL)
    frame('P', patchPayload(0, CH_B)),
  )
  const { frames } = d.feed(stream)
  assert.equal(frames.length, 7)
  const byCh = Array.from({ length: 6 }, () => null)
  for (const f of frames) {
    assert.equal(f.type, 'patch')
    byCh[f.channel] = f
  }
  // every channel populated, ch0 holds the SECOND (latest) frame
  for (let c = 0; c < 6; c++) assert.ok(byCh[c] !== null, `ch${c} missing`)
  assert.deepEqual(byCh[0].ch, CH_B)
  assert.deepEqual(byCh[1].ch, CH_B)
  assert.deepEqual(byCh[2].ch, CH_A)
})

check('patch frames interleave with K/D/V without touching the state', () => {
  const d = new FrameDemux()
  const stream = concat(
    frame('K', keyPayload()),
    frame('P', patchPayload(3, CH_A)),
    frame('D', Uint8Array.from([...u16(1 << 15), 62])), // note → 62
    frame('V', Uint8Array.from([62, 0, 0, 0, 0, 0, 0b000001])),
    frame('P', patchPayload(4, CH_B)),
  )
  const { frames } = d.feed(stream)
  assert.equal(frames.length, 5)
  assert.equal(frames[1].type, 'patch')
  assert.equal(frames[4].type, 'patch')
  assert.equal(d.lastState.note, 62)
  assert.equal(d.lastState.cv, 640)
})

// ---------------------------------------------------------------------------
// pitch CV math helpers
// ---------------------------------------------------------------------------
check('freqHz: 8 counts/semitone, 96/octave, A4=440Hz at cv=456', () => {
  assert.equal(freqHz(456), 440)
  assert.ok(Math.abs(freqHz(456 + 96) - 880) < 1e-9) // +1 octave
  assert.ok(Math.abs(freqHz(456 - 96) - 220) < 1e-9) // -1 octave
  assert.ok(Math.abs(freqHz(384) - 261.6256) < 1e-3) // C4 (middle C)
})

check('baseCv maps MIDI notes onto the CV grid', () => {
  assert.equal(baseCv(69), 456) // A4
  assert.equal(baseCv(12), 0) // C0 = bottom of the CV range
  assert.equal(baseCv(70), 464) // +1 semitone = +8 counts
  assert.equal(baseCv(60), 384) // C4
})

check('centsOffset: 12.5 cents per count, relative to the MIDI base', () => {
  assert.equal(centsOffset(456, 69), 0)
  assert.equal(centsOffset(457, 69), 12.5) // one count sharp
  assert.equal(centsOffset(455, 69), -12.5) // one count flat
  assert.equal(centsOffset(baseCv(60) + 8, 60), 100) // 8 counts = 1 semitone
  assert.equal(centsOffset(baseCv(60) - 96, 60), -1200) // an octave down
})

check('pitchDevCents: mirrors the firmware rest deadband', () => {
  // within +-1 count of rest the module ignores the deviation, so must we
  assert.equal(pitchDevCents(63, 63), 0)
  assert.equal(pitchDevCents(64, 63), 0)
  assert.equal(pitchDevCents(62, 63), 0)
  // beyond it, full resolution
  assert.equal(pitchDevCents(65, 63), 25)
  assert.equal(pitchDevCents(61, 63), -25)
  // legacy firmware sends no rest: fall back to the compiled default
  assert.equal(pitchDevCents(50, null), 0)
  assert.equal(pitchDevCents(63, null), 162.5)
})

// ---------------------------------------------------------------------------
// quantize scale (modeQuant bits 3-5) — surfaced as a badge in the monitor UI
// ---------------------------------------------------------------------------
check('modeQuant bits 3-5 carry the quantize scale, mode keeps bits 0-2', () => {
  const d = new FrameDemux()
  // every scale must decode without disturbing the mode in the low bits
  for (let q = 0; q <= 7; q++) {
    const f = d.feed(frame('K', keyPayload({ modeQuant: 2 | (q << 3) })))
      .frames[0]
    assert.equal(f.state.mode, 2)
    assert.equal(f.state.quantize, q)
  }
  // and a scale change registers as a mode-field change
  const off = d.feed(frame('K', keyPayload({ modeQuant: 2 }))).frames[0]
  assert.equal(off.state.quantize, 0)
  assert.ok(off.changed & (1 << FIELD_BITS.mode))
})

// ---------------------------------------------------------------------------
// resync / checksum
// ---------------------------------------------------------------------------
check('bad checksum is rejected and the next frame is found', () => {
  const d = new FrameDemux()
  const bad = frame('K', keyPayload(), { badXor: true })
  const good = frame('E', Uint8Array.from([2, 45]))
  const { frames } = d.feed(concat(bad, good))
  assert.equal(frames.length, 1)
  assert.deepEqual(frames[0], { type: 'event', kind: 2, value: 45 })
})

check('resyncs after leading binary garbage (including stray 0xAA)', () => {
  const d = new FrameDemux()
  const garbage = Uint8Array.from([0x00, 0xaa, 0xff, 0xaa, 0x02, 0x4b, 0x13])
  const { frames } = d.feed(concat(garbage, frame('K', keyPayload())))
  assert.equal(frames.length, 1)
  assert.equal(frames[0].state.note, 45)
})

check('wrong version byte is not parsed as a frame', () => {
  const d = new FrameDemux()
  const { frames } = d.feed(frame('K', keyPayload(), { ver: 2 }))
  assert.equal(frames.length, 0)
})

// ---------------------------------------------------------------------------
// ASCII interleaving + chunked feeding
// ---------------------------------------------------------------------------
check('ASCII lines interleave with frames', () => {
  const d = new FrameDemux()
  const stream = concat(
    ascii('12345 heartbeat loop:1127/s\r\n'),
    frame('K', keyPayload()),
    ascii('EEPROM saved ok\n'),
    frame('E', Uint8Array.from([3, 6])),
    ascii('partial tail'),
  )
  const { frames, textLines } = d.feed(stream)
  assert.equal(frames.length, 2)
  assert.equal(frames[0].type, 'state')
  assert.equal(frames[1].type, 'event')
  assert.equal(frames[1].value, 6)
  assert.deepEqual(textLines, [
    '12345 heartbeat loop:1127/s',
    'EEPROM saved ok',
  ])
  // the unterminated tail flushes once its newline arrives
  const r2 = d.feed(ascii(' done\n'))
  assert.deepEqual(r2.textLines, ['partial tail done'])
})

check('byte-at-a-time feeding yields identical results', () => {
  const stream = concat(
    ascii('hello\n'),
    frame('K', keyPayload()),
    frame('D', Uint8Array.from([...u16(1 << 15), 50])),
    ascii('bye\n'),
    frame('E', Uint8Array.from([1, 50])),
  )
  const d = new FrameDemux()
  const frames = []
  const textLines = []
  for (const b of stream) {
    const r = d.feed(Uint8Array.from([b]))
    frames.push(...r.frames)
    textLines.push(...r.textLines)
  }
  assert.equal(frames.length, 3)
  assert.equal(frames[0].frame, 'K')
  assert.equal(frames[1].frame, 'D')
  assert.equal(frames[1].state.note, 50)
  assert.deepEqual(frames[2], { type: 'event', kind: 1, value: 50 })
  assert.deepEqual(textLines, ['hello', 'bye'])
})

check('frame split across feed() calls buffers until complete', () => {
  const d = new FrameDemux()
  const f = frame('K', keyPayload())
  const r1 = d.feed(f.subarray(0, 10))
  assert.equal(r1.frames.length, 0)
  const r2 = d.feed(f.subarray(10))
  assert.equal(r2.frames.length, 1)
})

// ---------------------------------------------------------------------------
// optional: firmware-generated fixture capture
// ---------------------------------------------------------------------------
// fixture file format: `# label` comment line(s) followed by hex byte lines
// (continuous "AA014B…" or spaced/comma'd), one fixture per labeled section
const parseFixtureSections = (text) => {
  const sections = []
  let current = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('#')) {
      current = { label: line.replace(/^#\s*/, ''), hex: '' }
      sections.push(current)
      continue
    }
    if (line.length === 0) continue
    const hex = line.replace(/0x/gi, '').replace(/[\s,]+/g, '')
    assert.ok(
      /^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0,
      `unparseable fixture line: ${line}`,
    )
    if (!current) {
      current = { label: '(unlabeled)', hex: '' }
      sections.push(current)
    }
    current.hex += hex
  }
  return sections
    .filter((s) => s.hex.length > 0)
    .map((s) => ({
      label: s.label,
      bytes: Uint8Array.from(
        (s.hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)),
      ),
    }))
}

const countFrames = (frames) => {
  const n = { key: 0, delta: 0, event: 0, voices: 0, patch: 0 }
  for (const f of frames) {
    if (f.type === 'event') n.event++
    else if (f.type === 'voices') n.voices++
    else if (f.type === 'patch') n.patch++
    else if (f.frame === 'K') n.key++
    else n.delta++
  }
  return n
}

if (existsSync(FIXTURES)) {
  const sections = parseFixtureSections(readFileSync(FIXTURES, 'latin1'))
  // `# V voices` sections are appended by the firmware side independently:
  // consume them when present, skip their checks when not
  const voicesSections = sections.filter((s) => /\bvoices\b/i.test(s.label))
  const expectedVoices = voicesSections.reduce(
    (n, s) => n + countFrames(new FrameDemux().feed(s.bytes).frames).voices,
    0,
  )
  // `# P patch` sections likewise: consume when present, skip when absent
  const patchSections = sections.filter((s) => /\bpatch\b/i.test(s.label))
  const expectedPatch = patchSections.reduce(
    (n, s) => n + countFrames(new FrameDemux().feed(s.bytes).frames).patch,
    0,
  )
  // events are stateless (unlike deltas, which need a prior keyframe), so
  // the in-stream total must match the per-section standalone sum — this
  // absorbs new firmware-side E fixtures (e.g. kind 4/5 instrument loads)
  const expectedEvents = sections.reduce(
    (n, s) => n + countFrames(new FrameDemux().feed(s.bytes).frames).event,
    0,
  )

  check('firmware fixtures: full stream decodes every frame', () => {
    // stream all sections through one demux in serial-sized chunks
    const bytes = concat(...sections.map((s) => s.bytes))
    const d = new FrameDemux()
    const frames = []
    let nText = 0
    for (let o = 0; o < bytes.length; o += 61) {
      const r = d.feed(bytes.subarray(o, o + 61))
      frames.push(...r.frames)
      nText += r.textLines.length
    }
    const n = countFrames(frames)
    console.log(
      `  fixtures: ${sections.length} sections, ${bytes.length} bytes → ${n.key} K, ${n.delta} D, ${n.event} E, ${n.voices} V, ${n.patch} P, ${nText} text lines`,
    )
    // 2 golden keyframes + 1 v2 (`# K v2 rest`) + 1 trim-open (`# jack
    // trim-open bits`) + 3 deltas, plus 1 K + 1 D recovered from the resync
    // stream; E/V/P counts come from the sections themselves (the baseline
    // is 3 event sections + 1 resync-recovered = 4)
    assert.equal(n.key, 5)
    assert.equal(n.delta, 4)
    assert.ok(expectedEvents >= 4, 'baseline event fixtures went missing')
    assert.equal(n.event, expectedEvents)
    assert.equal(n.voices, expectedVoices)
    assert.equal(n.patch, expectedPatch)
  })

  check(
    'firmware fixtures: resync stream recovers exactly 1 K + 1 D + 1 E',
    () => {
      const resync = sections.find((s) => /resync/i.test(s.label))
      assert.ok(resync, 'no resync section found in fixtures')
      const d = new FrameDemux()
      const n = countFrames(d.feed(resync.bytes).frames)
      assert.deepEqual(n, { key: 1, delta: 1, event: 1, voices: 0, patch: 0 })
    },
  )

  if (voicesSections.length > 0) {
    check(
      'firmware fixtures: V sections decode to well-formed voices frames',
      () => {
        for (const sec of voicesSections) {
          const d = new FrameDemux()
          const frames = d.feed(sec.bytes).frames
          const vs = frames.filter((f) => f.type === 'voices')
          assert.ok(vs.length > 0, `section "${sec.label}" yielded no V frames`)
          for (const v of vs) {
            assert.equal(v.notes.length, 6)
            assert.equal(v.gates.length, 6)
            for (const nn of v.notes) assert.ok(nn >= 0 && nn <= 255)
            // `# V voices v2` sections carry per-voice final pitch CVs
            if (v.cvs !== undefined) {
              assert.equal(v.cvs.length, 6)
              for (const c of v.cvs) assert.ok(c >= 0 && c <= 0xffff)
            }
          }
        }
        console.log(
          `  voices fixtures: ${voicesSections.length} section(s), ${expectedVoices} V frame(s)`,
        )
      },
    )
  } else {
    console.log(
      '-- no `# V voices` fixture sections yet, V fixture check skipped',
    )
  }

  if (patchSections.length > 0) {
    check(
      'firmware fixtures: P sections decode to well-formed patch frames',
      () => {
        for (const sec of patchSections) {
          const d = new FrameDemux()
          const frames = d.feed(sec.bytes).frames
          const ps = frames.filter((f) => f.type === 'patch')
          assert.ok(ps.length > 0, `section "${sec.label}" yielded no P frames`)
          for (const p of ps) {
            assert.ok(p.channel >= 0 && p.channel <= 5)
            assert.equal(p.raw.length, 26)
            assert.equal(p.ch.ops.length, 4)
            assert.ok(p.ch.al >= 0 && p.ch.al <= 7)
            assert.ok(p.ch.fb >= 0 && p.ch.fb <= 7)
            for (const op of p.ch.ops) {
              assert.ok(op.tl >= 0 && op.tl <= 127)
              assert.ok(op.ar >= 0 && op.ar <= 31)
            }
          }
        }
        console.log(
          `  patch fixtures: ${patchSections.length} section(s), ${expectedPatch} P frame(s)`,
        )
      },
    )
  } else {
    console.log(
      '-- no `# P patch` fixture sections yet, P fixture check skipped',
    )
  }

  // `# E load` sections: kind 4 (instrument → slot) / kind 5 (EEPROM restore)
  const loadSections = sections.filter((s) => /^E load\b/i.test(s.label))
  if (loadSections.length > 0) {
    check(
      'firmware fixtures: E load events unpack to valid slot/instrument',
      () => {
        for (const sec of loadSections) {
          const frames = new FrameDemux().feed(sec.bytes).frames
          const evs = frames.filter((f) => f.type === 'event')
          assert.ok(evs.length > 0, `section "${sec.label}" yielded no events`)
          for (const e of evs) {
            assert.ok(e.kind === 4 || e.kind === 5, `unexpected kind ${e.kind}`)
            if (e.kind === 4) {
              const { slot, instrument } = unpackInstrumentEvent(e.value)
              assert.ok(slot >= 0 && slot <= 3)
              assert.ok(instrument >= 0 && instrument <= 41)
            } else {
              assert.ok(e.value >= 0 && e.value <= 3)
            }
          }
        }
        console.log(`  E load fixtures: ${loadSections.length} section(s)`)
      },
    )
  } else {
    console.log(
      '-- no `# E load` fixture sections yet, load fixture check skipped',
    )
  }

  // `# K v2 rest` section: len-29 keyframe with the calibrated pitch rest
  const k2Sections = sections.filter((s) => /^K v2 rest/i.test(s.label))
  if (k2Sections.length > 0) {
    check('firmware fixtures: K v2 keyframe exposes pitchRest=63', () => {
      for (const sec of k2Sections) {
        const d = new FrameDemux()
        const frames = d.feed(sec.bytes).frames
        assert.equal(frames.length, 1, `section "${sec.label}"`)
        assert.equal(frames[0].frame, 'K')
        assert.equal(frames[0].state.pitchRest, 63)
        // the v1 prefix is the golden state 0 (pitchRaw 612)
        assert.equal(frames[0].state.pitchRaw, 612)
      }
      console.log(`  K v2 fixtures: ${k2Sections.length} section(s)`)
    })
  } else {
    console.log('-- no `# K v2 rest` fixture section yet, check skipped')
  }

  // `# jack trim-open bits` section: golden state 0 with jackFlags bit 5
  // (aX trimmer wiper open, per the firmware's ADC charge probe)
  const trimSections = sections.filter((s) => /^jack trim-open/i.test(s.label))
  if (trimSections.length > 0) {
    check('firmware fixtures: jackFlags bit 5 decodes as aX wiper open', () => {
      for (const sec of trimSections) {
        const d = new FrameDemux()
        const frames = d.feed(sec.bytes).frames
        assert.equal(frames.length, 1, `section "${sec.label}"`)
        assert.equal(frames[0].frame, 'K')
        const s = frames[0].state
        assert.equal(s.axOpen, true)
        assert.equal(s.ayOpen, false)
        assert.equal(s.azOpen, false)
        // the jack/button/gate bits of golden state 0 are untouched
        assert.equal(s.xConn, true)
        assert.equal(s.yConn, false)
        assert.equal(s.zConn, true)
        assert.equal(s.button, false)
        assert.equal(s.gate, false)
        assert.equal(s.pitchRaw, 612)
      }
      console.log(`  trim-open fixtures: ${trimSections.length} section(s)`)
    })
  } else {
    console.log('-- no `# jack trim-open bits` fixture section yet, skipped')
  }

  check(
    'firmware fixtures: delta fields merge onto the golden keyframe',
    () => {
      // feed the first keyframe, then the first delta section — the merged
      // state must differ from the keyframe only in the delta'd fields
      const keySec = sections.find((s) => /keyframe/i.test(s.label))
      const deltaSec = sections.find((s) => /delta/i.test(s.label))
      assert.ok(keySec && deltaSec, 'fixtures lack keyframe/delta sections')
      const d = new FrameDemux()
      const kf = d.feed(keySec.bytes).frames
      assert.equal(kf.length, 1)
      const before = kf[0].state
      const df = d.feed(deltaSec.bytes).frames
      assert.equal(df.length, 1)
      assert.equal(df[0].frame, 'D')
      const after = df[0].state
      const changed = Object.keys(before).filter((k) => before[k] !== after[k])
      assert.ok(changed.length > 0, 'delta changed nothing')
      // snapshot-only fields can never change through a delta
      for (const k of [
        'mode',
        'tu',
        'tr',
        'tl0',
        'tl3',
        'loopRate',
        'dropCount',
        'pitchRest',
      ])
        assert.equal(before[k], after[k], `delta must not touch ${k}`)
    },
  )
} else {
  console.log('-- fixture file absent, skipped:', FIXTURES)
}

console.log(`\n${passed} checks passed`)
