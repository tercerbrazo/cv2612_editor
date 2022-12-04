import React, { useContext } from 'react'
import { CV2612Context } from './context'

function Dropdown({ title, label, cc, options }) {
  const { state, dispatch } = useContext(CV2612Context)

  // dropdowns are for global parameters
  const patchIdx = 0
  const ch = 0

  const patch = state.patches[patchIdx]
  const ccs = patch[ch]
  const value = ccs[cc]

  const onChange = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)

    dispatch({
      type: 'update-param',
      patchIdx,
      ch,
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
