/*
* Converts a dmp instrument file into an object of CC
* being the `key` the cc number and the `value` the cc value
* to be sent in order to set this dmp in the cv2612 module
    http://www.deflemask.com/DMP_SPECS.txt
    1 Byte: LFO (FMS on YM2612, PMS on YM2151)
    1 Byte: FB
    1 Byte: ALG
    1 Byte: LFO2 (AMS on YM2612, AMS on YM2151)
    Repeat this TOTAL_OPERATORS times
      1 Byte: MULT
      1 Byte: TL
      1 Byte: AR
      1 Byte: DR
      1 Byte: SL
      1 Byte: RR
      1 Byte: AM
      1 Byte: RS
      1 Byte: DT (DT2<<4 | DT on YM2151)
      1 Byte: D2R
      1 Byte: SSGEG_Enabled <<3 | SSGEG
      */

/*
 * Transforms a dmp buffer into a compact 26-bytes representation
 * of a YM2612 channel, that matches chip REGISTERS bit a bit
 */
const readDmp = (data: Int8Array, name: string): Channel | null => {
  //version 9 or 11, genesis, FM patch
  if (
    (data[0] === 0x09 && data[1] === 0x01 && data[2] === 0x00) ||
    (data[0] === 0x0b && data[1] === 0x02 && data[2] === 0x01)
  ) {
    const operators: Operator[] = []
    for (let op = 0; op < 4; op++) {
      const o = op * 11 + 7

      operators.push({
        mul: data[o + 0],
        tl: data[o + 1],
        ar: data[o + 2],
        d1: data[o + 3],
        sl: data[o + 4],
        rr: data[o + 5],
        am: data[o + 6],
        rs: data[o + 7],
        det: data[o + 8],
        d2: data[o + 9],
      })
    }
    return {
      name,
      st: 3,
      fms: data[3],
      fb: data[4],
      al: data[5],
      ams: data[6],
      operators: operators as [Operator, Operator, Operator, Operator],
    }
  } else {
    return null
  }
}

export { readDmp }
