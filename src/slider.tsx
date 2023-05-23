/* eslint-disable jsx-a11y/control-has-associated-label */
import React, { useContext } from 'react'
import { BindingValue, CtrlId, CV2612Context, OperatorId } from './context'

type SliderProps = {
  id: CtrlId
  op?: OperatorId
}

const Slider = ({ id, op = 0 }: SliderProps) => {
  const { state, dispatch, getParamData } = useContext(CV2612Context)

  const { title, label, max, value, ch, cc, unbounded } = getParamData(id, op)

  const className = `slider ${!unbounded && state.bindingKey ? 'learn' : ''}`
  const bindingValue = `${id}-${op}` as BindingValue

  const onChange = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)

    dispatch({
      type: 'update-ctrl',
      id,
      op,
      val,
    })
  }

  const onClick = (ev) => {
    ev.preventDefault()
    if (!unbounded) {
      dispatch({ type: 'touch-ctrl', id, op })
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
        <i className={state.bindings.x.includes(bindingValue) ? 'x' : ''} />
        <i className={state.bindings.y.includes(bindingValue) ? 'y' : ''} />
        <i className={state.bindings.z.includes(bindingValue) ? 'z' : ''} />
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
