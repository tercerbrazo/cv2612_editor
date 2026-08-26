/*
 * Detune lives in the community-file domain end to end: 0..6 with 3 = "no
 * detune" (i.e. -3..+3 offset by 3). The firmware remaps it to the YM2612
 * sign-magnitude register on the way to the chip; the editor, the file
 * formats, the factory bank and the sync/CRC all stay in 0..6. This helper
 * only clamps to the valid 0..6 range (the 3-bit field can hold 7, which no
 * format uses).
 */
const clampFileDt = (dt: number): number => {
  const v = dt & 0x07
  return v > 6 ? 6 : v
}

export { clampFileDt }
