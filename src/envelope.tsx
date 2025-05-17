import React, { useMemo } from 'react'
import { getParamMeta } from './utils/paramsHelpers'
import { calculateEnvelopePoints } from './utils/envelopePoints'

type EnvelopeProps = Omit<
  Record<OperatorParam, number>,
  'am' | 'mul' | 'det' | 'rs'
>

const Envelope = (values: EnvelopeProps) => {
  const points = useMemo(() => {
    const normalizedValues = Object.fromEntries(
      Object.entries(values).map(([k, v]) => {
        const { max } = getParamMeta(k as OperatorParam)
        return [k, v / max]
      }),
    ) as EnvelopeProps

    return calculateEnvelopePoints(normalizedValues)
  }, [values])

  return (
    <div className="envelope">
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
