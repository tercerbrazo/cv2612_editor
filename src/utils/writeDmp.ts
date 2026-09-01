import { clampFileDt } from './detune.ts'

/*
 * DMP (DefleMask preset) writer — the library's export format.
 * Version 9 layout, the same shape readDmp accepts back: version, mode=1,
 * reserved, then fms/fb/al/ams and 4 operators x 11 bytes
 * (mul, tl, ar, dr, sl, rr, am, rs, dt, d2r, ssg). Detune stays in the
 * file's 0..6-center-3 domain end to end (see detune.ts), so a patch
 * round-trips and the file means the same thing in DefleMask/Furnace.
 */
const writeDmp = (inst: Instrument): number[] => {
  const bytes: number[] = []

  // version
  bytes.push(0x09)

  // header flags expected by reader
  bytes.push(0x01)
  bytes.push(0x00)

  // channel params
  bytes.push(inst.fms)
  bytes.push(inst.fb)
  bytes.push(inst.al)
  bytes.push(inst.ams)

  for (const op of inst.operators) {
    bytes.push(op.mul)
    bytes.push(op.tl)
    bytes.push(op.ar)
    bytes.push(op.d1)
    bytes.push(op.sl)
    bytes.push(op.rr)
    bytes.push(op.am)
    bytes.push(op.rs)
    bytes.push(clampFileDt(op.det))
    bytes.push(op.d2)

    // SSG-EG (not modeled)
    bytes.push(0)
  }

  return bytes
}

export { writeDmp }
