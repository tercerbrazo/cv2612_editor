export const calculateEnvelopePoints = ({ ar, tl, d1, sl, d2, rr }) => {
  const x1 = Math.round((1 - ar) * 100)
  const y1 = Math.round(tl * 100)
  const x2 = Math.round(x1 + (1 - d1) * 100)
  const y2 = Math.round(y1 + (100 - y1) * sl)
  const x3 = Math.round(x2 + 100)
  const y3 = Math.round(y2 + (100 - y2) * (0.5 * d2))
  const x4 = Math.round(x3 + (1 - rr) * 100)

  const points = [
    [0, 100],
    [x1, y1],
    [x2, y2],
    [x3, y3],
    [x4, 100],
  ]
  return points
    .map((p) => p.join(','))
    .join(' ')
    .replace(/NaN/g, '0')
}
