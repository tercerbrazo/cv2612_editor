/* eslint-disable jsx-a11y/control-has-associated-label */
import React, { useContext } from 'react'
import { CV2612Context } from './context'

function Slider({
  title,
  label,
  cc,
  bits,
  noPatch = false,
  noChannel = false,
  unbounded = false,
}) {
  const { state, dispatch } = useContext(CV2612Context)

  // get the patch index
  const patchIdx = noPatch ? 0 : state.patchIdx

  // get the cc channel
  const ch = noChannel ? 0 : state.channelIdx

  const patch = state.patches[patchIdx]
  const ccs = patch[ch]

  const max = 127 >> (7 - bits)
  const className = `slider ${!unbounded && state.bindingKey ? 'learn' : ''}`
  const value = ccs[cc] >> (7 - bits)

  const onChange = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10) << (7 - bits)

    dispatch({
      type: 'update-param',
      patchIdx,
      ch,
      cc,
      val,
    })
  }

  const onClick = (ev) => {
    ev.preventDefault()
    if (!unbounded) {
      dispatch({ type: 'touch-param', patchIdx, cc })
    }
  }

  return (
    <div
      className={className}
      onClick={onClick}
      aria-hidden="true"
      data-title={`${title} - CC${cc}`}
    >
      <label>
        {label}
        <i className={state.bindings.x.includes(cc) ? 'x' : ''} />
        <i className={state.bindings.y.includes(cc) ? 'y' : ''} />
        <i className={state.bindings.z.includes(cc) ? 'z' : ''} />
      </label>
      <input
        type="range"
        step={1}
        min={0}
        max={max}
        value={value}
        onChange={onChange}
      />
      <span>{value}</span>
    </div>
  )
}

export default Slider
