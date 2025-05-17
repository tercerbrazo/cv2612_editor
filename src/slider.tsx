import React, { ChangeEvent, MouseEventHandler } from 'react'
import { dispatch, useParamData, useParamMidi, useBinding } from './context'

type SliderProps = {
  id: Param
  op?: OperatorId
}

const Slider = ({ id, op = 0 }: SliderProps) => {
  const { title, label, max, value } = useParamData(id, op)
  const { bindingIndex, boundTo, bindingId } = useBinding(id, op)
  const { ch, cc } = useParamMidi(id, op)

  const className = `slider ${bindingIndex && bindingId ? 'learn' : ''}`

  const onChange = (ev: ChangeEvent<HTMLInputElement>) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)

    dispatch({
      type: 'change-param',
      id,
      op,
      val,
    })
  }

  const onClick: MouseEventHandler<HTMLDivElement> = (ev) => {
    ev.preventDefault()
    if (bindingIndex) {
      dispatch({ type: 'toggle-param-binding', id, op })
    }
  }

  return (
    <div
      className={className}
      onClick={onClick}
      data-title={`${title} - CC ${ch}:${cc}`}
    >
      <label>
        {label}
        <i className={boundTo ?? ''} />
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
