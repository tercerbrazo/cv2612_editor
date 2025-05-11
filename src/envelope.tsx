import React, { useMemo } from 'react'
import { state } from './context'
import { useSnapshot } from 'valtio'
import { getParamMeta } from './utils/paramsHelpers'
import { calculateEnvelopePoints } from './utils/envelopePoints'

type EnvelopeValues = Omit<
  Record<OperatorParam, number>,
  'am' | 'mul' | 'det' | 'rs'
>

const Envelope = ({ op }: { op: OperatorId }) => {
  const snap = useSnapshot(state)

  const values: EnvelopeValues = {
    ar: snap.patches[snap.patchIdx].channels[snap.channelIdx].operators[op].ar,
    d1: snap.patches[snap.patchIdx].channels[snap.channelIdx].operators[op].d1,
    sl: snap.patches[snap.patchIdx].channels[snap.channelIdx].operators[op].sl,
    d2: snap.patches[snap.patchIdx].channels[snap.channelIdx].operators[op].d2,
    rr: snap.patches[snap.patchIdx].channels[snap.channelIdx].operators[op].rr,
    tl: snap.patches[snap.patchIdx].channels[snap.channelIdx].operators[op].tl,
  }

  const points = useMemo(() => {
    const normalizedValues = Object.fromEntries(
      Object.entries(values).map(([k, v]) => {
        const { max } = getParamMeta(k as OperatorParam, 0)
        return [k, v / max]
      }),
    ) as EnvelopeValues

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
