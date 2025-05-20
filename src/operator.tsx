import React from 'react'
import { resetOperator, state } from './context'
import Envelope from './envelope'
import Slider from './slider'
import { useSnapshot } from 'valtio'

type OperatorProps = { op: OperatorId }
const Operator = ({ op }: OperatorProps) => {
  const snap = useSnapshot(state)

  const operator =
    snap.patches[snap.patchIdx].channels[snap.channelIdx].operators[op]

  const onEnvelopeClick = (ev) => {
    ev.preventDefault()
    resetOperator(op)
  }

  return (
    <div className="operator">
      <Slider id="ar" op={op} />
      <Slider id="d1" op={op} />
      <Slider id="sl" op={op} />
      <Slider id="d2" op={op} />
      <Slider id="rr" op={op} />
      <Slider id="tl" op={op} />
      <a href="!#" onClick={onEnvelopeClick}>
        <Envelope
          ar={operator.ar}
          d1={operator.d1}
          sl={operator.sl}
          d2={operator.d2}
          rr={operator.rr}
          tl={operator.tl}
        />
      </a>
      <Slider id="mul" op={op} />
      <Slider id="det" op={op} />
      <Slider id="rs" op={op} />
      <Slider id="am" op={op} />
    </div>
  )
}

export default Operator
