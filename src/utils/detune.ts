/*
 * Detune conversion between instrument FILE formats and the chip register.
 *
 * Every community format (TFI, VGI, DMP, Furnace) stores detune the way
 * trackers display it: 0..6 with 3 as "no detune" (i.e. -3..+3 offset by 3).
 * The editor and the module use the YM2612 register encoding end to end
 * (the firmware writes the value verbatim into DT1): sign-magnitude, where
 * 0..3 = +0..+3 and 4..7 = -0..-3.
 *
 * Importing without this conversion silently re-tunes patches: a neutral
 * file detune of 3 lands as +3 on the chip, and a file -3 (stored 0) lands
 * as "no detune" — unison patches lose their beating.
 */

const fileDtToChip = (dt: number): number => {
  const d = (dt & 0x07) - 3 // 0..6 -> -3..+3 (7 is out of spec, clamps below)
  if (d >= 3) return 3
  return d >= 0 ? d : 4 - d // negative -> 4 + |d|
}

const chipDtToFile = (det: number): number => {
  const v = det & 0x07
  const d = v < 4 ? v : -(v - 4) // sign-magnitude -> -3..+3
  return d + 3
}

export { fileDtToChip, chipDtToFile }
