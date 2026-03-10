const readU16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8)
const readU32 = (d: Uint8Array, o: number) =>
  d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)

const readFui = (data: Uint8Array): Instrument | null => {
  const magic = '-Furnace instr.-'

  for (let i = 0; i < magic.length; i++) {
    if (data[i] !== magic.charCodeAt(i)) return null
  }

  // pointer to instrument block
  let pos = readU32(data, 0x14)

  // expect INST
  if (
    data[pos++] !== 0x49 ||
    data[pos++] !== 0x4e ||
    data[pos++] !== 0x53 ||
    data[pos++] !== 0x54
  ) {
    return null
  }

  // skip instrument metadata
  pos += 4 // 4  | size of this block
  pos += 2 // 2  | format version (see header)
  const type = data[pos++] // 1  | instrument type

  if (type !== 0x01) {
    return null
  }
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

export { readFui }
