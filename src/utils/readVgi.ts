import { fileDtToChip } from './detune.ts'

/*
 * VGI (VGM Music Maker instrument): 43 bytes = TFI plus one FMS/AMS byte.
 * Byte 2 layout per the spec is %00AA0FFF — AMS in bits 4-5, FMS in bits
 * 0-2 (register $B4 style). The DR byte carries the AM flag in bit 7.
 */
const readVGI = (data: Uint8Array): Instrument | null => {
  if (data.length < 43) return null

  const al = data[0] & 0x07
  const fb = data[1] & 0x07

  const fms = data[2] & 0x07
  const ams = (data[2] >> 4) & 0x03

  const operators: Operator[] = new Array(4)

  for (let i = 0; i < 4; i++) {
    const p = 3 + i * 10

    const mul = data[p + 0] & 0x0f
    const det = fileDtToChip(data[p + 1])
    const tl = data[p + 2] & 0x7f

    const rs = data[p + 3] & 0x03
    const ar = data[p + 4] & 0x1f

    const am = data[p + 5] >> 7
    const d1 = data[p + 5] & 0x1f

    const d2 = data[p + 6] & 0x1f

    const rr = data[p + 7] & 0x0f
    const sl = data[p + 8] & 0x0f

    operators[i] = {
      mul,
      tl,
      ar,
      d1,
      sl,
      rr,
      am,
      rs,
      det,
      d2,
    }
  }

  return {
    fms,
    fb,
    al,
    ams,
    operators,
  } as Instrument
}

export { readVGI }
