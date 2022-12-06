import React, { useContext } from 'react'
import { CV2612Context } from './context'

const Dropdown = ({ title, label, cc, options }) => {
  const { state, dispatch } = useContext(CV2612Context)

  // dropdowns are for global parameters
  const value = state.settings[cc]

  const onChange = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)

    dispatch({
      type: 'update-setting',
      cc,
      val,
    })
  }

  return (
    <div
      className="dropdown"
      aria-hidden="true"
      data-title={`${title} - CC${cc}`}
    >
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
