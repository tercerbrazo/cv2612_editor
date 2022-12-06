import React, { useContext } from 'react'
import { CV2612Context } from './context'
import Envelope from './envelope'
import Slider from './slider'

const Operator = ({ op }) => {
  const { dispatch } = useContext(CV2612Context)

  const onEnvelopeClick = (ev) => {
    ev.preventDefault()
    dispatch({ type: 'reset-operator', op })
  }

  return (
    <div className="operator">
      <Slider
        title="Attack Rate (angle)"
        label="ar"
        cc={30 + op * 10 + 0}
        bits={5}
      />
      <Slider
        title="Decay1 Rate (angle)"
        label="d1"
        cc={30 + op * 10 + 1}
        bits={5}
      />
      <Slider
        title="Sustain Level (attenuation)"
        label="sl"
        cc={30 + op * 10 + 2}
        bits={4}
      />
      <Slider
        title="Decay2 Rate (angle)"
        label="d2"
        cc={30 + op * 10 + 3}
        bits={5}
      />
      <Slider
        title="Release Rate (angle)"
        label="rr"
        cc={30 + op * 10 + 4}
        bits={4}
      />
      <Slider
        title="Total Level (attenuation)"
        label="tl"
        cc={30 + op * 10 + 5}
        bits={7}
      />
      <a href="!#" onClick={onEnvelopeClick}>
        <Envelope op={op} />
      </a>
      <Slider title="Multiplier" label="mul" cc={30 + op * 10 + 6} bits={4} />
      <Slider title="Detune" label="det" cc={30 + op * 10 + 7} bits={3} />
      <Slider title="Rate Scaling" label="rs" cc={30 + op * 10 + 8} bits={2} />
      <Slider
        title="Amplitude Modulation"
        label="am"
        cc={30 + op * 10 + 9}
        bits={1}
      />
    </div>
  )
}

export default Operator
