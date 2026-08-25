import React from 'react'
import { resetOperator } from './context'
import Envelope from './envelope'
import Slider from './slider'

type OperatorProps = {
  op: OperatorId
  // AM is inert (no LFO, or channel AMS=0) — de-emphasise the per-op AM slider
  amInert?: boolean
  // true=carrier (TL is volume), false=modulator (TL is timbre), undefined=don't label
  carrier?: boolean
  // this is operator 1 (the only one with feedback)
  feedbackOp?: boolean
  // fb=0 on the channel: the feedback operator is a pure sine
  fbZero?: boolean
}
const Operator = ({
  op,
  amInert = false,
  carrier,
  feedbackOp = false,
  fbZero = false,
}: OperatorProps) => {
  const onEnvelopeClick = (ev) => {
    ev.preventDefault()
    resetOperator(op)
  }

  return (
    <div className="operator">
      {carrier !== undefined && (
        <span
          className={carrier ? 'op-role carrier' : 'op-role'}
          title={
            carrier
              ? 'carrier: its TL is volume'
              : 'modulator: its TL is timbre, not volume'
          }
        >
          {carrier ? 'carrier' : 'mod'}
          {feedbackOp && (
            <span
              className={fbZero ? 'op-fb off' : 'op-fb'}
              title={
                fbZero
                  ? 'operator 1 carries feedback (FB=0: pure sine)'
                  : 'operator 1 carries feedback'
              }
            >
              {' ·fb'}
            </span>
          )}
        </span>
      )}
      <Slider id="ar" op={op} />
      <Slider id="d1" op={op} />
      <Slider id="sl" op={op} />
      <Slider id="d2" op={op} />
      <Slider id="rr" op={op} />
      <Slider
        id="tl"
        op={op}
        dataTitle={
          carrier === undefined
            ? undefined
            : carrier
              ? 'TL — carrier volume'
              : 'TL — modulator timbre'
        }
      />
      <a href="!#" onClick={onEnvelopeClick}>
        <Envelope op={op} />
      </a>
      <Slider id="mul" op={op} />
      <Slider id="det" op={op} />
      <Slider id="rs" op={op} />
      <Slider id="am" op={op} inert={amInert} />
    </div>
  )
}

export default Operator
