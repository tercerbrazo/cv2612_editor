import React from 'react'
import { dispatch, useParamData } from './context'

type DropdownProps = {
  id: Param
}

const Dropdown = ({ id }: DropdownProps) => {
  const { title, label, options, value, ch, cc } = useParamData(id, 0)

  const onChange = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)

    dispatch({
      type: 'change-param',
      id,
      op: 0,
      val,
    })
  }

  return (
    <div className="dropdown" data-title={`${title} - CC ${ch}:${cc}`}>
      <label>{label}</label>
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
