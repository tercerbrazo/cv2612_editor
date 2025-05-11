import React from 'react'
import { dispatch, state } from './context'
import algorithmAscii from './utils/algorithmAscii'
import { useSnapshot } from 'valtio'

const Algorithm = () => {
  const snap = useSnapshot(state)
  const value = snap.patches[snap.patchIdx].channels[snap.channelIdx].al

  const onAlgorithmClick = (
    ev: React.MouseEvent<HTMLAnchorElement, MouseEvent>,
  ) => {
    ev.preventDefault()
    dispatch({ type: 'reset-channel' })
  }

  return (
    <a href="!#" onClick={onAlgorithmClick} style={{ textDecoration: 'none' }}>
      <pre className="algorithm">{algorithmAscii(value)}</pre>
    </a>
  )
}

export default Algorithm
