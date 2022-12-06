/* eslint-disable jsx-a11y/control-has-associated-label */
import React, { useContext } from 'react'
import { CV2612Context } from './context'

const Slider = ({
  title,
  label,
  cc,
  bits,
  setting = false,
  noChannel = false,
  unbounded = false,
}) => {
  const { state, dispatch } = useContext(CV2612Context)

  // get the patch index
  const patchIdx = setting ? 0 : state.patchIdx
  // get the cc channel
  const channelIdx = noChannel ? 0 : state.channelIdx

  const ccValue = setting
    ? state.settings[cc]
    : state.patches[patchIdx][channelIdx][cc]

  const max = 127 >> (7 - bits)
  const className = `slider ${!unbounded && state.bindingKey ? 'learn' : ''}`
  const value = ccValue >> (7 - bits)

  const onChange = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10) << (7 - bits)

    if (setting) {
      dispatch({
        type: 'update-setting',
        cc,
        val,
      })
    } else {
      dispatch({
        type: 'update-param',
        patchIdx,
        channelIdx,
        cc,
        val,
      })
    }
  }

  const onClick = (ev) => {
    ev.preventDefault()
    if (!unbounded) {
      dispatch({ patchIdx, type: 'touch-param', cc })
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
