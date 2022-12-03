import React, { useContext } from 'react'
import { CV2612Context } from './context'

function Envelope({ op }) {
  const { state } = useContext(CV2612Context)
  return (
    <div className="envelope">
      <svg
        height="100"
        width="400"
        viewBox="0 0 400 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <polyline points={state.envelopes[op]} />
      </svg>
    </div>
  )
}

export default Envelope
