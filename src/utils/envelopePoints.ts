type CalculateEnvelopePointsArgs = {
  ar: number
  tl: number
  d1: number
  sl: number
  d2: number
  rr: number
}
const calculateEnvelopePoints = ({
  ar,
  tl,
  d1,
  sl,
  d2,
  rr,
}: CalculateEnvelopePointsArgs) => {
  const x1 = 1 - ar
  const y1 = 1 - tl
  const x2 = x1 + (1 - d1)
  const y2 = y1 * (1 - sl)
  const x3 = x2 + 1
  const y3 = y2 * (1 - d2)
  const x4 = x3 + (1 - rr)

  const points = [
    [0, 0],
    [x1, y1],
    [x2, y2],
    [x3, y3],
    [x4, 0],
  ]

  return points
    .map(([x, y]) => `${Math.round(x * 100)},${Math.round((1 - y) * 100)}`)
    .join(' ')
}

export { calculateEnvelopePoints }
