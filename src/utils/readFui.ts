// helpers
const readU16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8)
const readU32 = (d: Uint8Array, o: number) =>
  d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)

const enc = new TextEncoder()

// strings -> u8[]
const MAGIC_LEGACY = enc.encode('-Furnace instr.-')
const MAGIC_FINS = enc.encode('FINS')
const MAGIC_INST = enc.encode('INST')

const CODE_FM = 0x4d46 // 'FM'
const CODE_EN = 0x4e45 // 'EN'

const matchBytes = (
  data: Uint8Array,
  offset: number,
  magic: Uint8Array,
): boolean => {
  if (offset + magic.length > data.length) return false

  for (let i = 0; i < magic.length; i++) {
    if (data[offset + i] !== magic[i]) return false
  }
  return true
}

const isLegacyFui = (data: Uint8Array) => {
  return matchBytes(data, 0, MAGIC_LEGACY)
}

const isNewFui = (data: Uint8Array) => {
  return matchBytes(data, 0, MAGIC_FINS)
}

const readFuiLegacy = (data: Uint8Array): Instrument | null => {
  let pos = readU32(data, 0x14)

  if (!matchBytes(data, pos, MAGIC_INST)) {
    return null
  }
  pos += MAGIC_INST.length

  // skip instrument metadata
  pos += 4 // 4  | size of this block
  pos += 2 // 2  | format version (see header)
  const type = data[pos++] // 1  | instrument type

  if (type !== 0x01) return null

  pos += 1 // 1  | reserved

  // skip name
  while (data[pos] !== 0) pos++
  pos++

  // FM instrument header
  const al = data[pos++]
  const fb = data[pos++]
  const fms = data[pos++]
  const ams = data[pos++]

  pos++ // operator count
  pos++ // opll preset
  pos += 2 // reserved

  const operators: Operator[] = []

  for (let op = 0; op < 4; op++) {
    const o = pos + op * 32

    operators.push({
      am: data[o + 0],
      ar: data[o + 1],
      d1: data[o + 2],
      mul: data[o + 3],
      rr: data[o + 4],
      sl: data[o + 5],
      tl: data[o + 6],
      rs: data[o + 8],
      det: data[o + 9],
      d2: data[o + 10],
    })
  }

  return {
    al,
    fb,
    fms,
    ams,
    operators,
  } as Instrument
}

const readFuiNew = (data: Uint8Array): Instrument | null => {
  let pos = 0

  // "FINS"
  pos += 4

  const version = readU16(data, pos)
  pos += 2
  const type = readU16(data, pos)
  pos += 2

  // only FM
  if (type !== 0x0001) return null

  let result: Instrument | null = null

  while (pos + 4 <= data.length) {
    const code = readU16(data, pos)
    pos += 2
    const len = readU16(data, pos)
    pos += 2

    if (pos + len > data.length) return null

    if (code === CODE_EN) break

    const slice = data.subarray(pos, pos + len)

    switch (code) {
      case CODE_FM:
        result = parseFMBlock(slice, version)
        break
    }

    pos += len
  }

  return result
}

// ------------------------
// FM BLOCK (packed)
// ------------------------
//

const parseFMBlock = (d: Uint8Array, _version: number): Instrument | null => {
  let pos = 0

  // --- minimal size sanity ---
  if (d.length < 4) return null

  // --- flags ---
  const flags = d[pos++]
  const opCount = flags & 0x0f
  const opEnable = (flags >> 4) & 0x0f

  if (opCount !== 4) return null

  // --- base data ---
  const b0 = d[pos++]
  const al = (b0 >> 4) & 0x07
  const fb = b0 & 0x07

  const b1 = d[pos++]
  const fms = (b1 & 0x07) | (((b1 >> 5) & 0x01) << 3)
  const ams = (b1 >> 3) & 0x03

  // third base byte (AM2 + LLPatch) — ignored
  pos++

  // optional 4th base byte (Block) for version >= 224
  if (_version >= 224) {
    if (pos >= d.length) return null
    pos++
  }

  // --- operators ---
  const operators: Operator[] = []

  for (let i = 0; i < 4; i++) {
    // bounds check per operator
    if (pos + 8 > d.length) return null

    const b0 = d[pos++]
    const ksr = (b0 >> 7) & 0x01
    const det = (b0 >> 4) & 0x07
    const mul = b0 & 0x0f

    const b1 = d[pos++]
    const sus = (b1 >> 7) & 0x01
    const tl = b1 & 0x7f

    const b2 = d[pos++]
    const rs = (b2 >> 6) & 0x03
    const vib = (b2 >> 5) & 0x01
    const ar = b2 & 0x1f

    const b3 = d[pos++]
    const am = (b3 >> 7) & 0x01
    const ksl = (b3 >> 5) & 0x03
    const dr = b3 & 0x1f

    const b4 = d[pos++]
    const egt = (b4 >> 7) & 0x01
    const kvs = (b4 >> 5) & 0x03
    const d2r = b4 & 0x1f

    const b5 = d[pos++]
    const sl = (b5 >> 4) & 0x0f
    const rr = b5 & 0x0f

    pos++ // DVB / SSG (skip)
    pos++ // DAM / DT2 / WS (skip)

    // optionally skip disabled operators
    if (((opEnable >> i) & 1) === 0) continue

    operators.push({
      am,
      ar,
      d1: dr, // mapped from DR
      d2: d2r,
      rr,
      sl,
      tl,
      rs,
      mul,
      det,
    })
  }

  // optional sanity check (debug only)
  // if (pos !== d.length) console.warn('FM block not fully consumed', pos, d.length)

  return { al, fb, fms, ams, operators } as Instrument
}

const readFui = (data: Uint8Array): Instrument | null => {
  if (isLegacyFui(data)) return readFuiLegacy(data)
  if (isNewFui(data)) return readFuiNew(data)
  return null
}

export { readFui }
