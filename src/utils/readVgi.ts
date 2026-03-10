const vgiOrder = [0, 2, 1, 3]

const readVGI = (data: Uint8Array): InstrumentParams | null => {
  if (data.length < 43) return null

  const al = data[0]
  const fb = data[1]

  const fms = (data[2] >> 3) & 7
  const ams = data[2] & 3

  const operators: Operator[] = new Array(4)

  for (let i = 0; i < 4; i++) {
    const p = 3 + i * 10

    const mul = data[p + 0]
    const det = data[p + 1]
    const tl = data[p + 2]

    const rs = data[p + 3]
    const ar = data[p + 4]

    const am = data[p + 5] >> 7
    const d1 = data[p + 5] & 0x1f

    const d2 = data[p + 6]

    const rr = data[p + 7]
    const sl = data[p + 8]

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
  } as InstrumentParams
}

export { readVGI }
