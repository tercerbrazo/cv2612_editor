import React, { useMemo } from 'react'
import { useParam } from './context'
import { calculateEnvelopePoints } from './utils/envelopePoints'
import { getParamMeta } from './utils/paramsHelpers'

type EnvelopeProps = { op: OperatorId }
const Envelope = ({ op }: EnvelopeProps) => {
  const ar = useParam('ar', op)
  const d1 = useParam('d1', op)
  const sl = useParam('sl', op)
  const d2 = useParam('d2', op)
  const rr = useParam('rr', op)
  const tl = useParam('tl', op)

  const values = {
    ar: ar.value,
    d1: d1.value,
    sl: sl.value,
    d2: d2.value,
    rr: rr.value,
    tl: tl.value,
  }

  const mixed =
    ar.mixed || d1.mixed || sl.mixed || d2.mixed || rr.mixed || tl.mixed

  const points = useMemo(() => {
    const normalizedValues = Object.fromEntries(
      Object.entries(values).map(([k, v]) => {
        const { max } = getParamMeta(k as OperatorParam)
        return [k, v / max]
      }),
    ) as typeof values

    return calculateEnvelopePoints(normalizedValues)
  }, [values])

  return (
    <div className={`envelope ${mixed ? 'mixed' : ''}`}>
      <svg
        height="100"
        width="400"
        viewBox="0 0 400 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <polyline points={points} />
      </svg>
    </div>
  )
}

export default Envelope
