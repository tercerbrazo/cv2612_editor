import React, { ChangeEvent, MouseEventHandler } from 'react'
import { applyParam, toggleParamBinding, useBinding, useParam } from './context'
import { getParamMeta } from './utils/paramsHelpers'

type SliderProps = {
  id: Param
  op?: OperatorId
}

const Slider = ({ id, op = 0 }: SliderProps) => {
  const { title, max } = getParamMeta(id)
  const { bindingIndex, boundTo, bindingId } = useBinding(id, op)
  const { value, mixed, ccHint } = useParam(id, op)

  const learn = bindingIndex !== undefined && bindingId !== undefined
  const className = `slider ${learn ? 'learn' : ''} ${mixed ? 'mixed' : ''}`

  const onChange = (ev: ChangeEvent<HTMLInputElement>) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)
    applyParam(id, op, val)
  }

  const onClick: MouseEventHandler<HTMLDivElement> = (ev) => {
    ev.preventDefault()
    if (bindingIndex) {
      toggleParamBinding(id, op)
    }
  }

  return (
    <div
      className={className}
      onClick={onClick}
      data-title={`${title} - ${ccHint}`}
    >
      <label>
        {id}
        <i className={boundTo !== undefined ? 'xyz'[boundTo] : ''} />
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
