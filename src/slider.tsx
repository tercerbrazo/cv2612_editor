/* eslint-disable jsx-a11y/control-has-associated-label */
import React, { useContext } from 'react'
import { CV2612Context, OperatorId, Param } from './context'

type SliderProps = {
  id: Param
  op?: OperatorId
}

const Slider = ({ id, op = 0 }: SliderProps) => {
  const { state, dispatch, getParamData } = useContext(CV2612Context)

  const { title, label, max, value, ch, cc, bi } = getParamData(id, op)

  const className = `slider ${bi && state.bindingKey ? 'learn' : ''}`

  const onChange = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)

    dispatch({
      type: 'change-param',
      id,
      op,
      val,
    })
  }

  const onClick = (ev) => {
    ev.preventDefault()
    if (bi) {
      dispatch({ type: 'toggle-param-binding', id, op })
    }
  }

  return (
    <div
      className={className}
      onClick={onClick}
      aria-hidden="true"
      data-title={`${title} - CC ${ch}:${cc}`}
    >
      <label>
        {label}
        <i className={state.bindings.x.includes(bi) ? 'x' : ''} />
        <i className={state.bindings.y.includes(bi) ? 'y' : ''} />
        <i className={state.bindings.z.includes(bi) ? 'z' : ''} />
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
