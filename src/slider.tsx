import React, { ChangeEvent, MouseEventHandler } from 'react'
import { useSnapshot } from 'valtio'
import {
  state,
  updateParam,
  toggleParamBinding,
  useBinding,
  useParam,
} from './context'
import { getParamMeta } from './utils/paramsHelpers'

type SliderProps = {
  id: Param
  op?: OperatorId
  // de-emphasise: value reaches the module but is inaudible now. Still editable.
  inert?: boolean
  // override tooltip (kept short for the fixed bubble): role-aware TL text
  dataTitle?: string
}

const Slider = ({ id, op = 0, inert = false, dataTitle }: SliderProps) => {
  const { title, max } = getParamMeta(id)
  const { bindingIndex, boundTo, bindingId } = useBinding(id, op)
  const { value, mixed, ccHint } = useParam(id, op)

  const learn = bindingIndex !== undefined && bindingId !== undefined
  const className = `slider ${learn ? 'learn' : ''} ${mixed ? 'mixed' : ''} ${
    inert ? 'inert' : ''
  }`

  // binding blocked by play mode: Y in DUO/TRIO/CHORD, Z in TRIO (allow_y/z_mod)
  const pm = useSnapshot(state).settings.pm
  const bindingBlocked =
    (boundTo === 1 && (pm === 1 || pm === 2 || pm === 3)) ||
    (boundTo === 2 && pm === 2)

  const onChange = (ev: ChangeEvent<HTMLInputElement>) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)
    updateParam(id, op, val)
  }

  const onClick: MouseEventHandler<HTMLDivElement> = (ev) => {
    ev.preventDefault()
    // !== undefined: lfo's binding index is 0, which is falsy
    if (bindingIndex !== undefined) {
      toggleParamBinding(id, op)
    }
  }

  return (
    <div
      className={className}
      onClick={onClick}
      data-title={dataTitle ?? `${title} - ${ccHint}`}
    >
      <label>
        {id}
        <i
          className={`${boundTo !== undefined ? 'xyz'[boundTo] : ''} ${
            bindingBlocked ? 'blocked' : ''
          }`}
          title={
            bindingBlocked
              ? `${'XYZ'[boundTo!]} doesn't drive this in the current play mode`
              : undefined
          }
        />
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
