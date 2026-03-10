const readDmp = (data: Uint8Array): InstrumentParams | null => {
  const version = data[0]

  switch (version) {
    case 0x07:
      break
    case 0x09:
      if (data[1] !== 0x01 || data[2] !== 0x00) return null
      break
    case 0x0b:
      if (data[1] !== 0x02 || data[2] !== 0x01) return null
      break
    default:
      return null
  }

  const fms = data[3]
  const fb = data[4]
  const al = data[5]
  const ams = data[6]

  const operators: Operator[] = []

  for (let op = 0; op < 4; op++) {
    const o = 7 + op * 11

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
    fms,
    fb,
    al,
    ams,
    operators,
  } as InstrumentParams
}

export { readDmp }
