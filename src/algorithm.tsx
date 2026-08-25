import React from 'react'
import { resetChannel, useParam } from './context'
import algorithmAscii from './utils/algorithmAscii'
import { CARRIER_OPS, OP_TO_DIGIT } from './utils/carriers'

const Algorithm = () => {
  const { value, mixed } = useParam('al', 0)

  const handleClick = (ev: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
    ev.preventDefault()
    resetChannel()
  }

  // Grey modulator digits so carriers stay green. Skip on mixed-algo selection.
  const ascii = algorithmAscii(value)
  const carrierDigits = new Set(
    (CARRIER_OPS[value] ?? []).map((op) => OP_TO_DIGIT[op]),
  )
  const isModDigit = (ch: string) => /[1-4]/.test(ch) && !carrierDigits.has(ch)

  return (
    <a href="!#" onClick={handleClick} style={{ textDecoration: 'none' }}>
      <pre className={`algorithm ${mixed ? 'mixed' : ''} `}>
        {mixed
          ? ascii
          : [...ascii].map((ch, i) =>
              isModDigit(ch) ? (
                <span key={i} className="algo-mod">
                  {ch}
                </span>
              ) : (
                ch
              ),
            )}
      </pre>
    </a>
  )
}

export default Algorithm
