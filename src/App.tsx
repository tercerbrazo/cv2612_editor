import React, { useCallback, useContext } from 'react'
import Calibration from './calibration'
import InstrumentsLoader from './instruments-loader'
import { CV2612Provider, CV2612Context } from './context'
import logo from './logo.png'
import Midi from './midi'
import Patch from './patch'
import Scene from './scene'
import './styles.sass'

const App = () => {
  const { state } = useContext(CV2612Context)

  const renderView = useCallback(() => {
    if (state.instrumentsLoader) {
      return (
        <>
          <Midi />
          <InstrumentsLoader />
        </>
      )
    }
    if (state.calibrationStep > 0) {
      return <Calibration />
    }

    return (
      <>
        <Patch />
        <Midi />
        <Scene />
      </>
    )
  }, [state.calibrationStep, state.instrumentsLoader])

  return (
    <>
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
      {renderView()}
    </>
  )
}

const AppWithContext = () => {
  return (
    <CV2612Provider>
      <App />
    </CV2612Provider>
  )
}

export default AppWithContext
