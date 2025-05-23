import React from 'react'
import Calibration from './calibration'
import { CV2612Provider } from './context'
import logo from './logo.png'
import Midi from './midi'
import Patch from './patch'
import Scene from './scene'
import './styles.sass'

const App = () => {
  return (
    <CV2612Provider>
      <div className="two-cols">
        <div className="col">
          <img
            alt=""
            style={{ filter: 'invert(1)' }}
            src={logo}
            height="80px"
          />
        </div>
        <div className="col">
          <h3 style={{ textAlign: 'right' }}>CV-2612 Editor</h3>
        </div>
      </div>
      <Calibration />
      <Patch />
      <Midi />
      <Scene />
    </CV2612Provider>
  )
}

export default App
