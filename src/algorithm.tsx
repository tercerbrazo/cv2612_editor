import React, { useContext } from 'react'
import { CV2612Context } from './context'
import algorithmAscii from './utils/algorithmAscii'

const Algorithm = () => {
  const { dispatch, getParamData } = useContext(CV2612Context)

  const { value } = getParamData('al', 0)

  const onAlgorithmClick = (
    ev: React.MouseEvent<HTMLAnchorElement, MouseEvent>
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
