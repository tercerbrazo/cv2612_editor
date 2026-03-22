import React from 'react'
import { useParam, updateParam } from './context'
import { getParamMeta, getParamOptions } from './utils/paramsHelpers'

type DropdownProps = {
  id: SettingParam
}

const Dropdown = ({ id }: DropdownProps) => {
  const options = getParamOptions(id)
  const { value, ccHint } = useParam(id, 0)
  const { title } = getParamMeta(id)

  const onChange = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)
    updateParam(id, 0, val)
  }

  return (
    <div className="dropdown" data-title={`${title} - ${ccHint}`}>
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
