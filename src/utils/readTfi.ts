import { fileDtToChip } from './detune.ts'

/*
 * TFI (TFM Music Maker instrument): 42 bytes, the lingua franca of the
 * community YM2612 patch libraries (the big ROM-extracted packs are TFI).
 *
 * Layout (vgmrips/Plutiedev): alg, fb, then 4 operators x 10 bytes:
 *   mul, dt(0-6, center 3), tl, rs, ar, dr, d2r, rr, sl, ssg-eg
 *
 * Operators are stored in REGISTER order (S1, S3, S2, S4) — which is also
 * this editor's operators[] order (the firmware maps op index straight to
 * the register slot: YM_OFF = reg + ch%3 + op*4), so no reordering.
 *
 * TFI carries no AM flags and no FMS/AMS; SSG-EG is dropped (the module's
 * parameter model does not expose it — almost no patch uses it).
 */
const readTfi = (data: Uint8Array): Instrument | null => {
  if (data.length < 42) return null

  const al = data[0] & 0x07
  const fb = data[1] & 0x07

  const operators: Operator[] = []

  for (let i = 0; i < 4; i++) {
    const p = 2 + i * 10

    operators.push({
      mul: data[p + 0] & 0x0f,
      det: fileDtToChip(data[p + 1]),
      tl: data[p + 2] & 0x7f,
      rs: data[p + 3] & 0x03,
      ar: data[p + 4] & 0x1f,
      d1: data[p + 5] & 0x1f,
      d2: data[p + 6] & 0x1f,
      rr: data[p + 7] & 0x0f,
      sl: data[p + 8] & 0x0f,
      am: 0,
    })
  }

  return {
    al,
    fb,
    fms: 0,
    ams: 0,
    operators,
  } as Instrument
}

export { readTfi }
