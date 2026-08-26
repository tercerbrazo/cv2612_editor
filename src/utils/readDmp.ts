import { clampFileDt } from './detune.ts'

const readDmp = (data: Uint8Array): Instrument | null => {
  const version = data[0]

  switch (version) {
    case 0x07:
      break
    case 0x08:
    case 0x09:
      // same layout: version, mode=1, reserved
      if (data[1] !== 0x01 || data[2] !== 0x00) return null
      break
    case 0x0b:
      if (data[1] !== 0x02 || data[2] !== 0x01) return null
      break
    default:
      return null
  }

  // 7-byte header + 4 operators * 11 bytes. Without this a truncated (or non-FM)
  // file whose first byte is 0x07 read undefineds into a non-null instrument.
  if (data.length < 7 + 4 * 11) return null

  // mask each field to its width, like readTfi/readVgi: a no-op for valid files,
  // but a nonstandard exporter's high bits would otherwise reach the CC wrapped
  const fms = data[3] & 0x07
  const fb = data[4] & 0x07
  const al = data[5] & 0x07
  const ams = data[6] & 0x03

  const operators: Operator[] = []

  for (let op = 0; op < 4; op++) {
    const o = 7 + op * 11

    operators.push({
      mul: data[o + 0] & 0x0f,
      tl: data[o + 1] & 0x7f,
      ar: data[o + 2] & 0x1f,
      d1: data[o + 3] & 0x1f,
      sl: data[o + 4] & 0x0f,
      rr: data[o + 5] & 0x0f,
      am: data[o + 6] & 0x01,
      rs: data[o + 7] & 0x03,
      // low nibble only: on YM2151-targeted files the high nibble is DT2
      det: clampFileDt(data[o + 8]),
      d2: data[o + 9] & 0x1f,
    })
  }

  return {
    fms,
    fb,
    al,
    ams,
    operators,
  } as Instrument
}

export { readDmp }
