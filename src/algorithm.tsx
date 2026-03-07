import React from 'react'
import { resetChannel, useParam } from './context'
import algorithmAscii from './utils/algorithmAscii'

const Algorithm = () => {
  const { value, mixed } = useParam('al', 0)

  const handleClick = (ev: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
    ev.preventDefault()
    resetChannel()
  }

  return (
    <a href="!#" onClick={handleClick} style={{ textDecoration: 'none' }}>
      <pre className={`algorithm ${mixed ? 'mixed' : ''} `}>
        {algorithmAscii(value)}
      </pre>
    </a>
  )
}

export default Algorithm
