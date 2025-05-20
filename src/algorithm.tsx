import React from 'react'
import { resetChannel, state } from './context'
import algorithmAscii from './utils/algorithmAscii'
import { useSnapshot } from 'valtio'

const Algorithm = () => {
  const snap = useSnapshot(state)
  const value = snap.patches[snap.patchIdx].channels[snap.channelIdx].al

  const handleClick = (ev: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
    ev.preventDefault()
    resetChannel()
  }

  return (
    <a href="!#" onClick={handleClick} style={{ textDecoration: 'none' }}>
      <pre className="algorithm">{algorithmAscii(value)}</pre>
    </a>
  )
}

export default Algorithm
