import React, { useContext } from 'react'
import { CV2612Context, OperatorId } from './context'
import Envelope from './envelope'
import Slider from './slider'

type OperatorProps = { op: OperatorId }
const Operator = ({ op }: OperatorProps) => {
  const { dispatch } = useContext(CV2612Context)

  const onEnvelopeClick = (ev) => {
    ev.preventDefault()
    dispatch({ type: 'reset-operator', op })
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
        <Envelope op={op} />
      </a>
      <Slider id="mul" op={op} />
      <Slider id="det" op={op} />
      <Slider id="rs" op={op} />
      <Slider id="am" op={op} />
    </div>
  )
}

export default Operator
