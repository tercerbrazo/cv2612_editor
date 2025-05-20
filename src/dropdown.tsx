import React from 'react'
import { state, useParamMidi, useParamValue } from './context'
import MidiIO from './midi-io'
import { getParamMeta, getParamOptions } from './utils/paramsHelpers'

type DropdownProps = {
  id: SettingParam
}

const Dropdown = ({ id }: DropdownProps) => {
  const options = getParamOptions(id)
  const value = useParamValue(id, 0)
  const { title } = getParamMeta(id)
  const { cc, ch } = useParamMidi(id, 0)

  const onChange = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)
    state.settings[id] = val
    MidiIO.sendCC(ch, cc, val)
  }

  return (
    <div className="dropdown" data-title={`${title} - CC ${ch}:${cc}`}>
      <label>{id}</label>
      <select onChange={onChange} value={value}>
        {options.map((o, i) => (
          <option key={o} value={i}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

export default Dropdown
